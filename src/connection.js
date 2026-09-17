```js
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  Browsers,
  jidNormalizedUser
} from 'baileys'

import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import NodeCache from 'node-cache'
import readline from 'readline'
import fs from 'fs'
import path from 'path'

import config from './config.js'
import log, { waLogger } from './lib/logger.js'
import { useMongoAuthState } from './lib/mongoAuth.js'
import { getVar } from './lib/vars.js'
import { handleMessage } from './handler.js'

import {
  middlewares,
  deleteHandlers,
  pluginCount
} from './lib/pluginLoader.js'

/* ============================================================
 * CACHES
 * ============================================================ */

const groupCache = new NodeCache({
  stdTTL: 300,
  useClones: false
})

const msgRetryCounterCache = new NodeCache()

/* ============================================================
 * MESSAGE STORE
 * ============================================================ */

const messageStore = new Map()

const MAX_STORE = 10000

/* ============================================================
 * DELETE EVENT DEDUPLICATION
 * ============================================================ */

const processedDeletes = new NodeCache({
  stdTTL: 15,
  checkperiod: 30,
  useClones: false
})

/* ============================================================
 * INPUT
 * ============================================================ */

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })

/* ============================================================
 * RECONNECT STATE
 * ============================================================ */

let reconnectAttempts = 0
let reconnectTimer = null
let reconnecting = false
let currentSocket = null

/* ============================================================
 * SAFE NUMBER CLEANER
 * ============================================================ */

function cleanPhoneNumber(number) {
  return String(number || '').replace(/\D/g, '')
}

/* ============================================================
 * CLEAR RECONNECT TIMER
 * ============================================================ */

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

/* ============================================================
 * CLEAR FILE SESSION SAFELY
 *
 * IMPORTANT:
 * /app/session may be a Railway Volume mount.
 *
 * NEVER delete the /app/session directory itself.
 * Only delete the contents inside it.
 * ============================================================ */

function clearFileSession(sessionDir) {
  try {
    fs.mkdirSync(
      sessionDir,
      {
        recursive: true
      }
    )

    const entries =
      fs.readdirSync(
        sessionDir,
        {
          withFileTypes: true
        }
      )

    for (const entry of entries) {
      const target =
        path.join(
          sessionDir,
          entry.name
        )

      try {
        fs.rmSync(
          target,
          {
            recursive: true,
            force: true
          }
        )
      } catch (e) {
        log.warn(
          `Could not remove session item ${entry.name}: ${e.message}`
        )
      }
    }

    log.warn(
      `File session contents cleared: ${sessionDir}`
    )

    return true
  } catch (e) {
    log.error(
      `Could not clear file session: ${e.message}`
    )

    return false
  }
}

/* ============================================================
 * START SOCKET
 * ============================================================ */

export async function startSocket() {
  /*
   * Prevent accidental duplicate reconnect attempts.
   */
  if (reconnecting) {
    log.warn(
      'Socket startup already in progress. Skipping duplicate start.'
    )

    return currentSocket
  }

  reconnecting = true

  let state
  let saveCreds
  let deleteSession

  try {
    /* ========================================================
     * SESSION DIRECTORY
     * ======================================================== */

    if (config.sessionStore !== 'mongo') {
      fs.mkdirSync(
        config.sessionDir,
        {
          recursive: true
        }
      )

      const credsPath =
        path.join(
          config.sessionDir,
          'creds.json'
        )

      /*
       * Bootstrap a file session from SESSION_ID when supplied.
       */
      if (!fs.existsSync(credsPath)) {
        if (config.sessionId?.trim()) {
          try {
            const raw =
              Buffer
                .from(
                  config.sessionId.trim(),
                  'base64'
                )
                .toString('utf8')

            const parsed =
              JSON.parse(raw)

            /*
             * A normal Baileys creds object should contain
             * registration / account information.
             */
            if (
              !parsed ||
              typeof parsed !== 'object' ||
              !parsed.noiseKey ||
              !parsed.signedIdentityKey
            ) {
              throw new Error(
                'SESSION_ID does not contain valid WhatsApp credentials'
              )
            }

            fs.writeFileSync(
              credsPath,
              raw,
              {
                encoding: 'utf8',
                flag: 'wx'
              }
            )

            log.ok(
              'SESSION_ID used to bootstrap file session'
            )
          } catch (e) {
            log.warn(
              `SESSION_ID bootstrap skipped: ${e.message}`
            )
          }
        } else {
          log.info(
            'No existing file session found'
          )
        }
      } else {
        log.info(
          `Existing WhatsApp file session found in ${config.sessionDir}`
        )
      }
    }

    /* ========================================================
     * SESSION STORE
     * ======================================================== */

    if (
      config.sessionStore === 'mongo'
    ) {
      const auth =
        await useMongoAuthState(
          'default'
        )

      state = auth.state
      saveCreds = auth.saveCreds
      deleteSession = auth.deleteSession

      log.info(
        'Session store: MongoDB'
      )
    } else {
      fs.mkdirSync(
        config.sessionDir,
        {
          recursive: true
        }
      )

      const auth =
        await useMultiFileAuthState(
          config.sessionDir
        )

      state = auth.state
      saveCreds = auth.saveCreds

      /*
       * Railway Volume-safe session deletion.
       *
       * Do NOT remove config.sessionDir itself.
       * Only remove the contents inside it.
       */
      deleteSession = async () => {
        clearFileSession(
          config.sessionDir
        )
      }

      log.info(
        `Session store: files (${config.sessionDir})`
      )
    }

    /* ========================================================
     * WHATSAPP VERSION
     * ======================================================== */

    const {
      version,
      isLatest
    } =
      await fetchLatestBaileysVersion()

    log.info(
      `WhatsApp Web v${version.join('.')} ${
        isLatest
          ? '(latest)'
          : '(outdated)'
      }`
    )

    /* ========================================================
     * PAIRING
     * ======================================================== */

    const usePairing =
      config.authMethod === 'pair' &&
      !state.creds.registered

    /* ========================================================
     * SOCKET
     * ======================================================== */

    const sock =
      makeWASocket({
        version,

        logger: waLogger,

        auth: {
          creds: state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,
              waLogger
            )
        },

        browser:
          usePairing
            ? Browsers.ubuntu('Chrome')
            : Browsers.macOS('Safari'),

        markOnlineOnConnect:
          getVar('ALWAYS_ONLINE') ?? false,

        generateHighQualityLinkPreview:
          true,

        syncFullHistory:
          false,

        msgRetryCounterCache,

        cachedGroupMetadata:
          async (jid) =>
            groupCache.get(jid),

        /* ====================================================
         * MESSAGE RECOVERY
         * ==================================================== */

        getMessage:
          async (key) => {
            const stored =
              messageStore.get(
                key?.id
              )

            return (
              stored?.message ||
              undefined
            )
          }
      })

    currentSocket = sock
    reconnecting = false

    /* ============================================================
     * PAIRING CODE
     * ============================================================ */

    if (usePairing) {
      let number =
        cleanPhoneNumber(
          config.pairNumber
        )

      if (!number) {
        number =
          cleanPhoneNumber(
            await ask(
              '\n📱 Enter your WhatsApp number (country code, no +): '
            )
          )
      }

      if (!number) {
        log.error(
          'No WhatsApp number was provided for pairing.'
        )
      } else {
        setTimeout(
          async () => {
            try {
              /*
               * Make sure the socket is still usable.
               */
              if (
                !sock ||
                state.creds.registered
              ) {
                return
              }

              const custom =
                config.pairCustomCode &&
                /^[A-Z0-9]{8}$/.test(
                  String(
                    config.pairCustomCode
                  ).toUpperCase()
                )
                  ? String(
                      config.pairCustomCode
                    ).toUpperCase()
                  : undefined

              const code =
                await sock.requestPairingCode(
                  number,
                  custom
                )

              const pretty =
                code
                  ?.match(/.{1,4}/g)
                  ?.join('-') ||
                code

              log.banner(`
╔══════════════════════════════════════╗
║   PAIRING CODE:  ${String(pretty).padEnd(20)}║
╚══════════════════════════════════════╝
WhatsApp > Settings > Linked devices > Link with phone number
`)

              log.info(
                `Pairing requested for +${number}`
              )
            } catch (e) {
              log.error(
                `Could not get a pairing code: ${
                  e?.message ||
                  e
                }`
              )
            }
          },
          3000
        )
      }
    }

    /* ============================================================
     * SAVE CREDENTIALS
     * ============================================================ */

    sock.ev.on(
      'creds.update',
      async (...args) => {
        try {
          await saveCreds(
            ...args
          )
        } catch (e) {
          log.error(
            `Failed to save WhatsApp credentials: ${
              e?.message ||
              e
            }`
          )
        }
      }
    )

    /* ============================================================
     * CONNECTION EVENTS
     * ============================================================ */

    sock.ev.on(
      'connection.update',
      async (update) => {
        try {
          const {
            connection,
            lastDisconnect,
            qr
          } = update

          /* ======================================================
           * QR
           * ====================================================== */

          if (
            qr &&
            !usePairing &&
            !state.creds.registered
          ) {
            log.info(
              'Scan this QR with WhatsApp > Linked devices:\n'
            )

            qrcode.generate(
              qr,
              {
                small: true
              }
            )
          }

          /* ======================================================
           * CONNECTING
           * ====================================================== */

          if (
            connection === 'connecting'
          ) {
            log.info(
              'Connecting to WhatsApp...'
            )
          }

          /* ======================================================
           * OPEN
           * ====================================================== */

          if (
            connection === 'open'
          ) {
            reconnectAttempts = 0
            clearReconnectTimer()

            const me =
              jidNormalizedUser(
                sock.user?.id || ''
              )

            log.ok(
              `Connected as ${
                sock.user?.name ||
                'bot'
              } (${me.split('@')[0]})`
            )

            log.ok(
              `${pluginCount()} plugins ready | prefix "${config.prefix}" | mode ${getVar('MODE')}`
            )

            log.ok(
              `Anti-delete handlers available: ${deleteHandlers.length}`
            )

            if (
              deleteHandlers.length
            ) {
              log.ok(
                `Anti-delete handlers: ${
                  deleteHandlers
                    .map(
                      (handler) =>
                        handler.name ||
                        'unnamed'
                    )
                    .join(', ')
                }`
              )
            }

            /* ==================================================
             * STARTUP MESSAGE
             * ================================================== */

            if (
              getVar(
                'STARTUP_MESSAGE'
              )
            ) {
              const owner =
                config.ownerNumbers?.[0]

              if (owner) {
                const ownerJid =
                  String(owner).includes('@')
                    ? String(owner)
                    : `${cleanPhoneNumber(owner)}@s.whatsapp.net`

                await sock
                  .sendMessage(
                    ownerJid,
                    {
                      text:
                        `╭━━━〔 *${config.botName}* 〕━━━╮\n` +
                        `┃ ✅ Bot is online\n` +
                        `┃ 🔌 Plugins: ${pluginCount()}\n` +
                        `┃ ⚙️ Prefix: ${config.prefix}\n` +
                        `┃ 🌐 Mode: ${getVar('MODE')}\n` +
                        `┃ 📦 Version: ${config.version}\n` +
                        `╰━━━━━━━━━━━━━━━━━━━╯`
                    }
                  )
                  .catch(
                    () => {}
                  )
              }
            }
          }

          /* ======================================================
           * CONNECTION CLOSED
           * ====================================================== */

          if (
            connection === 'close'
          ) {
            const code =
              new Boom(
                lastDisconnect?.error
              )
                ?.output
                ?.statusCode

            const reason =
              Object.keys(
                DisconnectReason
              ).find(
                (key) =>
                  DisconnectReason[key] ===
                  code
              ) ||
              code

            /* ==================================================
             * LOGGED OUT
             * ================================================== */

            if (
              code ===
              DisconnectReason.loggedOut
            ) {
              log.error(
                'Logged out from WhatsApp. Clearing session - you must re-link.'
              )

              clearReconnectTimer()

              await deleteSession()

              currentSocket = null

              process.exit(0)

              return
            }

            /* ==================================================
             * BAD SESSION
             * ================================================== */

            if (
              code ===
              DisconnectReason.badSession
            ) {
              log.error(
                'Bad session reported by WhatsApp. Clearing session - you must re-link.'
              )

              clearReconnectTimer()

              await deleteSession()

              currentSocket = null

              process.exit(0)

              return
            }

            /* ==================================================
             * DO NOT RECONNECT IF ALREADY SCHEDULED
             * ================================================== */

            if (
              reconnectTimer
            ) {
              return
            }

            reconnectAttempts++

            const delay =
              Math.min(
                5000 *
                  reconnectAttempts,
                30000
              )

            log.warn(
              `Connection closed (${reason}). Reconnecting in ${
                delay / 1000
              }s...`
            )

            reconnectTimer =
              setTimeout(
                async () => {
                  reconnectTimer =
                    null

                  try {
                    await startSocket()
                  } catch (e) {
                    reconnecting = false

                    log.error(
                      `Reconnect failed: ${
                        e?.stack ||
                        e?.message ||
                        e
                      }`
                    )
                  }
                },
                delay
              )
          }
        } catch (e) {
          log.error(
            `[CONNECTION] Update handler error: ${
              e?.stack ||
              e?.message ||
              e
            }`
          )
        }
      }
    )

    /* ============================================================
     * GROUP CACHE
     * ============================================================ */

    sock.ev.on(
      'groups.update',
      async ([event]) => {
        if (!event?.id) {
          return
        }

        try {
          groupCache.set(
            event.id,
            await sock.groupMetadata(
              event.id
            )
          )
        } catch {}
      }
    )

    /* ============================================================
     * GROUP PARTICIPANTS
     * ============================================================ */

    sock.ev.on(
      'group-participants.update',
      async (event) => {
        try {
          const metadata =
            await sock.groupMetadata(
              event.id
            )

          groupCache.set(
            event.id,
            metadata
          )

          for (
            const mw of middlewares
          ) {
            if (
              typeof mw.onGroupUpdate ===
              'function'
            ) {
              try {
                await mw.onGroupUpdate({
                  sock,
                  event,
                  metadata
                })
              } catch (e) {
                log.error(
                  `[GROUP] Middleware ${
                    mw.name ||
                    'unknown'
                  } failed: ${
                    e?.message ||
                    e
                  }`
                )
              }
            }
          }
        } catch (e) {
          log.error(
            `[GROUP] Update failed: ${
              e?.message ||
              e
            }`
          )
        }
      }
    )

    /* ============================================================
     * NORMAL MESSAGES
     *
     * STATUS MESSAGES ARE NOT STORED FOR ANTI-DELETE.
     * ============================================================ */

    sock.ev.on(
      'messages.upsert',
      async ({
        messages,
        type
      }) => {
        if (
          type !== 'notify'
        ) {
          return
        }

        for (
          const raw of messages
        ) {
          if (
            !raw?.message
          ) {
            continue
          }

          const messageId =
            raw.key?.id

          const isStatus =
            raw.key?.remoteJid ===
            'status@broadcast'

          if (
            messageId &&
            !isStatus
          ) {
            messageStore.set(
              messageId,
              raw
            )
          }

          while (
            messageStore.size >
            MAX_STORE
          ) {
            const oldest =
              messageStore
                .keys()
                .next()
                .value

            if (!oldest) {
              break
            }

            messageStore.delete(
              oldest
            )
          }

          try {
            await handleMessage(
              sock,
              raw,
              {
                messageStore,
                groupCache
              }
            )
          } catch (e) {
            log.error(
              `[MESSAGE] Handler error: ${
                e?.stack ||
                e?.message ||
                e
              }`
            )
          }
        }
      }
    )

    /* ============================================================
     * ANTI-DELETE PROCESSOR
     * ============================================================ */

    const processDeletedMessage = async (
      key,
      update = {},
      source = 'unknown'
    ) => {
      try {
        if (!key?.id) {
          return
        }

        if (
          key?.remoteJid ===
          'status@broadcast'
        ) {
          return
        }

        const messageId =
          String(
            key.id
          )

        if (
          processedDeletes.has(
            messageId
          )
        ) {
          return
        }

        const storedMessage =
          messageStore.get(
            messageId
          )

        if (!storedMessage) {
          return
        }

        if (
          storedMessage?.key?.remoteJid ===
          'status@broadcast'
        ) {
          messageStore.delete(
            messageId
          )

          return
        }

        if (
          deleteHandlers.length === 0
        ) {
          return
        }

        processedDeletes.set(
          messageId,
          true
        )

        for (
          const handler of deleteHandlers
        ) {
          if (
            typeof handler.onDelete !==
            'function'
          ) {
            continue
          }

          try {
            await handler.onDelete({
              sock,
              key,
              update,
              messageStore,
              message:
                storedMessage
            })
          } catch (e) {
            log.error(
              `[ANTI-DELETE] Handler ${
                handler.name ||
                'unknown'
              } failed: ${
                e?.stack ||
                e?.message ||
                e
              }`
            )
          }
        }

        messageStore.delete(
          messageId
        )
      } catch (e) {
        log.error(
          `[ANTI-DELETE] Delete processing error: ${
            e?.stack ||
            e?.message ||
            e
          }`
        )
      }
    }

    /* ============================================================
     * MESSAGES.DELETE
     * ============================================================ */

    sock.ev.on(
      'messages.delete',
      async (event) => {
        try {
          if (
            !event ||
            !Array.isArray(
              event.keys
            )
          ) {
            return
          }

          for (
            const key of event.keys
          ) {
            await processDeletedMessage(
              key,
              {},
              'messages.delete'
            )
          }
        } catch (e) {
          log.error(
            `[ANTI-DELETE] messages.delete error: ${
              e?.stack ||
              e?.message ||
              e
            }`
          )
        }
      }
    )

    /* ============================================================
     * MESSAGES.UPDATE
     * ============================================================ */

    sock.ev.on(
      'messages.update',
      async (updates) => {
        try {
          if (
            !Array.isArray(
              updates
            )
          ) {
            return
          }

          for (
            const item of updates
          ) {
            try {
              const key =
                item?.key

              const update =
                item?.update ||
                {}

              if (!key?.id) {
                continue
              }

              if (
                key?.remoteJid ===
                'status@broadcast'
              ) {
                continue
              }

              const explicitRevoke =
                update?.message === null ||
                update?.messageStubType === 1 ||
                update?.messageStubType === 68

              if (
                explicitRevoke
              ) {
                await processDeletedMessage(
                  key,
                  update,
                  'messages.update'
                )

                continue
              }

              const isEmptyUpdate =
                Object.keys(
                  update
                ).length === 0

              if (
                isEmptyUpdate &&
                messageStore.has(
                  key.id
                )
              ) {
                await processDeletedMessage(
                  key,
                  update,
                  'messages.update(empty)'
                )
              }
            } catch (e) {
              log.error(
                `[ANTI-DELETE] Individual messages.update error: ${
                  e?.stack ||
                  e?.message ||
                  e
                }`
              )
            }
          }
        } catch (e) {
          log.error(
            `[ANTI-DELETE] messages.update error: ${
              e?.stack ||
              e?.message ||
              e
            }`
          )
        }
      }
    )

    /* ============================================================
     * CALLS
     * ============================================================ */

    sock.ev.on(
      'call',
      async (calls) => {
        if (
          !getVar(
            'REJECT_CALL'
          )
        ) {
          return
        }

        for (
          const call of calls
        ) {
          if (
            call.status !==
            'offer'
          ) {
            continue
          }

          await sock
            .rejectCall(
              call.id,
              call.from
            )
            .catch(
              () => {}
            )

          await sock
            .sendMessage(
              call.from,
              {
                text:
                  `📵 Calls are not accepted by this bot.\n` +
                  `Your ${
                    call.isVideo
                      ? 'video'
                      : 'voice'
                  } call was rejected automatically.`
              }
            )
            .catch(
              () => {}
            )
        }
      }
    )

    /* ============================================================
     * RETURN SOCKET
     * ============================================================ */

    return sock
  } catch (e) {
    /*
     * Make sure a failed startup doesn't permanently block
     * future reconnect attempts.
     */
    reconnecting = false
    currentSocket = null

    log.error(
      `[SOCKET] Failed to start: ${
        e?.stack ||
        e?.message ||
        e
      }`
    )

    throw e
  }
}

/* ============================================================
 * DEFAULT EXPORT
 * ============================================================ */

export default startSocket
```

After replacing the file, **commit/push it to GitHub and let Railway deploy**.

Your Railway Volume should remain mounted at:

```text
/app/session
```

And keep:

```env
AUTH_METHOD=pair
PAIR_NUMBER=2347036177100
SESSION_STORE=file
```

Because the old session was already logged out, this deployment should clear the **contents** of the Volume and give you a fresh pairing code. Once you pair it, the credentials will remain in the Volume instead of being deleted with `/app/session`.

**Don't delete or recreate the Volume during this process.**
