```js
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestWaWebVersion
} from 'baileys'

import fs from 'fs'
import path from 'path'
import qrcode from 'qrcode-terminal'
import { Boom } from '@hapi/boom'

import config from '../config.js'

const log = {
  info: (...args) => console.log('[INFO]', ...args),
  ok: (...args) => console.log('[OK]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
}

let currentSocket = null
let reconnectTimer = null
let pairingTimer = null
let isStarting = false
let isShuttingDown = false

const RECONNECT_DELAY = 5000
const PAIRING_DELAY = 3000

/* =========================================================
   SESSION
   ========================================================= */

function ensureSessionDir() {
  fs.mkdirSync(config.sessionDir, {
    recursive: true
  })
}

function hasFileSession() {
  ensureSessionDir()

  try {
    return fs.readdirSync(config.sessionDir).length > 0
  } catch (error) {
    log.warn(
      '[SESSION] Could not inspect session:',
      error.message
    )

    return false
  }
}

async function clearFileSession() {
  ensureSessionDir()

  try {
    const entries = fs.readdirSync(config.sessionDir)

    for (const entry of entries) {
      const fullPath = path.join(
        config.sessionDir,
        entry
      )

      try {
        fs.rmSync(fullPath, {
          recursive: true,
          force: true
        })

        log.info(
          '[SESSION] Removed:',
          entry
        )
      } catch (error) {
        log.warn(
          '[SESSION] Could not remove ' +
            entry +
            ': ' +
            error.message
        )
      }
    }

    log.info(
      '[SESSION] Session contents cleared.'
    )

    log.info(
      '[SESSION] Volume mount preserved:',
      config.sessionDir
    )
  } catch (error) {
    log.error(
      '[SESSION] Could not clear session:',
      error.message
    )
  }
}

/* =========================================================
   TIMERS
   ========================================================= */

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

/* =========================================================
   VERSION
   ========================================================= */

async function getWhatsAppVersion() {
  try {
    log.info(
      'Fetching current WhatsApp Web version...'
    )

    const result =
      await fetchLatestWaWebVersion()

    if (result?.version) {
      log.info(
        'Using live WhatsApp Web version:',
        result.version.join('.')
      )

      return result.version
    }
  } catch (error) {
    log.warn(
      'Could not fetch live WhatsApp Web version:',
      error.message
    )
  }

  const fallback = [
    2,
    3000,
    1047824257
  ]

  log.warn(
    'Using fallback WhatsApp Web version:',
    fallback.join('.')
  )

  return fallback
}

/* =========================================================
   HELPERS
   ========================================================= */

function normalizePhone(number) {
  return String(number || '')
    .replace(/\D/g, '')
}

function getDisconnectCode(error) {
  try {
    return (
      new Boom(error)?.output?.statusCode ||
      null
    )
  } catch {
    return null
  }
}

/* =========================================================
   PAIRING CODE
   ========================================================= */

function schedulePairing(sock, state) {
  clearPairingTimer()

  const method = String(
    config.authMethod || 'pair'
  ).toLowerCase()

  if (
    method !== 'pair' ||
    state.creds.registered
  ) {
    return
  }

  pairingTimer = setTimeout(
    async () => {
      pairingTimer = null

      if (currentSocket !== sock) {
        return
      }

      if (state.creds.registered) {
        return
      }

      const phoneNumber =
        normalizePhone(
          config.pairNumber
        )

      if (!phoneNumber) {
        log.error(
          '[AUTH] Invalid PAIR_NUMBER.'
        )

        return
      }

      try {
        log.info(
          '[AUTH] Requesting pairing code...'
        )

        let code

        const customCode = String(
          config.pairCustomCode || ''
        )
          .trim()
          .toUpperCase()

        if (customCode) {
          code =
            await sock.requestPairingCode(
              phoneNumber,
              customCode
            )
        } else {
          code =
            await sock.requestPairingCode(
              phoneNumber
            )
        }

        console.log('')
        console.log(
          '=========================================='
        )
        console.log(
          '        AY-LEE BOT PAIRING CODE'
        )
        console.log(
          '=========================================='
        )
        console.log(
          '        ' + code
        )
        console.log(
          '=========================================='
        )
        console.log('')

        console.log(
          'WhatsApp → Settings → Linked Devices'
        )

        console.log(
          '→ Link a Device → Link with phone number instead'
        )

        console.log('')

      } catch (error) {
        log.error(
          '[AUTH] Pairing code failed:',
          error.message
        )

        /*
         * Retry while this socket is still active.
         */
        if (
          currentSocket === sock &&
          !state.creds.registered
        ) {
          schedulePairing(
            sock,
            state
          )
        }
      }
    },
    PAIRING_DELAY
  )
}

/* =========================================================
   RECONNECT
   ========================================================= */

function scheduleReconnect() {
  if (isShuttingDown) {
    return
  }

  if (reconnectTimer) {
    return
  }

  reconnectTimer = setTimeout(
    async () => {
      reconnectTimer = null

      try {
        await startSocket()
      } catch (error) {
        log.error(
          '[RECONNECT] Failed:',
          error.message
        )

        scheduleReconnect()
      }
    },
    RECONNECT_DELAY
  )
}

/* =========================================================
   START SOCKET
   ========================================================= */

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

    if (hasFileSession()) {
      log.info(
        'Existing WhatsApp file session found in',
        config.sessionDir
      )
    } else {
      log.info(
        'No WhatsApp file session found.'
      )
    }

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      config.sessionDir
    )

    log.info(
      'Session store: files (' +
        config.sessionDir +
        ')'
    )

    const version =
      await getWhatsAppVersion()

    const method = String(
      config.authMethod || 'pair'
    ).toLowerCase()

    const qrMode =
      method === 'qr' ||
      method === 'qrcode'

    const pairMode =
      method === 'pair'

    if (state.creds.registered) {
      log.info(
        '[AUTH] Saved WhatsApp session found.'
      )

      log.info(
        '[AUTH] Reusing saved session.'
      )
    } else if (qrMode) {
      log.info(
        '[AUTH] QR authentication required.'
      )
    } else if (pairMode) {
      log.info(
        '[AUTH] Pairing-code authentication required.'
      )
    }

    const sock = makeWASocket({
      version,

      auth: state,

      browser:
        Browsers.ubuntu('Chrome'),

      printQRInTerminal: false,

      markOnlineOnConnect: false,

      syncFullHistory: false,

      generateHighQualityLinkPreview:
        true,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 25000,

      retryRequestDelayMs: 250
    })

    currentSocket = sock

    /* =====================================================
       SAVE CREDENTIALS
       ===================================================== */

    sock.ev.on(
      'creds.update',
      async () => {
        try {
          await saveCreds()
        } catch (error) {
          log.error(
            '[AUTH] Could not save credentials:',
            error.message
          )
        }
      }
    )

    /* =====================================================
       CONNECTION EVENTS
       ===================================================== */

    sock.ev.on(
      'connection.update',
      async update => {
        const {
          connection,
          lastDisconnect,
          qr
        } = update

        /* -----------------------------------------------
           QR
           ----------------------------------------------- */

        if (
          qr &&
          qrMode &&
          !state.creds.registered
        ) {
          console.log('')
          console.log(
            '=========================================='
          )
          console.log(
            '             SCAN THIS QR CODE'
          )
          console.log(
            '=========================================='
          )

          try {
            qrcode.generate(
              qr,
              {
                small: true
              }
            )
          } catch (error) {
            log.error(
              '[QR] Failed to display QR:',
              error.message
            )
          }

          console.log('')
          console.log(
            'WhatsApp → Settings → Linked Devices'
          )
          console.log(
            '→ Link a Device → Scan the QR code'
          )
          console.log('')
        }

        /* -----------------------------------------------
           CONNECTING
           ----------------------------------------------- */

        if (
          connection === 'connecting'
        ) {
          log.info(
            'Connecting to WhatsApp...'
          )

          if (
            pairMode &&
            !state.creds.registered
          ) {
            schedulePairing(
              sock,
              state
            )
          }
        }

        /* -----------------------------------------------
           OPEN
           ----------------------------------------------- */

        if (
          connection === 'open'
        ) {
          clearReconnectTimer()
          clearPairingTimer()

          log.ok(
            'Connected to WhatsApp.'
          )

          if (sock.user?.id) {
            log.ok(
              'Connected as:',
              sock.user.name ||
                sock.user.verifiedName ||
                sock.user.id
            )
          }

          log.ok(
            'AY-LEE BOT WhatsApp connection ready.'
          )
        }

        /* -----------------------------------------------
           CLOSE
           ----------------------------------------------- */

        if (
          connection === 'close'
        ) {
          clearPairingTimer()

          const code =
            getDisconnectCode(
              lastDisconnect?.error
            )

          log.error(
            '[WHATSAPP DISCONNECT] Code:',
            code
          )

          if (
            lastDisconnect?.error
          ) {
            log.error(
              '[WHATSAPP DISCONNECT] Error:',
              lastDisconnect.error
            )
          }

          currentSocket = null

          /* -------------------------------------------
             LOGGED OUT
             ------------------------------------------- */

          if (
            code ===
            DisconnectReason.loggedOut
          ) {
            log.error(
              '[WHATSAPP] Account was logged out.'
            )

            await clearFileSession()

            log.info(
              '[WHATSAPP] Starting fresh authentication...'
            )

            scheduleReconnect()

            return
          }

          /* -------------------------------------------
             BAD SESSION
             ------------------------------------------- */

          if (
            code ===
            DisconnectReason.badSession
          ) {
            log.error(
              '[WHATSAPP] Bad session detected.'
            )

            await clearFileSession()

            log.info(
              '[WHATSAPP] Starting fresh authentication...'
            )

            scheduleReconnect()

            return
          }

          /* -------------------------------------------
             CONNECTION REPLACED
             ------------------------------------------- */

          if (
            code ===
            DisconnectReason.connectionReplaced
          ) {
            log.warn(
              '[WHATSAPP] Connection replaced.'
            )

            scheduleReconnect()

            return
          }

          /* -------------------------------------------
             OTHER CONNECTION FAILURE
             ------------------------------------------- */

          log.warn(
            '[WHATSAPP] Connection lost.'
          )

          scheduleReconnect()
        }
      }
    )

    /*
     * Pairing backup.
     */
    if (
      pairMode &&
      !state.creds.registered
    ) {
      schedulePairing(
        sock,
        state
      )
    }

    log.info(
      'WhatsApp socket initialized.'
    )

    return sock

  } catch (error) {
    currentSocket = null

    log.error(
      '[WHATSAPP] Failed to initialize socket:',
      error
    )

    scheduleReconnect()

    return null

  } finally {
    isStarting = false
  }
}

/* =========================================================
   GET SOCKET
   ========================================================= */

function getSocket() {
  return currentSocket
}

/* =========================================================
   STOP SOCKET
   ========================================================= */

async function stopSocket() {
  isShuttingDown = true

  clearReconnectTimer()
  clearPairingTimer()

  const sock = currentSocket

  currentSocket = null

  if (!sock) {
    return
  }

  try {
    sock.end(
      new Error(
        'AY-LEE BOT shutting down'
      )
    )
  } catch (error) {
    log.warn(
      '[WHATSAPP] Could not close socket:',
      error.message
    )
  }
}

/* =========================================================
   REQUIRED EXPORTS
   ========================================================= */

export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
