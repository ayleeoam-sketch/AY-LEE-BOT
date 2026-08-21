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
 *
 * Stores original messages so anti-delete handlers can recover
 * them after WhatsApp sends a revoke/delete event.
 * ============================================================ */

const messageStore = new Map()

/*
 * Keep this reasonably large, but don't allow unlimited memory
 * usage.
 */
const MAX_STORE = 10000

/* ============================================================
 * DELETE EVENT DEDUPLICATION
 *
 * WhatsApp/Baileys can sometimes expose the same deletion through
 * both messages.delete and messages.update.
 *
 * This prevents the anti-delete handler from sending the same
 * recovered message twice.
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
 * RECONNECT
 * ============================================================ */

let reconnectAttempts = 0

/* ============================================================
 * START SOCKET
 * ============================================================ */

export async function startSocket() {
  let state
  let saveCreds
  let deleteSession

  /* ============================================================
   * SESSION DIRECTORY
   * ============================================================ */

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

          if (
            !parsed?.me &&
            !parsed?.noiseKey
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

  /* ============================================================
   * SESSION STORE
   * ============================================================ */

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
      try {
        fs.rmSync(
          config.sessionDir,
          {
            recursive: true,
            force: true
          }
        )

        fs.mkdirSync(
          config.sessionDir,
          {
            recursive: true
          }
        )

        log.warn(
          `File session cleared: ${config.sessionDir}`
        )
      } catch (e) {
        log.error(
          `Could not clear file session: ${e.message}`
        )
      }
    }

    log.info(
      `Session store: files (${config.sessionDir})`
    )
  }

  /* ============================================================
   * WHATSAPP VERSION
   * ============================================================ */

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

  /* ============================================================
   * PAIRING
   * ============================================================ */

  const usePairing =
    config.authMethod === 'pair' &&
    !state.creds.registered

  /* ============================================================
   * SOCKET
   * ============================================================ */

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

      /* ========================================================
       * MESSAGE RECOVERY
       * ======================================================== */

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

  /* ============================================================
   * PAIRING CODE
   * ============================================================ */

  if (usePairing) {
    let number =
      config.pairNumber

    if (!number) {
      number =
        (
          await ask(
            '\n📱 Enter your WhatsApp number (country code, no +): '
          )
        ).replace(
          /[^0-9]/g,
          ''
        )
    }

    setTimeout(
      async () => {
        try {
          const custom =
            config.pairCustomCode &&
            /^[A-Z0-9]{8}$/.test(
              config.pairCustomCode
            )
              ? config.pairCustomCode
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
║   PAIRING CODE:  ${pretty.padEnd(20)}║
╚══════════════════════════════════════╝
WhatsApp > Settings > Linked devices > Link with phone number
`)
        } catch (e) {
          log.error(
            `Could not get a pairing code: ${e.message}`
          )
        }
      },
      3000
    )
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
          `Failed to save WhatsApp credentials: ${e.message}`
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
      const {
        connection,
        lastDisconnect,
        qr
      } = update

      /* ========================================================
       * QR
       * ======================================================== */

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

      /* ========================================================
       * CONNECTING
       * ======================================================== */

      if (
        connection === 'connecting'
      ) {
        log.info(
          'Connecting to WhatsApp...'
        )
      }

      /* ========================================================
       * OPEN
       * ======================================================== */

      if (
        connection === 'open'
      ) {
        reconnectAttempts = 0

        const me =
          jidNormalizedUser(
            sock.user?.id || ''
          )

        log.ok(
          `Connected as ${
            sock.user?.name || 'bot'
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

        /* ======================================================
         * STARTUP MESSAGE
         * ====================================================== */

        if (
          getVar(
            'STARTUP_MESSAGE'
          )
        ) {
          const owner =
            config.ownerNumbers?.[0]

          if (owner) {
            const ownerJid =
              owner.includes('@')
                ? owner
                : `${String(owner).replace(/\D/g, '')}@s.whatsapp.net`

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

      /* ========================================================
       * CONNECTION CLOSED
       * ======================================================== */

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

        /* ======================================================
         * LOGGED OUT
         * ====================================================== */

        if (
          code ===
          DisconnectReason.loggedOut
        ) {
          log.error(
            'Logged out from WhatsApp. Clearing session - you must re-link.'
          )

          await deleteSession()

          process.exit(0)
        }

        /* ======================================================
         * BAD SESSION
         * ====================================================== */

        if (
          code ===
          DisconnectReason.badSession
        ) {
          log.error(
            'Bad session reported by WhatsApp. Clearing session - you must re-link.'
          )

          await deleteSession()

          process.exit(0)
        }

        /* ======================================================
         * RECONNECT
         * ====================================================== */

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

        setTimeout(
          () => {
            startSocket()
              .catch(
                (e) =>
                  log.error(
                    `Reconnect failed: ${e.message}`
                  )
              )
          },
          delay
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
   * IMPORTANT:
   * Store the complete raw message BEFORE handleMessage().
   *
   * NO per-message log here.
   *
   * This is important for Railway because logging every incoming
   * message can very quickly exceed the platform log limit.
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

        /* ======================================================
         * STORE MESSAGE
         * ====================================================== */

        if (messageId) {
          messageStore.set(
            messageId,
            raw
          )
        }

        /* ======================================================
         * LIMIT STORE
         * ====================================================== */

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

        /* ======================================================
         * NORMAL MESSAGE HANDLER
         * ====================================================== */

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

      const messageId =
        String(
          key.id
        )

      /* ========================================================
       * DEDUPLICATE DELETE EVENTS
       *
       * messages.delete and messages.update can represent the
       * same deletion.
       * ======================================================== */

      if (
        processedDeletes.has(
          messageId
        )
      ) {
        return
      }

      /* ========================================================
       * FIND ORIGINAL MESSAGE
       * ======================================================== */

      const storedMessage =
        messageStore.get(
          messageId
        )

      if (!storedMessage) {
        /*
         * Don't log every miss.
         *
         * A missing message is expected sometimes because:
         * - bot joined later
         * - message was received before restart
         * - message was not decryptable
         * - store was already evicted
         * - WhatsApp generated an event for another device
         */
        return
      }

      /* ========================================================
       * CHECK HANDLERS
       * ======================================================== */

      if (
        deleteHandlers.length === 0
      ) {
        return
      }

      /*
       * Mark before running handlers.
       *
       * This prevents duplicate processing if another delete event
       * arrives while the first handler is still running.
       */
      processedDeletes.set(
        messageId,
        true
      )

      /* ========================================================
       * RUN DELETE HANDLERS
       * ======================================================== */

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

      /*
       * Optional cleanup.
       *
       * We can remove the original after successful processing.
       * The message itself has already been supplied to the
       * anti-delete handlers.
       */
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
   *
   * Primary revoke/delete listener.
   *
   * Official shape:
   *
   * {
   *   keys: WAMessageKey[]
   * }
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
   *
   * Some Baileys versions can expose revoke/delete activity here.
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

            /* ==================================================
             * EXPLICIT REVOKE INDICATORS
             * ================================================== */

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

            /* ==================================================
             * EMPTY UPDATE
             *
             * Only treat an empty update as a possible deletion
             * when the message actually exists in our store.
             *
             * This is intentionally quiet to avoid log spam.
             * ================================================== */

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
}

/* ============================================================
 * DEFAULT EXPORT
 * ============================================================ */

export default startSocket
