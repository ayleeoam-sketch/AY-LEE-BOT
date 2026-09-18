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
import QRCode from 'qrcode'

import { config } from './config.js'

console.log('AY-LEE CONNECTION.JS LOADED - QR IMAGE VERSION')

let currentSocket = null
let reconnectTimer = null
let pairingTimer = null
let isStarting = false
let isShuttingDown = false

const RECONNECT_DELAY = 5000
const PAIRING_DELAY = 10000

const QR_FILE = '/app/qr.png'

const log = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  ok: (...args) => console.log('[OK]', ...args)
}

/* =========================================
   SESSION
========================================= */

function ensureSessionDir() {
  fs.mkdirSync(config.sessionDir, {
    recursive: true
  })
}

function hasFileSession() {
  ensureSessionDir()

  try {
    return fs.readdirSync(config.sessionDir).length > 0
  } catch {
    return false
  }
}

/*
 * IMPORTANT:
 * Never delete /app/session itself.
 * Railway Volume is mounted there.
 */
function clearFileSession() {
  ensureSessionDir()

  try {
    const entries = fs.readdirSync(config.sessionDir)

    for (const entry of entries) {
      const target = path.join(
        config.sessionDir,
        entry
      )

      try {
        fs.rmSync(target, {
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

    log.warn('WhatsApp session contents cleared.')
  } catch (error) {
    log.error(
      'Could not clear session contents: ' +
      error.message
    )
  }
}

/* =========================================
   QR FILE
========================================= */

async function saveQRCode(qr) {
  try {
    await QRCode.toFile(
      QR_FILE,
      qr,
      {
        width: 1000,
        margin: 4,
        errorCorrectionLevel: 'H'
      }
    )

    log.ok(
      'QR code image created: ' +
      QR_FILE
    )

    console.log('')
    console.log(
      '╔══════════════════════════════════════════════╗'
    )
    console.log(
      '║              QR CODE READY                  ║'
    )
    console.log(
      '╚══════════════════════════════════════════════╝'
    )
    console.log('')
    console.log(
      'QR image: ' + QR_FILE
    )
    console.log('')
    console.log(
      'You can also use the terminal QR below:'
    )
    console.log('')
  } catch (error) {
    log.error(
      'Could not create QR image: ' +
      error.message
    )
  }
}

function removeQRCode() {
  try {
    if (fs.existsSync(QR_FILE)) {
      fs.rmSync(QR_FILE, {
        force: true
      })

      log.info('Old QR code removed.')
    }
  } catch (error) {
    log.warn(
      'Could not remove old QR code: ' +
      error.message
    )
  }
}

/* =========================================
   TIMERS
========================================= */

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

/* =========================================
   WHATSAPP VERSION
========================================= */

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

  const fallbackVersion = [
    2,
    3000,
    1047824257
  ]

  log.warn(
    'Using fallback WhatsApp Web version: ' +
    fallbackVersion.join('.')
  )

  return fallbackVersion
}

/* =========================================
   HELPERS
========================================= */

function normalizePhoneNumber(number) {
  return String(number || '')
    .replace(/\D/g, '')
    .trim()
}

function getAuthMethod() {
  return String(
    process.env.AUTH_METHOD ||
    config.authMethod ||
    'qr'
  ).toLowerCase()
}

function getDisconnectCode(error) {
  try {
    if (error instanceof Boom) {
      return error.output?.statusCode
    }

    return (
      error?.output?.statusCode ||
      error?.statusCode ||
      undefined
    )
  } catch {
    return undefined
  }
}

/* =========================================
   PAIRING CODE
========================================= */

function schedulePairing(sock) {
  clearPairingTimer()

  if (getAuthMethod() !== 'pair') {
    return
  }

  pairingTimer = setTimeout(async () => {
    pairingTimer = null

    try {
      if (currentSocket !== sock) {
        return
      }

      if (sock.authState?.creds?.registered) {
        return
      }

      const phoneNumber = normalizePhoneNumber(
        process.env.PAIR_NUMBER ||
        config.pairNumber
      )

      if (!phoneNumber) {
        log.error(
          'PAIR_NUMBER is empty.'
        )

        return
      }

      log.info(
        'Requesting WhatsApp pairing code for +' +
        phoneNumber
      )

      const code =
        await sock.requestPairingCode(
          phoneNumber
        )

      console.log('')
      console.log(
        '╔══════════════════════════════════════════════╗'
      )
      console.log(
        '║          WHATSAPP PAIRING CODE              ║'
      )
      console.log(
        '╚══════════════════════════════════════════════╝'
      )
      console.log('')
      console.log(
        'PAIRING CODE: ' + code
      )
      console.log('')
      console.log(
        'WhatsApp → Linked Devices → Link with phone number instead'
      )
      console.log('')
    } catch (error) {
      log.error(
        'Could not get pairing code: ' +
        error.message
      )
    }
  }, PAIRING_DELAY)
}

/* =========================================
   RECONNECT
========================================= */

function scheduleReconnect() {
  if (isShuttingDown) {
    return
  }

  if (reconnectTimer) {
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

/* =========================================
   START SOCKET
========================================= */

async function startSocket() {
  if (isShuttingDown) {
    return null
  }

  if (isStarting) {
    return currentSocket
  }

  if (currentSocket) {
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
        'No WhatsApp session found.'
      )
    }

    log.info(
      'Session store: files (' +
      config.sessionDir +
      ')'
    )

    const version =
      await getWhatsAppVersion()

    const socket = makeWASocket({
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

    currentSocket = socket

    socket.ev.on(
      'creds.update',
      saveCreds
    )

    socket.ev.on(
      'connection.update',
      async (update) => {
        const {
          connection,
          lastDisconnect,
          qr
        } = update

        /* =================================
           NEW QR CODE
        ================================= */

        if (
          qr &&
          getAuthMethod() === 'qr'
        ) {
          clearPairingTimer()

          await saveQRCode(qr)
        }

        /* =================================
           CONNECTING
        ================================= */

        if (connection === 'connecting') {
          log.info(
            'Connecting to WhatsApp...'
          )
        }

        /* =================================
           OPEN
        ================================= */

        if (connection === 'open') {
          clearReconnectTimer()
          clearPairingTimer()

          removeQRCode()

          log.ok(
            'WhatsApp connection established.'
          )

          if (socket.user) {
            log.ok(
              'Connected as ' +
              (
                socket.user.name ||
                'WhatsApp User'
              ) +
              ' (' +
              socket.user.id +
              ')'
            )
          }

          currentSocket = socket
        }

        /* =================================
           CLOSE
        ================================= */

        if (connection === 'close') {
          clearPairingTimer()

          const code =
            getDisconnectCode(
              lastDisconnect?.error
            )

          log.warn(
            'WhatsApp connection closed. Code: ' +
            String(code)
          )

          if (currentSocket === socket) {
            currentSocket = null
          }

          if (
            code ===
            DisconnectReason.loggedOut
          ) {
            log.error(
              'WhatsApp logged out.'
            )

            clearReconnectTimer()

            clearFileSession()

            scheduleReconnect()

            return
          }

          if (
            code ===
            DisconnectReason.badSession
          ) {
            log.error(
              'WhatsApp reported a bad session.'
            )

            clearReconnectTimer()

            clearFileSession()

            scheduleReconnect()

            return
          }

          if (
            code ===
            DisconnectReason.connectionReplaced
          ) {
            log.warn(
              'WhatsApp connection was replaced.'
            )

            scheduleReconnect()

            return
          }

          if (
            code ===
            DisconnectReason.restartRequired
          ) {
            log.info(
              'WhatsApp requested a restart.'
            )

            scheduleReconnect()

            return
          }

          scheduleReconnect()
        }

        /* =================================
           PAIRING
        ================================= */

        if (
          !state.creds.registered &&
          getAuthMethod() === 'pair' &&
          connection !== 'open'
        ) {
          schedulePairing(socket)
        }
      }
    )

    /* =================================
       AUTH METHOD
    ================================= */

    if (!state.creds.registered) {
      if (getAuthMethod() === 'pair') {
        log.info(
          'Authentication method: PAIRING CODE'
        )

        schedulePairing(socket)
      } else {
        log.info(
          'Authentication method: QR CODE'
        )

        log.info(
          'Waiting for QR code...'
        )
      }
    } else {
      log.info(
        'Saved WhatsApp session detected.'
      )

      log.info(
        'Reusing saved session from ' +
        config.sessionDir
      )
    }

    return socket
  } catch (error) {
    currentSocket = null

    log.error(
      'Failed to start WhatsApp socket: ' +
      error.message
    )

    throw error
  } finally {
    isStarting = false
  }
}

/* =========================================
   GET SOCKET
========================================= */

function getSocket() {
  return currentSocket
}

/* =========================================
   STOP SOCKET
========================================= */

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

/* =========================================
   EXPORTS
========================================= */

export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
