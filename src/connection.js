import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion
} from 'baileys'

import fs from 'fs'
import path from 'path'
import { Boom } from '@hapi/boom'

import config from './config.js'
import { log } from './logger.js'

let currentSocket = null
let reconnectTimer = null
let pairingTimer = null
let isStarting = false
let isShuttingDown = false

const RECONNECT_DELAY = 5000
const PAIRING_DELAY = 12000

/**
 * ---------------------------------------------------------
 * SESSION DIRECTORY
 * ---------------------------------------------------------
 *
 * Railway Volume:
 *   /app/session
 *
 * IMPORTANT:
 * Never remove /app/session itself.
 * Only remove its contents.
 */
function ensureSessionDir() {
  fs.mkdirSync(config.sessionDir, {
    recursive: true
  })
}

/**
 * Clear only the files/directories INSIDE the session folder.
 *
 * This is safe for a Railway mounted Volume because the
 * mount point itself is never removed.
 */
function clearFileSession() {
  ensureSessionDir()

  try {
    const entries = fs.readdirSync(config.sessionDir)

    for (const entry of entries) {
      const fullPath = path.join(config.sessionDir, entry)

      try {
        fs.rmSync(fullPath, {
          recursive: true,
          force: true
        })

        log.info(
          '[SESSION] Removed session item: ' + entry
        )
      } catch (error) {
        log.warn(
          '[SESSION] Could not remove session item ' +
          entry +
          ': ' +
          error.message
        )
      }
    }

    log.info(
      '[SESSION] Session contents cleared. Mount preserved: ' +
      config.sessionDir
    )
  } catch (error) {
    log.error(
      '[SESSION] Could not clear session contents: ' +
      error.message
    )
  }
}

/**
 * Check whether a usable file session exists.
 */
function hasFileSession() {
  ensureSessionDir()

  try {
    const entries = fs.readdirSync(config.sessionDir)

    return entries.length > 0
  } catch {
    return false
  }
}

/**
 * ---------------------------------------------------------
 * WHATSAPP WEB VERSION
 * ---------------------------------------------------------
 */
async function getWhatsAppVersion() {
  try {
    log.info(
      'Fetching current WhatsApp Web version...'
    )

    if (typeof fetchLatestWaWebVersion === 'function') {
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
          'Could not fetch WhatsApp Web version: ' +
          error.message
        )
      }
    }

    if (typeof fetchLatestBaileysVersion === 'function') {
      try {
        const result = await fetchLatestBaileysVersion()

        if (result?.version) {
          log.info(
            'Using Baileys version: ' +
            result.version.join('.')
          )

          return result.version
        }
      } catch (error) {
        log.warn(
          'Could not fetch Baileys version: ' +
          error.message
        )
      }
    }

    const fallbackVersion = [
      2,
      3000,
      1034074495
    ]

    log.warn(
      'Using fallback WhatsApp Web version: ' +
      fallbackVersion.join('.')
    )

    return fallbackVersion
  } catch (error) {
    log.error(
      'WhatsApp version detection failed: ' +
      error.message
    )

    return [
      2,
      3000,
      1034074495
    ]
  }
}

/**
 * ---------------------------------------------------------
 * TIMER MANAGEMENT
 * ---------------------------------------------------------
 */
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

/**
 * ---------------------------------------------------------
 * PAIRING
 * ---------------------------------------------------------
 */
function normalizePairNumber(number) {
  return String(number || '')
    .replace(/\D/g, '')
}

function schedulePairing(sock) {
  clearPairingTimer()

  const pairNumber = normalizePairNumber(
    config.pairNumber
  )

  if (!pairNumber) {
    log.warn(
      '[PAIRING] No PAIR_NUMBER configured.'
    )

    return
  }

  pairingTimer = setTimeout(async () => {
    pairingTimer = null

    try {
      /**
       * Very important:
       * Don't request a code if this socket has already
       * been replaced or connected.
       */
      if (currentSocket !== sock) {
        log.info(
          '[PAIRING] Skipping pairing code because socket is no longer current.'
        )

        return
      }

      if (sock.authState?.creds?.registered) {
        log.info(
          '[PAIRING] Account is already registered. No pairing code needed.'
        )

        return
      }

      if (
        sock.ws?.readyState !== undefined &&
        sock.ws.readyState !== 1
      ) {
        log.warn(
          '[PAIRING] Socket is not open. Skipping pairing request.'
        )

        return
      }

      log.info(
        '[PAIRING] Requesting pairing code for +' +
        pairNumber
      )

      let pairingCode

      if (config.pairCustomCode) {
        pairingCode = await sock.requestPairingCode(
          pairNumber,
          config.pairCustomCode
        )
      } else {
        pairingCode = await sock.requestPairingCode(
          pairNumber
        )
      }

      if (!pairingCode) {
        log.warn(
          '[PAIRING] WhatsApp did not return a pairing code.'
        )

        return
      }

      log.info(
        '[PAIRING] Pairing code: ' +
        pairingCode
      )

      log.info(
        '[PAIRING] Enter this code in WhatsApp > Linked Devices.'
      )
    } catch (error) {
      log.error(
        '[PAIRING] Could not get pairing code: ' +
        (
          error?.stack ||
          error?.message ||
          String(error)
        )
      )
    }
  }, PAIRING_DELAY)
}

/**
 * ---------------------------------------------------------
 * RECONNECT
 * ---------------------------------------------------------
 */
function scheduleReconnect(reason = 'unknown') {
  if (isShuttingDown) {
    return
  }

  if (reconnectTimer) {
    return
  }

  log.warn(
    '[RECONNECT] Scheduling reconnect in ' +
    RECONNECT_DELAY +
    'ms. Reason: ' +
    reason
  )

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null

    try {
      await startSocket()
    } catch (error) {
      log.error(
        '[RECONNECT] Failed to restart socket: ' +
        (
          error?.stack ||
          error?.message ||
          String(error)
        )
      )

      scheduleReconnect(
        'restart failure'
      )
    }
  }, RECONNECT_DELAY)
}

/**
 * ---------------------------------------------------------
 * DISCONNECT REASON
 * ---------------------------------------------------------
 */
function getDisconnectCode(error) {
  try {
    return new Boom(error)?.output?.statusCode
  } catch {
    return undefined
  }
}

/**
 * ---------------------------------------------------------
 * SOCKET
 * ---------------------------------------------------------
 */
export async function startSocket() {
  if (isShuttingDown) {
    return null
  }

  if (isStarting) {
    log.warn(
      '[SOCKET] startSocket() is already running.'
    )

    return currentSocket
  }

  isStarting = true

  try {
    clearReconnectTimer()
    clearPairingTimer()

    ensureSessionDir()

    /**
     * -----------------------------------------------------
     * AUTH STATE
     * -----------------------------------------------------
     *
     * The current project uses file sessions.
     *
     * Railway Volume:
     * /app/session
     */
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
        'No WhatsApp file session found. Fresh pairing required.'
      )
    }

    log.info(
      'Session store: files (' +
      config.sessionDir +
      ')'
    )

    const version = await getWhatsAppVersion()

    /**
     * -----------------------------------------------------
     * CREATE SOCKET
     * -----------------------------------------------------
     */
    const sock = makeWASocket({
      version,

      auth: state,

      browser: Browsers.ubuntu(
        'Chrome'
      ),

      markOnlineOnConnect: false,

      syncFullHistory: false,

      generateHighQualityLinkPreview: true,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 25000,

      retryRequestDelayMs: 250,

      shouldIgnoreJid: () => false,

      getMessage: async () => undefined
    })

    currentSocket = sock

    /**
     * Persist every credentials update.
     *
     * This is what allows Railway restarts/redeploys
     * to reuse the existing login session.
     */
    sock.ev.on(
      'creds.update',
      saveCreds
    )

    /**
     * -----------------------------------------------------
     * CONNECTION UPDATE
     * -----------------------------------------------------
     */
    sock.ev.on(
      'connection.update',
      async update => {
        const {
          connection,
          lastDisconnect,
          isNewLogin
        } = update

        if (connection === 'connecting') {
          log.info(
            'Connecting to WhatsApp...'
          )
        }

        if (connection === 'open') {
          clearReconnectTimer()
          clearPairingTimer()

          log.info(
            'WhatsApp connection opened successfully.'
          )

          try {
            const user = sock.user

            if (user) {
              log.info(
                'Connected as ' +
                (
                  user.name ||
                  'WhatsApp User'
                ) +
                ' (' +
                (
                  user.id ||
                  'unknown'
                ) +
                ')'
              )
            }
          } catch {
            // Ignore user-info logging errors.
          }

          return
        }

        if (connection !== 'close') {
          return
        }

        /**
         * The current socket is dead.
         */
        if (currentSocket === sock) {
          currentSocket = null
        }

        clearPairingTimer()

        const disconnectError =
          lastDisconnect?.error

        const code =
          getDisconnectCode(
            disconnectError
          )

        const reason =
          DisconnectReason?.[code] ||
          'unknown'

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

        log.error(
          '[WHATSAPP DISCONNECT] Reason: ' +
          String(reason)
        )

        /**
         * -------------------------------------------------
         * LOGGED OUT
         * -------------------------------------------------
         *
         * This is the important part.
         *
         * When the WhatsApp account was manually logged out,
         * the saved credentials are no longer valid.
         *
         * We clear ONLY the contents of /app/session.
         * We DO NOT delete /app/session itself because it
         * is a Railway Volume mount.
         *
         * Then we start a completely fresh socket.
         */
        if (
          code === DisconnectReason.loggedOut
        ) {
          log.error(
            '[WHATSAPP] Account was logged out.'
          )

          log.warn(
            '[WHATSAPP] Clearing invalid session contents and preparing fresh pairing.'
          )

          clearReconnectTimer()

          clearFileSession()

          /**
           * Give the filesystem a moment to finish
           * releasing old auth files before creating
           * a new Baileys state.
           */
          setTimeout(async () => {
            if (isShuttingDown) {
              return
            }

            try {
              await startSocket()
            } catch (error) {
              log.error(
                '[WHATSAPP] Fresh pairing restart failed: ' +
                (
                  error?.stack ||
                  error?.message ||
                  String(error)
                )
              )

              scheduleReconnect(
                'fresh pairing restart failure'
              )
            }
          }, 1500)

          return
        }

        /**
         * -------------------------------------------------
         * BAD SESSION
         * -------------------------------------------------
         *
         * A bad session means the saved auth state itself
         * cannot be used.
         *
         * Treat it like loggedOut.
         */
        if (
          code === DisconnectReason.badSession
        ) {
          log.error(
            '[WHATSAPP] Bad session detected.'
          )

          log.warn(
            '[WHATSAPP] Clearing invalid session contents.'
          )

          clearReconnectTimer()

          clearFileSession()

          setTimeout(async () => {
            if (isShuttingDown) {
              return
            }

            try {
              await startSocket()
            } catch (error) {
              log.error(
                '[WHATSAPP] Bad-session restart failed: ' +
                (
                  error?.stack ||
                  error?.message ||
                  String(error)
                )
              )

              scheduleReconnect(
                'bad session restart failure'
              )
            }
          }, 1500)

          return
        }

        /**
         * -------------------------------------------------
         * CONNECTION REPLACED
         * -------------------------------------------------
         *
         * Another WhatsApp Web session has replaced
         * this connection.
         *
         * Do not wipe the saved credentials.
         * The credentials themselves may still be valid.
         */
        if (
          code === DisconnectReason.connectionReplaced
        ) {
          log.warn(
            '[WHATSAPP] Connection was replaced by another session.'
          )

          scheduleReconnect(
            'connection replaced'
          )

          return
        }

        /**
         * -------------------------------------------------
         * LOGGED IN FROM ANOTHER LOCATION
         * -------------------------------------------------
         */
        if (
          code === DisconnectReason.loggedOut
        ) {
          return
        }

        /**
         * -------------------------------------------------
         * NORMAL / TEMPORARY DISCONNECT
         * -------------------------------------------------
         *
         * Keep the session and reconnect.
         */
        log.warn(
          '[WHATSAPP] Temporary connection loss. Keeping existing session.'
        )

        scheduleReconnect(
          'temporary connection loss'
        )
      }
    )

    /**
     * -----------------------------------------------------
     * PAIRING
     * -----------------------------------------------------
     *
     * Only request a pairing code if this is a fresh
     * authentication state.
     */
    if (
      !state.creds.registered
    ) {
      schedulePairing(sock)
    } else {
      log.info(
        '[AUTH] Existing WhatsApp authentication found.'
      )
    }

    return sock
  } catch (error) {
    log.error(
      '[SOCKET] Failed to start WhatsApp socket: ' +
      (
        error?.stack ||
        error?.message ||
        String(error)
      )
    )

    currentSocket = null

    scheduleReconnect(
      'socket startup error'
    )

    return null
  } finally {
    isStarting = false
  }
}

/**
 * ---------------------------------------------------------
 * GET CURRENT SOCKET
 * ---------------------------------------------------------
 */
export function getSocket() {
  return currentSocket
}

/**
 * ---------------------------------------------------------
 * SHUTDOWN
 * ---------------------------------------------------------
 *
 * Used for actual process shutdown.
 *
 * IMPORTANT:
 * Do NOT clear the session here.
 * Railway needs the session to survive restarts.
 */
export async function stopSocket() {
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
  } catch {
    // Ignore socket shutdown errors.
  }
}

/**
 * ---------------------------------------------------------
 * DEFAULT EXPORT
 * ---------------------------------------------------------
 */
export default startSocket
