```js
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestWaWebVersion
} from 'baileys'
import fs from 'fs'
import path from 'path'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import { config } from './config.js'

let currentSocket = null
let reconnectTimer = null
let pairingTimer = null
let isStarting = false
let isShuttingDown = false

const RECONNECT_DELAY = 5000
const PAIRING_DELAY = 8000

const log = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  ok: (...args) => console.log('[OK]', ...args)
}

function ensureSessionDir() {
  fs.mkdirSync(config.sessionDir, {
    recursive: true
  })
}

function hasFileSession() {
  if (!fs.existsSync(config.sessionDir)) {
    return false
  }

  const files = fs.readdirSync(config.sessionDir)

  return files.length > 0
}

function clearFileSession() {
  ensureSessionDir()

  for (const entry of fs.readdirSync(config.sessionDir)) {
    const fullPath = path.join(config.sessionDir, entry)

    try {
      fs.rmSync(fullPath, {
        recursive: true,
        force: true
      })
    } catch (error) {
      log.warn(
        'Could not remove session item ' +
        entry +
        ': ' +
        error.message
      )
    }
  }

  log.warn('WhatsApp session files cleared.')
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function clearPairingTimer() {
  if (pairingTimer) {
    clearTimeout(pairingTimer)
    pairingTimer = null
  }
}

async function getWhatsAppVersion() {
  try {
    const result = await fetchLatestWaWebVersion()

    if (result?.version) {
      log.info(
        'Using live WhatsApp Web version: ' +
        result.version.join('.')
      )

      return result.version
    }
  } catch (error) {
    log.warn(
      'Could not fetch live WhatsApp Web version: ' +
      error.message
    )
  }

  const fallback = [2, 3000, 1047824257]

  log.warn(
    'Using fallback WhatsApp Web version: ' +
    fallback.join('.')
  )

  return fallback
}

function normalizePairNumber(number) {
  return String(number || '')
    .replace(/\D/g, '')
    .trim()
}

function getDisconnectCode(error) {
  try {
    if (error instanceof Boom) {
      return error.output?.statusCode
    }

    return error?.output?.statusCode || error?.statusCode
  } catch {
    return undefined
  }
}

function schedulePairing(sock) {
  clearPairingTimer()

  const method = String(
    process.env.AUTH_METHOD || config.authMethod || 'qr'
  ).toLowerCase()

  if (method !== 'pair') {
    return
  }

  pairingTimer = setTimeout(async () => {
    pairingTimer = null

    try {
      if (currentSocket !== sock) {
        return
      }

      if (sock.authState?.creds?.registered) {
        log.info('WhatsApp session is already registered.')
        return
      }

      const number = normalizePairNumber(
        process.env.PAIR_NUMBER || config.pairNumber
      )

      if (!number) {
        log.error(
          'PAIR_NUMBER is missing. Set PAIR_NUMBER in Railway Variables.'
        )
        return
      }

      log.info(
        'Requesting WhatsApp pairing code for +' + number
      )

      const code = await sock.requestPairingCode(number)

      log.ok('WhatsApp pairing code: ' + code)
      log.info(
        'WhatsApp → Linked Devices → Link a Device → Link with phone number instead'
      )
    } catch (error) {
      log.error(
        'Could not get a pairing code: ' +
        error.message
      )
    }
  }, PAIRING_DELAY)
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) {
    return
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null

    startSocket().catch((error) => {
      log.error(
        'Reconnect failed: ' +
        error.message
      )

      scheduleReconnect()
    })
  }, RECONNECT_DELAY)

  log.info(
    'Reconnect scheduled in ' +
    RECONNECT_DELAY +
    'ms.'
  )
}

async function startSocket() {
  if (isShuttingDown) {
    return null
  }

  if (isStarting) {
    return currentSocket
  }

  if (
    currentSocket &&
    currentSocket.ws?.isOpen
  ) {
    return currentSocket
  }

  isStarting = true

  try {
    ensureSessionDir()

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      config.sessionDir
    )

    if (hasFileSession()) {
      log.info(
        'Existing WhatsApp file session found in ' +
        config.sessionDir
      )
    } else {
      log.info(
        'No WhatsApp session found. A new authentication is required.'
      )
    }

    log.info(
      'Session store: files (' +
      config.sessionDir +
      ')'
    )

    const version = await getWhatsAppVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),

      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,

      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 250
    })

    currentSocket = sock

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

        if (qr) {
          const method = String(
            process.env.AUTH_METHOD ||
            config.authMethod ||
            'qr'
          ).toLowerCase()

          if (method === 'qr') {
            clearPairingTimer()

            console.log('')
            console.log(
              '╔══════════════════════════════════════════════╗'
            )
            console.log(
              '║          SCAN THIS QR CODE                  ║'
            )
            console.log(
              '╚══════════════════════════════════════════════╝'
            )

            qrcode.generate(qr, {
              small: true
            })

            console.log(
              'WhatsApp → Linked Devices → Link a Device'
            )
            console.log('')
          }
        }

        if (connection === 'connecting') {
          log.info(
            'Connecting to WhatsApp...'
          )
        }

        if (connection === 'open') {
          clearReconnectTimer()
          clearPairingTimer()

          log.ok(
            'Connected to WhatsApp.'
          )

          if (sock.user) {
            log.ok(
              'Connected as ' +
              (sock.user.name || 'WhatsApp User') +
              ' (' +
              sock.user.id +
              ')'
            )
          }

          currentSocket = sock
        }

        if (connection === 'close') {
          clearPairingTimer()

          const code = getDisconnectCode(
            lastDisconnect?.error
          )

          log.warn(
            'WhatsApp connection closed. Code: ' +
            String(code)
          )

          if (currentSocket === sock) {
            currentSocket = null
          }

          if (code === DisconnectReason.loggedOut) {
            log.error(
              'WhatsApp logged out. Clearing session files.'
            )

            clearReconnectTimer()
            clearFileSession()

            scheduleReconnect()
            return
          }

          if (code === DisconnectReason.badSession) {
            log.error(
              'Bad WhatsApp session. Clearing session files.'
            )

            clearReconnectTimer()
            clearFileSession()

            scheduleReconnect()
            return
          }

          if (
            code === DisconnectReason.connectionReplaced
          ) {
            log.warn(
              'WhatsApp session was replaced by another connection.'
            )

            scheduleReconnect()
            return
          }

          if (
            code === DisconnectReason.restartRequired
          ) {
            log.info(
              'WhatsApp requested a restart.'
            )

            scheduleReconnect()
            return
          }

          scheduleReconnect()
        }

        if (
          !state.creds.registered &&
          connection !== 'open'
        ) {
          const method = String(
            process.env.AUTH_METHOD ||
            config.authMethod ||
            'qr'
          ).toLowerCase()

          if (method === 'pair') {
            schedulePairing(sock)
          }
        }
      }
    )

    const method = String(
      process.env.AUTH_METHOD ||
      config.authMethod ||
      'qr'
    ).toLowerCase()

    if (
      method !== 'pair' &&
      !state.creds.registered
    ) {
      log.info(
        'Authentication method: QR code'
      )
    }

    if (
      method === 'pair' &&
      !state.creds.registered
    ) {
      log.info(
        'Authentication method: pairing code'
      )

      schedulePairing(sock)
    }

    return sock
  } finally {
    isStarting = false
  }
}

function getSocket() {
  return currentSocket
}

async function stopSocket() {
  isShuttingDown = true

  clearReconnectTimer()
  clearPairingTimer()

  if (currentSocket) {
    try {
      currentSocket.ws?.close()
    } catch (error) {
      log.warn(
        'Could not close WhatsApp socket: ' +
        error.message
      )
    }
  }

  currentSocket = null
}

export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
