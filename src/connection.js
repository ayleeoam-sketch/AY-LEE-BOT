import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
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
 * DELETE DEDUPE
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
 * PAIRING STATE
 * ============================================================ */

let pairingTimer = null
let pairingRequested = false

/* ============================================================
 * NUMBER CLEANER
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
 * CLEAR PAIRING TIMER
 * ============================================================ */

function clearPairingTimer() {
  if (pairingTimer) {
    clearTimeout(pairingTimer)
    pairingTimer = null
  }
}

/* ============================================================
 * CLEAR FILE SESSION SAFELY
 *
 * IMPORTANT:
 * NEVER DELETE /app/session ITSELF.
 *
 * Railway Volume is mounted there.
 * We only delete the contents.
 * ============================================================ */

function clearFileSession(sessionDir) {
  try {
    fs.mkdirSync(sessionDir, {
      recursive: true
    })

    const entries = fs.readdirSync(
      sessionDir,
      {
        withFileTypes: true
      }
    )

    for (const entry of entries) {
      const target = path.join(
        sessionDir,
        entry.name
      )

      try {
        fs.rmSync(target, {
          recursive: true,
          force: true
        })
      } catch (e) {
        log.warn(
          'Could not remove session item: ' +
          entry.name
        )
      }
    }

    log.warn(
      'File session contents cleared: ' +
      sessionDir
    )

    return true
  } catch (e) {
    log.error(
      'Could not clear file session: ' +
      e.message
    )

    return false
  }
}

/* ============================================================
 * GET WHATSAPP WEB VERSION
 *
 * Priority:
 *
 * 1. Live WhatsApp Web version
 * 2. Baileys published version
 * 3. Last-resort fallback
 *
 * The live WhatsApp Web version is preferred because
 * Baileys' own fetched version can sometimes lag behind
 * Meta's current Web revision.
 * ============================================================ */

async function getWhatsAppVersion() {
  try {
    if (
      typeof fetchLatestWaWebVersion ===
      'function'
    ) {
      log.info(
        'Fetching current WhatsApp Web version...'
      )

      const result =
        await fetchLatestWaWebVersion()

      if (
        result?.version &&
        Array.isArray(result.version) &&
        result.version.length === 3
      ) {
        log.info(
          'Using live WhatsApp Web version: ' +
          result.version.join('.')
        )

        return result.version
      }
    }
  } catch (e) {
    log.warn(
      'Could not fetch live WhatsApp Web version: ' +
      (
        e?.message ||
        e
      )
    )
  }

  /* ========================================================
   * BAILEYS FALLBACK
   * ======================================================== */

  try {
    log.info(
      'Trying Baileys WhatsApp Web version...'
    )

    const result =
      await fetchLatestBaileysVersion()

    if (
      result?.version &&
      Array.isArray(result.version) &&
      result.version.length === 3
    ) {
      log.info(
        'Using Baileys version: ' +
        result.version.join('.') +
        (
          result.isLatest
            ? ' (latest according to Baileys)'
            : ''
        )
      )

      return result.version
    }
  } catch (e) {
    log.warn(
      'Could not fetch Baileys version: ' +
      (
        e?.message ||
        e
      )
    )
  }

  /* ========================================================
   * LAST RESORT
   * ======================================================== */

  const fallback = [
    2,
    3000,
    1034074495
  ]

  log.warn(
    'Using fallback WhatsApp Web version: ' +
    fallback.join('.')
  )

  return fallback
}

/* ============================================================
 * START SOCKET
 * ============================================================ */

export async function startSocket() {
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
     * RESET PAIRING STATE FOR NEW SOCKET
     * ======================================================== */

    clearPairingTimer()
    pairingRequested = false

    /* ========================================================
     * SESSION DIRECTORY
     * ======================================================== */

    if (
      config.sessionStore !== 'mongo'
    ) {
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

      if (
        !fs.existsSync(credsPath)
      ) {
        if (
          config.sessionId?.trim()
        ) {
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

            if (
              !parsed ||
              typeof parsed !== 'object'
            ) {
              throw new Error(
                'Invalid SESSION_ID data'
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
              'SESSION_ID bootstrap skipped: ' +
              e.message
            )
          }
        } else {
          log.info(
            'No existing file session found'
          )
        }
      } else {
        log.info(
          'Existing WhatsApp file session found in ' +
          config.sessionDir
        )
      }
    }

    /* ========================================================
     * AUTH STATE
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

      deleteSession = async () => {
        clearFileSession(
          config.sessionDir
        )
      }

      log.info(
        'Session store: files (' +
        config.sessionDir +
        ')'
      )
    }

    /* ========================================================
     * WHATSAPP VERSION
     * ======================================================== */

    const version =
      await getWhatsAppVersion()

    /* ========================================================
     * PAIRING MODE
     * ======================================================== */

    const usePairing =
      config.authMethod === 'pair' &&
      !state.creds.registered

    if (usePairing) {
      log.info(
        'Pairing mode enabled for +' +
        cleanPhoneNumber(
          config.pairNumber
        )
      )
    }

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
          Browsers.ubuntu('Chrome'),

        markOnlineOnConnect:
          getVar(
            'ALWAYS_ONLINE'
          ) ?? false,

        generateHighQualityLinkPreview:
          true,

        syncFullHistory:
          false,

        msgRetryCounterCache,

        cachedGroupMetadata:
          async (jid) =>
            groupCache.get(jid),

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

    /* ========================================================
     * CREDENTIAL SAVE
     * ======================================================== */

    sock.ev.on(
      'creds.update',
      async (...args) => {
        try {
          await saveCreds(
            ...args
          )
        } catch (e) {
          log.error(
            'Failed to save WhatsApp credentials: ' +
            (
              e?.message ||
              e
            )
          )
        }
      }
    )

    /* ========================================================
     * CONNECTION UPDATE
     * ======================================================== */

    sock.ev.on(
      'connection.update',
      async (update) => {
        try {
          const {
            connection,
            lastDisconnect,
            qr
          } = update

          /* ==================================================
           * QR
           * ================================================== */

          if (
            qr &&
            !usePairing &&
            !state.creds.registered
          ) {
            log.info(
              'Scan this QR with WhatsApp > Linked devices:'
            )

            qrcode.generate(
              qr,
              {
                small: true
              }
            )
          }

          /* ==================================================
           * CONNECTING
           * ================================================== */

          if (
            connection === 'connecting'
          ) {
            log.info(
              'Connecting to WhatsApp...'
            )
          }

          /* ==================================================
           * OPEN
           * ================================================== */

          if (
            connection === 'open'
          ) {
            reconnectAttempts = 0

            clearReconnectTimer()
            clearPairingTimer()

            pairingRequested = false

            const me =
              jidNormalizedUser(
                sock.user?.id || ''
              )

            log.ok(
              'Connected as ' +
              (
                sock.user?.name ||
                'bot'
              ) +
              ' (' +
              me.split('@')[0] +
              ')'
            )

            log.ok(
              pluginCount() +
              ' plugins ready | prefix "' +
              config.prefix +
              '" | mode ' +
              getVar('MODE')
            )

            log.ok(
              'Anti-delete handlers: ' +
              deleteHandlers.length
            )

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
                    : cleanPhoneNumber(
                        owner
                      ) +
                      '@s.whatsapp.net'

                await sock
                  .sendMessage(
                    ownerJid,
                    {
                      text:
                        '╭━━━〔 *' +
                        config.botName +
                        '* 〕━━━╮\n' +
                        '┃ ✅ Bot is online\n' +
                        '┃ 🔌 Plugins: ' +
                        pluginCount() +
                        '\n' +
                        '┃ ⚙️ Prefix: ' +
                        config.prefix +
                        '\n' +
                        '┃ 🌐 Mode: ' +
                        getVar('MODE') +
                        '\n' +
                        '┃ 📦 Version: ' +
                        config.version +
                        '\n' +
                        '╰━━━━━━━━━━━━━━━━━━━╯'
                    }
                  )
                  .catch(
                    () => {}
                  )
              }
            }
          }

          /* ==================================================
           * CLOSED
           * ================================================== */

          if (
            connection === 'close'
          ) {
            clearPairingTimer()

            pairingRequested = false

            const disconnectError =
              lastDisconnect?.error

            const boomError =
              disconnectError
                ? new Boom(
                    disconnectError
                  )
                : null

            const code =
              boomError?.output?.statusCode

            log.error(
              '[WHATSAPP DISCONNECT] Code: ' +
              String(code)
            )

            log.error(
              '[WHATSAPP DISCONNECT] Error: ' +
              (
                disconnectError?.stack ||
                disconnectError?.message ||
                String(disconnectError)
              )
            )

            const reason =
              Object.keys(
                DisconnectReason
              ).find(
                (key) =>
                  DisconnectReason[key] ===
                  code
              ) ||
              code

            log.error(
              '[WHATSAPP DISCONNECT] Reason: ' +
              String(reason)
            )

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

              log.warn(
                'Session cleared. Railway will restart the bot for fresh pairing.'
              )

              process.exit(1)

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

              log.warn(
                'Bad session cleared. Railway will restart the bot for fresh pairing.'
              )

              process.exit(1)

              return
            }

            /* ==================================================
             * RECONNECT
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
              'Connection closed (' +
              reason +
              '). Reconnecting in ' +
              (
                delay / 1000
              ) +
              's...'
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
                      'Reconnect failed: ' +
                      (
                        e?.stack ||
                        e?.message ||
                        e
                      )
                    )
                  }
                },
                delay
              )
          }
        } catch (e) {
          log.error(
            '[CONNECTION] Update handler error: ' +
            (
              e?.stack ||
              e?.message ||
              e
            )
          )
        }
      }
    )

    /* ========================================================
     * PAIRING CODE
     *
     * IMPORTANT:
     * We wait for the socket to actually reach
     * "open" before requesting the code.
     *
     * This prevents:
     *
     * Connection Closed
     * requestPairingCode()
     * ======================================================== */

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
        const requestPairingCode =
          async () => {
            if (
              pairingRequested
            ) {
              return
            }

            if (
              !currentSocket ||
              currentSocket !== sock
            ) {
              log.warn(
                'Pairing skipped because this socket is no longer active.'
              )

              return
            }

            if (
              state.creds.registered
            ) {
              return
            }

            try {
              /*
               * Check whether the socket is still usable.
               */

              log.info(
                'Preparing WhatsApp pairing code for +' +
                number
              )

              pairingRequested = true

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

              if (!code) {
                pairingRequested = false

                log.error(
                  'WhatsApp returned an empty pairing code.'
                )

                return
              }

              const pretty =
                String(code)
                  .match(/.{1,4}/g)
                  ?.join('-') ||
                String(code)

              log.banner(
                '\n' +
                '╔══════════════════════════════════════╗\n' +
                '║   PAIRING CODE:  ' +
                String(pretty).padEnd(20) +
                '║\n' +
                '╚══════════════════════════════════════╝\n' +
                'WhatsApp > Settings > Linked devices > Link with phone number\n'
              )

              log.info(
                'Pairing code generated for +' +
                number
              )
            } catch (e) {
              pairingRequested = false

              log.error(
                'Could not get a pairing code: ' +
                (
                  e?.stack ||
                  e?.message ||
                  e
                )
              )
            }
          }

        /*
         * Pairing code should be requested after the
         * initial WebSocket handshake has had time to
         * settle.
         *
         * If the socket dies before this timer fires,
         * connection.update will cancel the timer.
         */

        pairingTimer =
          setTimeout(
            async () => {
              pairingTimer = null

              /*
               * Do NOT request pairing if the socket
               * is already gone.
               */

              if (
                !currentSocket ||
                currentSocket !== sock
              ) {
                log.warn(
                  'Pairing code request cancelled because socket is no longer active.'
                )

                return
              }

              await requestPairingCode()
            },
            12000
          )
      }
    }

    /* ========================================================
     * GROUP CACHE
     * ======================================================== */

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

    /* ========================================================
     * GROUP PARTICIPANTS
     * ======================================================== */

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
                  '[GROUP] Middleware ' +
                  (
                    mw.name ||
                    'unknown'
                  ) +
                  ' failed: ' +
                  (
                    e?.message ||
                    e
                  )
                )
              }
            }
          }
        } catch (e) {
          log.error(
            '[GROUP] Update failed: ' +
            (
              e?.message ||
              e
            )
          )
        }
      }
    )

    /* ========================================================
     * MESSAGES
     * ======================================================== */

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
              '[MESSAGE] Handler error: ' +
              (
                e?.stack ||
                e?.message ||
                e
              )
            )
          }
        }
      }
    )

    /* ========================================================
     * ANTI DELETE
     * ======================================================== */

    const processDeletedMessage =
      async (
        key,
        update = {},
        source = 'unknown'
      ) => {
        try {
          if (!key?.id) {
            return
          }

          if (
            key.remoteJid ===
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
                '[ANTI-DELETE] Handler ' +
                (
                  handler.name ||
                  'unknown'
                ) +
                ' failed: ' +
                (
                  e?.stack ||
                  e?.message ||
                  e
                )
              )
            }
          }

          messageStore.delete(
            messageId
          )
        } catch (e) {
          log.error(
            '[ANTI-DELETE] Delete processing error: ' +
            (
              e?.stack ||
              e?.message ||
              e
            )
          )
        }
      }

    /* ========================================================
     * DELETE EVENTS
     * ======================================================== */

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
            '[ANTI-DELETE] messages.delete error: ' +
            (
              e?.stack ||
              e?.message ||
              e
            )
          )
        }
      }
    )

    /* ========================================================
     * MESSAGE UPDATES
     * ======================================================== */

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
                key.remoteJid ===
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
                '[ANTI-DELETE] Individual update error: ' +
                (
                  e?.message ||
                  e
                )
              )
            }
          }
        } catch (e) {
          log.error(
            '[ANTI-DELETE] messages.update error: ' +
            (
              e?.stack ||
              e?.message ||
              e
            )
          )
        }
      }
    )

    /* ========================================================
     * CALL REJECTION
     * ======================================================== */

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
                  '📵 Calls are not accepted by this bot.\n' +
                  'Your ' +
                  (
                    call.isVideo
                      ? 'video'
                      : 'voice'
                  ) +
                  ' call was rejected automatically.'
              }
            )
            .catch(
              () => {}
            )
        }
      }
    )

    /* ========================================================
     * RETURN
     * ======================================================== */

    return sock

  } catch (e) {
    reconnecting = false
    currentSocket = null

    clearPairingTimer()

    log.error(
      '[SOCKET] Failed to start: ' +
      (
        e?.stack ||
        e?.message ||
        e
      )
    )

    throw e
  }
}

/* ============================================================
 * DEFAULT EXPORT
 * ============================================================ */

export default startSocket
