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
import { setConnected, touchMessage } from './lib/keepalive.js'
import { attachScheduler } from './lib/scheduler.js'
import { attachSchool } from './lib/school.js'
import { attachCleanup } from './lib/cleanup.js'
import { useMongoAuthState } from './lib/mongoAuth.js'
import { getVar } from './lib/vars.js'
import { handleMessage, isCommandCleanup } from './handler.js'
import { loadPlugins, middlewares, pluginCount } from './lib/pluginLoader.js'

/*
 * ============================================================
 * GROUP METADATA CACHE
 * ============================================================
 *
 * WhatsApp rate-limits repeated groupMetadata() requests.
 *
 * Keep metadata in memory and let Baileys use this cache when
 * it needs group information for sending messages.
 */
const groupCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  useClones: false
})

/*
 * Prevent multiple simultaneous requests for the same group.
 *
 * If 20 messages arrive at once and metadata is missing, we
 * don't want 20 groupMetadata() requests.
 */
const groupMetadataRequests = new Map()

async function getGroupMetadata(sock, jid, options = {}) {
  if (!jid) return null

  const force = options.force === true

  if (!force) {
    const cached = groupCache.get(jid)

    if (cached) {
      return cached
    }
  }

  /*
   * If another request for this group is already running,
   * wait for that same request instead of making another one.
   */
  if (groupMetadataRequests.has(jid)) {
    return groupMetadataRequests.get(jid)
  }

  const request = (async () => {
    try {
      const metadata = await sock.groupMetadata(jid)

      if (metadata) {
        groupCache.set(jid, metadata)
      }

      return metadata || null
    } catch (error) {
      /*
       * Rate-limit errors are expected occasionally.
       * Do not spam the Render log with the same error.
       */
      const message = error?.message || String(error)

      if (!message.includes('rate-overlimit')) {
        log.warn(`Group metadata failed for ${jid}: ${message}`)
      }

      /*
       * If an older cache entry exists, use it.
       */
      const old = groupCache.get(jid)

      return old || null
    } finally {
      groupMetadataRequests.delete(jid)
    }
  })()

  groupMetadataRequests.set(jid, request)

  return request
}

/*
 * Baileys can use this directly whenever it needs group metadata.
 */
const cachedGroupMetadata = async (jid) => {
  return groupCache.get(jid) || undefined
}

const msgRetryCounterCache = new NodeCache()

/** in-memory message cache so Baileys can resend failed messages */
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
  /* ------------------------- auth state ------------------------- */

  let state
  let saveCreds
  let deleteSession

  /*
   * SESSION_ID support.
   */
  if (config.sessionId) {
    const credsPath = path.join(
      config.sessionDir,
      'creds.json'
    )

    if (!fs.existsSync(credsPath)) {
      try {
        const raw = Buffer.from(
          config.sessionId.trim(),
          'base64'
        ).toString('utf-8')

        const parsed = JSON.parse(raw)

        if (!parsed?.me && !parsed?.noiseKey) {
          throw new Error('missing expected fields')
        }

        fs.mkdirSync(
          config.sessionDir,
          { recursive: true }
        )

        fs.writeFileSync(
          credsPath,
          raw
        )

        log.ok('Session restored from SESSION_ID')
      } catch (e) {
        log.error(
          `SESSION_ID is not valid: ${e.message}`
        )

        log.warn(
          'Falling back to QR / pairing login.'
        )
      }
    }
  }

  /* ------------------------- auth storage ------------------------- */

  if (config.sessionStore === 'mongo') {
    const auth = await useMongoAuthState(
      config.botId || 'default'
    )

    state = auth.state
    saveCreds = auth.saveCreds
    deleteSession = auth.deleteSession

    log.info(
      'Session store: MongoDB (survives redeploys)'
    )
  } else {
    if (!fs.existsSync(config.sessionDir)) {
      fs.mkdirSync(
        config.sessionDir,
        { recursive: true }
      )
    }

    const auth = await useMultiFileAuthState(
      config.sessionDir
    )

    state = auth.state
    saveCreds = auth.saveCreds

    deleteSession = async () =>
      fs.rmSync(
        config.sessionDir,
        {
          recursive: true,
          force: true
        }
      )

    log.info(
      `Session store: files (${config.sessionDir})`
    )
  }

  const {
    version,
    isLatest
  } = await fetchLatestBaileysVersion()

  log.info(
    `WhatsApp Web v${version.join('.')} ${
      isLatest ? '(latest)' : '(outdated)'
    }`
  )

  const usePairing =
    config.authMethod === 'pair' &&
    !state.creds.registered

  /* -------------------------- socket -------------------------- */

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

    /*
     * IMPORTANT:
     *
     * Baileys will read group metadata from our cache
     * instead of repeatedly asking WhatsApp.
     */
    cachedGroupMetadata,

    getMessage: async (key) =>
      messageStore.get(key.id)?.message ||
      undefined
  })

  /* --------------------- pairing code login --------------------- */

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
            ?.join('-') || code

        log.banner(`
╔══════════════════════════════════════╗
║   PAIRING CODE:  ${pretty.padEnd(20)}║
╚══════════════════════════════════════╝
WhatsApp > Settings > Linked devices > Link with phone number
`)
      } catch (e) {
        log.error(
          'Could not get a pairing code:',
          e.message
        )
      }
    }, 3000)
  }

  /* ------------------------- events ------------------------- */

  sock.ev.on(
    'creds.update',
    saveCreds
  )

  sock.ev.on(
    'connection.update',
    async (update) => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update

      if (qr && !usePairing) {
        log.info(
          'Scan this QR with WhatsApp > Linked devices:\n'
        )

        qrcode.generate(
          qr,
          { small: true }
        )
      }

      if (connection === 'connecting') {
        log.info(
          'Connecting to WhatsApp...'
        )
      }

      if (connection === 'open') {
        reconnectAttempts = 0

        setConnected(true)

        attachScheduler(sock)
        attachSchool(sock)
        attachCleanup()

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

        if (getVar('STARTUP_MESSAGE')) {
          const owner =
            config.ownerNumbers[0]

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

      if (connection === 'close') {
        setConnected(false)

        const code =
          new Boom(
            lastDisconnect?.error
          )?.output?.statusCode

        const reason =
          Object.keys(
            DisconnectReason
          ).find(
            (k) =>
              DisconnectReason[k] === code
          ) || code

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

        if (
          code ===
          DisconnectReason.badSession
        ) {
          log.error(
            'Bad session file. Clearing session - you must re-link.'
          )

          await deleteSession()

          process.exit(0)
        }

        reconnectAttempts++

        const delay =
          Math.min(
            5000 * reconnectAttempts,
            30000
          )

        log.warn(
          `Connection closed (${reason}). Reconnecting in ${delay / 1000}s...`
        )

        setTimeout(
          () =>
            startSocket().catch(
              (e) =>
                log.error(
                  'Reconnect failed:',
                  e.message
                )
            ),
          delay
        )
      }
    }
  )

  /*
   * ============================================================
   * GROUP EVENTS
   * ============================================================
   *
   * IMPORTANT:
   *
   * These events update the cache, but we DO NOT immediately
   * call groupMetadata() for every event.
   *
   * That was one of the causes of rate-overlimit.
   */

  sock.ev.on(
    'groups.update',
    async (events) => {
      for (const event of events || []) {
        if (!event?.id) continue

        /*
         * Only update the cache if we already have metadata.
         *
         * Do NOT force a WhatsApp metadata request here.
         */
        const cached =
          groupCache.get(event.id)

        if (cached) {
          groupCache.set(
            event.id,
            {
              ...cached,
              ...event
            }
          )
        }
      }
    }
  )

  sock.ev.on(
    'group-participants.update',
    async (event) => {
      if (!event?.id) return

      /*
       * Use cached metadata first.
       */
      let metadata =
        groupCache.get(event.id)

      /*
       * If metadata is not cached, make ONE request.
       * Multiple simultaneous requests are automatically
       * collapsed by getGroupMetadata().
       */
      if (!metadata) {
        metadata =
          await getGroupMetadata(
            sock,
            event.id
          )
      }

      if (!metadata) return

      /*
       * Update participants locally where possible.
       */
      const participants =
        Array.isArray(
          metadata.participants
        )
          ? [...metadata.participants]
          : []

      for (const participant of
        event.participants || []) {

        const index =
          participants.findIndex(
            (p) =>
              p.id === participant ||
              p.jid === participant
          )

        if (
          event.action === 'remove'
        ) {
          if (index !== -1) {
            participants.splice(
              index,
              1
            )
          }
        } else if (index === -1) {
          /*
           * We don't know the complete participant
           * object, so leave the cache unchanged.
           *
           * The next normal metadata request can refresh it.
           */
        }
      }

      /*
       * Keep existing metadata.
       */
      groupCache.set(
        event.id,
        {
          ...metadata,
          participants
        }
      )

      /*
       * Let plugins react to joins/leaves.
       */
      for (const mw of middlewares) {
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
            .catch(() => {})
        }
      }
    }
  )

  /* ---------------- incoming messages ---------------- */

  sock.ev.on(
    'messages.upsert',
    async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const raw of messages) {
        if (!raw.message) continue

        touchMessage()

        /*
         * Remember for retries + anti-delete.
         */
        messageStore.set(
          raw.key.id,
          raw
        )

        if (
          messageStore.size >
          MAX_STORE
        ) {
          messageStore.delete(
            messageStore.keys()
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

  /* ---------------- deletions ---------------- */

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

        if (isRevoke) {
          if (
            isCommandCleanup(key)
          ) {
            continue
          }

          for (const mw of middlewares) {
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
                .catch(() => {})
            }
          }

          continue
        }

        /*
         * Edited messages.
         */
        const edited =
          update?.message
            ?.editedMessage
            ?.message ||
          update?.message
            ?.protocolMessage
            ?.editedMessage

        if (edited) {
          for (const mw of middlewares) {
            if (
              typeof mw.onEdit ===
              'function'
            ) {
              await mw
                .onEdit({
                  sock,
                  key,
                  edited,
                  messageStore
                })
                .catch(() => {})
            }
          }
        }
      }
    }
  )

  /* ---------------- incoming calls ---------------- */

  sock.ev.on(
    'call',
    async (calls) => {
      if (
        !getVar('REJECT_CALL')
      ) {
        return
      }

      for (const call of calls) {
        if (
          call.status !== 'offer'
        ) {
          continue
        }

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