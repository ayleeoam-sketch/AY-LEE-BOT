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
  loadPlugins,
  middlewares,
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

const messageStore = new Map()
const MAX_STORE = 3000

/* ============================================================
 * INPUT
 * ============================================================ */

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.question(q, (ans) => {
      rl.close()
      resolve(ans.trim())
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
  /* ============================================================
   * AUTH STATE
   *
   * IMPORTANT:
   * Railway file sessions must live on a persistent Volume.
   *
   * We DO NOT restore SESSION_ID over an existing file session.
   * The files inside config.sessionDir are the source of truth.
   * ============================================================ */

  let state
  let saveCreds
  let deleteSession

  /* ============================================================
   * SESSION DIRECTORY
   * ============================================================ */

  if (config.sessionStore !== 'mongo') {
    fs.mkdirSync(config.sessionDir, {
      recursive: true
    })

    const credsPath = path.join(
      config.sessionDir,
      'creds.json'
    )

    /*
     * SESSION_ID is ONLY used as a first-time bootstrap.
     *
     * If Railway Volume already contains creds.json,
     * NEVER overwrite it with SESSION_ID.
     */

    if (!fs.existsSync(credsPath)) {
      if (config.sessionId?.trim()) {
        try {
          const raw = Buffer
            .from(
              config.sessionId.trim(),
              'base64'
            )
            .toString('utf8')

          const parsed = JSON.parse(raw)

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
          /*
           * Do not destroy anything if SESSION_ID is bad.
           * The bot can still start and request pairing.
           */
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

  if (config.sessionStore === 'mongo') {
    const auth =
      await useMongoAuthState('default')

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
     * Only clear the local session when WhatsApp
     * explicitly says the account is logged out
     * or the session is genuinely bad.
     */
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

  /*
   * Pair only when the loaded credentials are not registered.
   */
  const usePairing =
    config.authMethod === 'pair' &&
    !state.creds.registered

  /* ============================================================
   * SOCKET
   * ============================================================ */

  const sock = makeWASocket({
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

    browser: usePairing
      ? Browsers.ubuntu('Chrome')
      : Browsers.macOS('Safari'),

    markOnlineOnConnect:
      getVar('ALWAYS_ONLINE') ?? false,

    generateHighQualityLinkPreview:
      true,

    syncFullHistory: false,

    msgRetryCounterCache,

    cachedGroupMetadata:
      async (jid) =>
        groupCache.get(jid),

    getMessage:
      async (key) =>
        messageStore.get(
          key.id
        )?.message || undefined
  })

  /* ============================================================
   * PAIRING CODE
   * ============================================================ */

  if (usePairing) {
    let number = config.pairNumber

    if (!number) {
      number = (
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
   *
   * This is VERY important for Railway.
   *
   * Every credential update is written to the
   * persistent session directory.
   * ============================================================ */

  sock.ev.on(
    'creds.update',
    async (...args) => {
      try {
        await saveCreds(...args)
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
            await sock
              .sendMessage(
                `${owner}@s.whatsapp.net`,
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
            (k) =>
              DisconnectReason[k] ===
              code
          ) || code

        /* ======================================================
         * LOGGED OUT
         *
         * This is permanent. The session must be linked again.
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
         *
         * Only clear when WhatsApp explicitly reports badSession.
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
         * NORMAL RECONNECT
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
          () =>
            startSocket()
              .catch(
                (e) =>
                  log.error(
                    `Reconnect failed: ${e.message}`
                  )
              ),
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
      if (!event?.id)
        return

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
            await mw
              .onGroupUpdate({
                sock,
                event,
                metadata
              })
              .catch(
                () => {}
              )
          }
        }
      } catch {}
    }
  )

  /* ============================================================
   * MESSAGES
   * ============================================================ */

  sock.ev.on(
    'messages.upsert',
    async ({
      messages,
      type
    }) => {
      if (
        type !== 'notify'
      )
        return

      for (
        const raw of messages
      ) {
        if (
          !raw.message
        )
          continue

        messageStore.set(
          raw.key.id,
          raw
        )

        if (
          messageStore.size >
          MAX_STORE
        ) {
          messageStore.delete(
            messageStore
              .keys()
              .next()
              .value
          )
        }

        await handleMessage(
          sock,
          raw,
          {
            messageStore,
            groupCache
          }
        )
      }
    }
  )

  /* ============================================================
   * DELETE EVENTS
   * ============================================================ */

  sock.ev.on(
    'messages.update',
    async (updates) => {
      for (
        const {
          key,
          update
        } of updates
      ) {
        const isRevoke =
          update?.message ===
            null ||
          update?.messageStubType ===
            1

        if (!isRevoke)
          continue

        for (
          const mw of middlewares
        ) {
          if (
            typeof mw.onDelete ===
            'function'
          ) {
            await mw
              .onDelete({
                sock,
                key,
                messageStore
              })
              .catch(
                () => {}
              )
          }
        }
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
      )
        return

      for (
        const call of calls
      ) {
        if (
          call.status !==
          'offer'
        )
          continue

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

  return sock
}

export default startSocket