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
import { loadPlugins, middlewares, pluginCount } from './lib/pluginLoader.js'

const groupCache = new NodeCache({ stdTTL: 300, useClones: false })
const msgRetryCounterCache = new NodeCache()

const messageStore = new Map()
const MAX_STORE = 3000

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

let reconnectAttempts = 0

export async function startSocket() {
  /* ------------------------- AUTH STATE ------------------------- */

  let state
  let saveCreds
  let deleteSession

  /*
   * Restore SESSION_ID before creating the WhatsApp socket.
   *
   * SESSION_ID is a base64 encoded creds.json.
   */
  if (config.sessionId && config.sessionStore !== 'mongo') {
    try {
      const credsPath = path.join(config.sessionDir, 'creds.json')

      if (!fs.existsSync(credsPath)) {
        const raw = Buffer
          .from(config.sessionId.trim(), 'base64')
          .toString('utf8')

        const parsed = JSON.parse(raw)

        if (!parsed?.me && !parsed?.noiseKey) {
          throw new Error('SESSION_ID does not contain valid WhatsApp credentials')
        }

        fs.mkdirSync(config.sessionDir, { recursive: true })
        fs.writeFileSync(credsPath, raw)

        log.ok('SESSION_ID restored successfully')
      }
    } catch (e) {
      log.error(`Could not restore SESSION_ID: ${e.message}`)
    }
  }

  /* ------------------------- SESSION STORE ------------------------- */

  if (config.sessionStore === 'mongo') {
    const auth = await useMongoAuthState('default')

    state = auth.state
    saveCreds = auth.saveCreds
    deleteSession = auth.deleteSession

    log.info('Session store: MongoDB (survives redeploys)')
  } else {
    if (!fs.existsSync(config.sessionDir)) {
      fs.mkdirSync(config.sessionDir, { recursive: true })
    }

    const auth = await useMultiFileAuthState(config.sessionDir)

    state = auth.state
    saveCreds = auth.saveCreds

    deleteSession = async () => {
      fs.rmSync(config.sessionDir, {
        recursive: true,
        force: true
      })
    }

    log.info(`Session store: files (${config.sessionDir})`)
  }

  /* ------------------------- WHATSAPP VERSION ------------------------- */

  const { version, isLatest } = await fetchLatestBaileysVersion()

  log.info(
    `WhatsApp Web v${version.join('.')} ${
      isLatest ? '(latest)' : '(outdated)'
    }`
  )

  /*
   * Only use pairing when there is no registered session.
   */
  const usePairing =
    config.authMethod === 'pair' &&
    !state.creds.registered

  /* ------------------------- SOCKET ------------------------- */

  const sock = makeWASocket({
    version,

    logger: waLogger,

    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        waLogger
      )
    },

    browser: usePairing
      ? Browsers.ubuntu('Chrome')
      : Browsers.macOS('Safari'),

    markOnlineOnConnect:
      getVar('ALWAYS_ONLINE') ?? false,

    generateHighQualityLinkPreview: true,

    syncFullHistory: false,

    msgRetryCounterCache,

    cachedGroupMetadata: async (jid) =>
      groupCache.get(jid),

    getMessage: async (key) =>
      messageStore.get(key.id)?.message || undefined
  })

  /* ------------------------- PAIRING CODE ------------------------- */

  if (usePairing) {
    let number = config.pairNumber

    if (!number) {
      number = (
        await ask(
          '\n📱 Enter your WhatsApp number (country code, no +): '
        )
      ).replace(/[^0-9]/g, '')
    }

    setTimeout(async () => {
      try {
        const custom =
          config.pairCustomCode &&
          /^[A-Z0-9]{8}$/.test(config.pairCustomCode)
            ? config.pairCustomCode
            : undefined

        const code = await sock.requestPairingCode(
          number,
          custom
        )

        const pretty =
          code?.match(/.{1,4}/g)?.join('-') || code

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
    }, 3000)
  }

  /* ------------------------- EVENTS ------------------------- */

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on(
    'connection.update',
    async (update) => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update

      /*
       * QR should ONLY appear when there is no registered session
       * and pairing mode is not being used.
       */
      if (qr && !usePairing && !state.creds.registered) {
        log.info(
          'Scan this QR with WhatsApp > Linked devices:\n'
        )

        qrcode.generate(qr, {
          small: true
        })
      }

      if (connection === 'connecting') {
        log.info('Connecting to WhatsApp...')
      }

      if (connection === 'open') {
        reconnectAttempts = 0

        const me = jidNormalizedUser(
          sock.user?.id || ''
        )

        log.ok(
          `Connected as ${sock.user?.name || 'bot'} (${me.split('@')[0]})`
        )

        log.ok(
          `${pluginCount()} plugins ready | prefix "${config.prefix}" | mode ${getVar('MODE')}`
        )

        if (getVar('STARTUP_MESSAGE')) {
          const owner = config.ownerNumbers[0]

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
              .catch(() => {})
          }
        }
      }

      /* ------------------------- CONNECTION CLOSED ------------------------- */

      if (connection === 'close') {
        const code =
          new Boom(lastDisconnect?.error)
            ?.output?.statusCode

        const reason =
          Object.keys(DisconnectReason).find(
            (k) => DisconnectReason[k] === code
          ) || code

        if (code === DisconnectReason.loggedOut) {
          log.error(
            'Logged out from WhatsApp. Clearing session - you must re-link.'
          )

          await deleteSession()
          process.exit(0)
        }

        if (code === DisconnectReason.badSession) {
          log.error(
            'Bad session file. Clearing session - you must re-link.'
          )

          await deleteSession()
          process.exit(0)
        }

        reconnectAttempts++

        const delay = Math.min(
          5000 * reconnectAttempts,
          30000
        )

        log.warn(
          `Connection closed (${reason}). Reconnecting in ${
            delay / 1000
          }s...`
        )

        setTimeout(
          () =>
            startSocket().catch((e) =>
              log.error(
                `Reconnect failed: ${e.message}`
              )
            ),
          delay
        )
      }
    }
  )

  /* ------------------------- GROUP CACHE ------------------------- */

  sock.ev.on(
    'groups.update',
    async ([event]) => {
      if (!event?.id) return

      try {
        groupCache.set(
          event.id,
          await sock.groupMetadata(event.id)
        )
      } catch {}
    }
  )

  sock.ev.on(
    'group-participants.update',
    async (event) => {
      try {
        const metadata =
          await sock.groupMetadata(event.id)

        groupCache.set(
          event.id,
          metadata
        )

        for (const mw of middlewares) {
          if (
            typeof mw.onGroupUpdate ===
            'function'
          ) {
            await mw.onGroupUpdate({
              sock,
              event,
              metadata
            }).catch(() => {})
          }
        }
      } catch {}
    }
  )

  /* ------------------------- MESSAGES ------------------------- */

  sock.ev.on(
    'messages.upsert',
    async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const raw of messages) {
        if (!raw.message) continue

        messageStore.set(
          raw.key.id,
          raw
        )

        if (
          messageStore.size >
          MAX_STORE
        ) {
          messageStore.delete(
            messageStore.keys().next().value
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

  /* ------------------------- DELETE EVENTS ------------------------- */

  sock.ev.on(
    'messages.update',
    async (updates) => {
      for (const {
        key,
        update
      } of updates) {
        const isRevoke =
          update?.message === null ||
          update?.messageStubType === 1

        if (!isRevoke) continue

        for (const mw of middlewares) {
          if (
            typeof mw.onDelete ===
            'function'
          ) {
            await mw.onDelete({
              sock,
              key,
              messageStore
            }).catch(() => {})
          }
        }
      }
    }
  )

  /* ------------------------- CALLS ------------------------- */

  sock.ev.on(
    'call',
    async (calls) => {
      if (!getVar('REJECT_CALL')) return

      for (const call of calls) {
        if (call.status !== 'offer') continue

        await sock
          .rejectCall(
            call.id,
            call.from
          )
          .catch(() => {})

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
          .catch(() => {})
      }
    }
  )

  return sock
}

export default startSocket