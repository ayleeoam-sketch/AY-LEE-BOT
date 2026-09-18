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

/* =========================================================
   AY-LEE BOT
   WhatsApp Connection Manager

   AUTH_METHOD=qr
   AUTH_METHOD=pair

   Railway Volume:
   /app/session
   ========================================================= */

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
    const entries = fs.readdirSync(
      config.sessionDir
    )

    return entries.length > 0
  } catch (error) {
    log.warn(
      '[SESSION] Could not inspect session directory:',
      error.message
    )

    return false
  }
}

/*
 * IMPORTANT:
 * Never remove /app/session itself.
 * It is the Railway Volume mount.
 *
 * Only remove the contents.
 */
async function clearFileSession() {
  ensureSessionDir()

  try {
    const entries = fs.readdirSync(
      config.sessionDir
    )

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
   WHATSAPP WEB VERSION
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
   PHONE NUMBER
   ========================================================= */

function normalizePairNumber(number) {
  return String(number || '')
    .replace(/\D/g, '')
}

/* =========================================================
   DISCONNECT CODE
   ========================================================= */

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

  if (
    String(
      config.authMethod || 'pair'
    ).toLowerCase() !== 'pair'
  ) {
    return
  }

  if (state.creds.registered) {
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
        normalizePairNumber(
          config.pairNumber
        )

      if (!phoneNumber) {
        log.error(
          '[AUTH] PAIR_NUMBER is empty or invalid.'
        )

        return
      }

      try {
        log.info(
          '[AUTH] Requesting WhatsApp pairing code...'
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

        log.info('')
        log.info(
          '=========================================='
        )
        log.info(
          '          AY-LEE BOT PAIRING CODE'
        )
        log.info(
          '=========================================='
        )
        log.info(
          '          ' + code
        )
        log.info(
          '=========================================='
        )
        log.info('')
        log.info(
          'WhatsApp → Settings → Linked Devices'
        )
        log.info(
          '→ Link a Device → Link with phone number instead'
        )
        log.info('')

      } catch (error) {
        log.error(
          '[AUTH] Pairing code request failed:',
          error.message
        )

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
    () => {
      reconnectTimer = null

      startSocket().catch(
        error => {
          log.error(
            '[RECONNECT] Failed:',
            error.message
          )

          scheduleReconnect()
        }
      )
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

    const sessionExists =
      hasFileSession()

    if (sessionExists) {
      log.info(
        'Existing WhatsApp file session found in',
        config.sessionDir
      )
    } else {
      log.info(
        'No WhatsApp file session found.'
      )

      log.info(
        'Fresh authentication will be required.'
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

    const authMethod =
      String(
        config.authMethod || 'pair'
      ).toLowerCase()

    const useQR =
      authMethod === 'qr' ||
      authMethod === 'qrcode'

    const usePair =
      !useQR

    if (state.creds.registered) {
      log.info(
        '[AUTH] Registered WhatsApp session found.'
      )

      log.info(
        '[AUTH] Reusing saved authentication.'
      )
    } else if (useQR) {
      log.info(
        '[AUTH] No registered WhatsApp account found.'
      )

      log.info(
        '[AUTH] QR code authentication required.'
      )
    } else {
      log.info(
        '[AUTH] No registered WhatsApp account found.'
      )

      log.info(
        '[AUTH] Pairing code authentication required.'
      )
    }

    const sock = makeWASocket({
      version,

      auth: state,

      /*
       * Keep the browser configuration compatible
       * with both QR and pairing authentication.
       */
      browser:
        Browsers.macOS('Chrome'),

      /*
       * We display QR ourselves through qrcode-terminal.
       */
      printQRInTerminal: false,

      markOnlineOnConnect:
        config.alwaysOnline === true,

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
            '[AUTH] Failed to save credentials:',
            error.message
          )
        }
      }
    )

    /* =====================================================
       CONNECTION UPDATE
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
           QR CODE
           ----------------------------------------------- */

        if (
          qr &&
          useQR &&
          !state.creds.registered
        ) {
          log.info('')
          log.info(
            '=========================================='
          )
          log.info(
            '             SCAN THIS QR CODE'
          )
          log.info(
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
              '[QR] Could not display QR code:',
              error.message
            )
          }

          log.info('')
          log.info(
            'WhatsApp → Settings → Linked Devices'
          )
          log.info(
            '→ Link a Device → Scan the QR code'
          )
          log.info('')
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
            usePair &&
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

          try {
            const user =
              sock.user

            if (user?.id) {
              log.ok(
                'Connected as:',
                user.name ||
                  user.verifiedName ||
                  user.id
              )
            }
          } catch {
            // Ignore user information errors.
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

            log.warn(
              '[WHATSAPP] Clearing old authentication files.'
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

            log.warn(
              '[WHATSAPP] Clearing authentication files.'
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
              '[WHATSAPP] Connection replaced by another device.'
            )

            scheduleReconnect()

            return
          }

          /* -------------------------------------------
             TEMPORARY CONNECTION LOSS
             ------------------------------------------- */

          log.warn(
            '[WHATSAPP] Connection lost.'
          )

          log.info(
            '[WHATSAPP] Reconnecting...'
          )

          scheduleReconnect()
        }
      }
    )

    /* =====================================================
       PAIRING CODE BACKUP
       ===================================================== */

    if (
      usePair &&
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
      'Failed to start WhatsApp socket:',
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
      'Could not close WhatsApp socket:',
      error.message
    )
  }
}

/* =========================================================
   EXPORTS
   ========================================================= */

export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
