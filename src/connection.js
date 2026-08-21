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
            'Bad session reported by WhatsApp. Clearing session - you must re-link.'
          )

          await deleteSession()

          process.exit(0)
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

        /*
         * Store the complete original message.
         */
        messageStore.set(
          raw.key.id,
          raw
        )

        /*
         * Keep memory under control.
         */
        if (
          messageStore.size >
          MAX_STORE
        ) {
          const oldest =
            messageStore
              .keys()
              .next()
              .value

          messageStore.delete(
            oldest
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
   * DELETE EVENTS / ANTI-DELETE
   * ============================================================ */

  sock.ev.on(
    'messages.update',
    async (updates) => {
      /*
       * IMPORTANT:
       * Log every update temporarily so we can verify
       * that WhatsApp is sending the revoke event.
       */
      for (
        const item of updates
      ) {
        const key =
          item?.key || {}

        const update =
          item?.update || {}

        /*
         * WhatsApp/Baileys can represent deletion
         * in more than one way.
         */
        const isRevoke =
          update?.message === null ||
          update?.message === undefined &&
          (
            update?.messageStubType === 1 ||
            update?.messageStubType === 2
          ) ||
          update?.messageStubType === 1 ||
          update?.messageStubType === 2

        /*
         * Only process actual revoke events.
         */
        if (!isRevoke)
          continue

        console.log(
          '[ANTI-DELETE] Delete event detected:',
          {
            id: key.id,
            remoteJid: key.remoteJid,
            participant: key.participant,
            messageStubType:
              update?.messageStubType
          }
        )

        /*
         * Check whether the original message exists.
         */
        const original =
          messageStore.get(
            key.id
          )

        if (!original) {
          console.log(
            `[ANTI-DELETE] Original message not found in messageStore: ${key.id}`
          )

          continue
        }

        console.log(
          `[ANTI-DELETE] Original message found: ${key.id}`
        )

        /*
         * Send event to every middleware/plugin
         * that implements onDelete().
         */
        for (
          const mw of middlewares
        ) {
          if (
            typeof mw.onDelete !==
            'function'
          )
            continue

          try {
            await mw.onDelete({
              sock,
              key,
              update,
              messageStore
            })
          } catch (e) {
            console.error(
              `[ANTI-DELETE] Middleware error: ${e.message}`
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
```
