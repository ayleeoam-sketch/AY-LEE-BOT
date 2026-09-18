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

/*
|--------------------------------------------------------------------------
| SIMPLE INTERNAL LOGGER
|--------------------------------------------------------------------------
| No external logger.js required.
*/

const log = {
  info(...args) {
    console.log('[INFO]', ...args)
  },

  warn(...args) {
    console.warn('[WARN]', ...args)
  },

  error(...args) {
    console.error('[ERROR]', ...args)
  }
}

/*
|--------------------------------------------------------------------------
| STATE
|--------------------------------------------------------------------------
*/

let currentSocket = null
let reconnectTimer = null
let pairingTimer = null

let isStarting = false
let isShuttingDown = false

const RECONNECT_DELAY = 5000
const PAIRING_DELAY = 12000

/*
|--------------------------------------------------------------------------
| SESSION DIRECTORY
|--------------------------------------------------------------------------
|
| Railway Volume:
|
| /app/session
|
| IMPORTANT:
| NEVER delete /app/session itself.
| Only delete its contents.
|
*/

function ensureSessionDir() {
  fs.mkdirSync(config.sessionDir, {
    recursive: true
  })
}

/*
|--------------------------------------------------------------------------
| CHECK EXISTING SESSION
|--------------------------------------------------------------------------
*/

function hasFileSession() {
  ensureSessionDir()

  try {
    const entries = fs.readdirSync(
      config.sessionDir
    )

    return entries.length > 0
  } catch {
    return false
  }
}

/*
|--------------------------------------------------------------------------
| CLEAR SESSION CONTENTS
|--------------------------------------------------------------------------
|
| Used ONLY when WhatsApp reports:
|
| - loggedOut
| - badSession
|
| This preserves the Railway Volume mount.
|
*/

function clearFileSession() {
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
          '[SESSION] Removed: ' + entry
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
      '[SESSION] Volume mount preserved: ' +
      config.sessionDir
    )
  } catch (error) {
    log.error(
      '[SESSION] Failed to clear session: ' +
      error.message
    )
  }
}

/*
|--------------------------------------------------------------------------
| TIMER MANAGEMENT
|--------------------------------------------------------------------------
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

/*
|--------------------------------------------------------------------------
| WHATSAPP WEB VERSION
|--------------------------------------------------------------------------
|
| Fetch live version first.
| This avoids the previous 405 issue caused by an outdated
| hardcoded WhatsApp Web version.
|
*/

async function getWhatsAppVersion() {
  log.info(
    'Fetching current WhatsApp Web version...'
  )

  /*
  |--------------------------------------------------------------------------
  | LIVE WA WEB VERSION
  |--------------------------------------------------------------------------
  */

  if (
    typeof fetchLatestWaWebVersion ===
    'function'
  ) {
    try {
      const result =
        await fetchLatestWaWebVersion()

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

  /*
  |--------------------------------------------------------------------------
  | BAILEYS FALLBACK
  |--------------------------------------------------------------------------
  */

  if (
    typeof fetchLatestBaileysVersion ===
    'function'
  ) {
    try {
      const result =
        await fetchLatestBaileysVersion()

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

  /*
  |--------------------------------------------------------------------------
  | FINAL FALLBACK
  |--------------------------------------------------------------------------
  */

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
}

/*
|--------------------------------------------------------------------------
| NORMALIZE PHONE NUMBER
|--------------------------------------------------------------------------
*/

function normalizePairNumber(number) {
  return String(number || '')
    .replace(/\D/g, '')
}

/*
|--------------------------------------------------------------------------
| GET DISCONNECT CODE
|--------------------------------------------------------------------------
*/

function getDisconnectCode(error) {
  try {
    return new Boom(error)
      ?.output
      ?.statusCode
  } catch {
    return undefined
  }
}

/*
|--------------------------------------------------------------------------
| PAIRING CODE
|--------------------------------------------------------------------------
*/

function schedulePairing(sock) {
  clearPairingTimer()

  const pairNumber =
    normalizePairNumber(
      config.pairNumber
    )

  if (!pairNumber) {
    log.warn(
      '[PAIRING] PAIR_NUMBER is empty.'
    )

    return
  }

  pairingTimer = setTimeout(
    async () => {
      pairingTimer = null

      try {
        /*
        |--------------------------------------------------------------------------
        | Make sure this is still the active socket.
        |--------------------------------------------------------------------------
        */

        if (
          currentSocket !== sock
        ) {
          log.info(
            '[PAIRING] Socket is no longer current. Skipping pairing.'
          )

          return
        }

        /*
        |--------------------------------------------------------------------------
        | Already registered?
        |--------------------------------------------------------------------------
        */

        if (
          sock.authState?.creds
            ?.registered
        ) {
          log.info(
            '[PAIRING] Account already registered.'
          )

          return
        }

        /*
        |--------------------------------------------------------------------------
        | Request pairing code.
        |--------------------------------------------------------------------------
        */

        log.info(
          '[PAIRING] Requesting pairing code for +' +
          pairNumber
        )

        let code

        if (
          config.pairCustomCode
        ) {
          code =
            await sock.requestPairingCode(
              pairNumber,
              config.pairCustomCode
            )
        } else {
          code =
            await sock.requestPairingCode(
              pairNumber
            )
        }

        if (!code) {
          log.warn(
            '[PAIRING] No pairing code returned.'
          )

          return
        }

        log.info(
          '[PAIRING] Pairing code: ' +
          code
        )

        log.info(
          '[PAIRING] Enter this code in WhatsApp > Linked Devices.'
        )
      } catch (error) {
        log.error(
          '[PAIRING] Could not get pairing code:'
        )

        log.error(
          error?.stack ||
          error?.message ||
          String(error)
        )
      }
    },
    PAIRING_DELAY
  )
}

/*
|--------------------------------------------------------------------------
| RECONNECT
|--------------------------------------------------------------------------
*/

function scheduleReconnect(
  reason = 'unknown'
) {
  if (isShuttingDown) {
    return
  }

  /*
  |--------------------------------------------------------------------------
  | Don't create multiple reconnect timers.
  |--------------------------------------------------------------------------
  */

  if (reconnectTimer) {
    return
  }

  log.warn(
    '[RECONNECT] Reconnecting in ' +
    RECONNECT_DELAY +
    'ms.'
  )

  log.warn(
    '[RECONNECT] Reason: ' +
    reason
  )

  reconnectTimer = setTimeout(
    async () => {
      reconnectTimer = null

      try {
        await startSocket()
      } catch (error) {
        log.error(
          '[RECONNECT] Failed:'
        )

        log.error(
          error?.stack ||
          error?.message ||
          String(error)
        )

        scheduleReconnect(
          'restart failure'
        )
      }
    },
    RECONNECT_DELAY
  )
}

/*
|--------------------------------------------------------------------------
| START SOCKET
|--------------------------------------------------------------------------
*/

export async function startSocket() {
  if (isShuttingDown) {
    return null
  }

  /*
  |--------------------------------------------------------------------------
  | Prevent duplicate socket creation.
  |--------------------------------------------------------------------------
  */

  if (isStarting) {
    log.warn(
      '[SOCKET] Socket startup already in progress.'
    )

    return currentSocket
  }

  isStarting = true

  try {
    clearReconnectTimer()
    clearPairingTimer()

    ensureSessionDir()

    /*
    |--------------------------------------------------------------------------
    | FILE AUTH
    |--------------------------------------------------------------------------
    |
    | This is what makes Railway Volume persistence work.
    |
    */

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        config.sessionDir
      )

    /*
    |--------------------------------------------------------------------------
    | SESSION STATUS
    |--------------------------------------------------------------------------
    */

    if (hasFileSession()) {
      log.info(
        'Existing WhatsApp file session found in ' +
        config.sessionDir
      )
    } else {
      log.info(
        'No WhatsApp file session found.'
      )

      log.info(
        'Fresh pairing will be required.'
      )
    }

    log.info(
      'Session store: files (' +
      config.sessionDir +
      ')'
    )

    /*
    |--------------------------------------------------------------------------
    | WHATSAPP VERSION
    |--------------------------------------------------------------------------
    */

    const version =
      await getWhatsAppVersion()

    /*
    |--------------------------------------------------------------------------
    | CREATE SOCKET
    |--------------------------------------------------------------------------
    */

    const sock =
      makeWASocket({
        version,

        auth: state,

        browser:
          Browsers.ubuntu(
            'Chrome'
          ),

        markOnlineOnConnect: false,

        syncFullHistory: false,

        generateHighQualityLinkPreview:
          true,

        connectTimeoutMs:
          60000,

        defaultQueryTimeoutMs:
          60000,

        keepAliveIntervalMs:
          25000,

        retryRequestDelayMs:
          250
      })

    currentSocket = sock

    /*
    |--------------------------------------------------------------------------
    | SAVE CREDENTIALS
    |--------------------------------------------------------------------------
    |
    | VERY IMPORTANT.
    |
    | Without this, Railway cannot reuse the WhatsApp
    | authentication after restart.
    |
    */

    sock.ev.on(
      'creds.update',
      saveCreds
    )

    /*
    |--------------------------------------------------------------------------
    | CONNECTION UPDATE
    |--------------------------------------------------------------------------
    */

    sock.ev.on(
      'connection.update',
      async update => {
        const {
          connection,
          lastDisconnect
        } = update

        /*
        |--------------------------------------------------------------------------
        | CONNECTING
        |--------------------------------------------------------------------------
        */

        if (
          connection ===
          'connecting'
        ) {
          log.info(
            'Connecting to WhatsApp...'
          )
        }

        /*
        |--------------------------------------------------------------------------
        | CONNECTED
        |--------------------------------------------------------------------------
        */

        if (
          connection ===
          'open'
        ) {
          clearReconnectTimer()
          clearPairingTimer()

          log.info(
            'WhatsApp connection opened successfully.'
          )

          try {
            const user =
              sock.user

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
            // Ignore user info logging errors.
          }

          return
        }

        /*
        |--------------------------------------------------------------------------
        | CLOSED
        |--------------------------------------------------------------------------
        */

        if (
          connection !==
          'close'
        ) {
          return
        }

        /*
        |--------------------------------------------------------------------------
        | Mark current socket dead.
        |--------------------------------------------------------------------------
        */

        if (
          currentSocket ===
          sock
        ) {
          currentSocket = null
        }

        clearPairingTimer()

        const disconnectError =
          lastDisconnect?.error

        const code =
          getDisconnectCode(
            disconnectError
          )

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

        /*
        |--------------------------------------------------------------------------
        | LOGGED OUT
        |--------------------------------------------------------------------------
        |
        | THIS IS THE IMPORTANT FIX.
        |
        | When the WhatsApp account is manually logged out,
        | the saved credentials are invalid.
        |
        | We clear ONLY the contents of /app/session.
        |
        | We DO NOT delete /app/session itself.
        |
        */

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

          clearReconnectTimer()

          clearFileSession()

          /*
          |--------------------------------------------------------------------------
          | Start completely fresh pairing.
          |--------------------------------------------------------------------------
          */

          setTimeout(
            async () => {
              if (
                isShuttingDown
              ) {
                return
              }

              try {
                log.info(
                  '[WHATSAPP] Starting fresh pairing session...'
                )

                await startSocket()
              } catch (error) {
                log.error(
                  '[WHATSAPP] Fresh pairing failed:'
                )

                log.error(
                  error?.stack ||
                  error?.message ||
                  String(error)
                )

                scheduleReconnect(
                  'fresh pairing failure'
                )
              }
            },
            1500
          )

          return
        }

        /*
        |--------------------------------------------------------------------------
        | BAD SESSION
        |--------------------------------------------------------------------------
        |
        | Same treatment as loggedOut.
        |
        */

        if (
          code ===
          DisconnectReason.badSession
        ) {
          log.error(
            '[WHATSAPP] Bad session detected.'
          )

          log.warn(
            '[WHATSAPP] Clearing old authentication files.'
          )

          clearReconnectTimer()

          clearFileSession()

          setTimeout(
            async () => {
              if (
                isShuttingDown
              ) {
                return
              }

              try {
                log.info(
                  '[WHATSAPP] Starting fresh authentication...'
                )

                await startSocket()
              } catch (error) {
                log.error(
                  '[WHATSAPP] Fresh authentication failed:'
                )

                log.error(
                  error?.stack ||
                  error?.message ||
                  String(error)
                )

                scheduleReconnect(
                  'bad session failure'
                )
              }
            },
            1500
          )

          return
        }

        /*
        |--------------------------------------------------------------------------
        | CONNECTION REPLACED
        |--------------------------------------------------------------------------
        |
        | Another WhatsApp Web session replaced this one.
        |
        | DO NOT delete the session.
        |
        */

        if (
          code ===
          DisconnectReason.connectionReplaced
        ) {
          log.warn(
            '[WHATSAPP] Connection replaced by another session.'
          )

          scheduleReconnect(
            'connection replaced'
          )

          return
        }

        /*
        |--------------------------------------------------------------------------
        | TEMPORARY CONNECTION LOSS
        |--------------------------------------------------------------------------
        |
        | Keep the existing session.
        |
        */

        log.warn(
          '[WHATSAPP] Temporary connection loss.'
        )

        log.info(
          '[WHATSAPP] Existing session will be preserved.'
        )

        scheduleReconnect(
          'temporary connection loss'
        )
      }
    )

    /*
    |--------------------------------------------------------------------------
    | PAIR ONLY IF NOT REGISTERED
    |--------------------------------------------------------------------------
    */

    if (
      !state.creds.registered
    ) {
      log.info(
        '[AUTH] No registered WhatsApp account found.'
      )

      schedulePairing(sock)
    } else {
      log.info(
        '[AUTH] Existing WhatsApp authentication found.'
      )

      log.info(
        '[AUTH] Reusing saved session.'
      )
    }

    log.info(
      'WhatsApp socket initialized.'
    )

    return sock
  } catch (error) {
    log.error(
      '[SOCKET] Failed to start WhatsApp socket:'
    )

    log.error(
      error?.stack ||
      error?.message ||
      String(error)
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

/*
|--------------------------------------------------------------------------
| GET CURRENT SOCKET
|--------------------------------------------------------------------------
*/

export function getSocket() {
  return currentSocket
}

/*
|--------------------------------------------------------------------------
| STOP SOCKET
|--------------------------------------------------------------------------
|
| IMPORTANT:
| We do NOT delete the session here.
|
| This allows Railway restarts/redeploys to reuse
| the existing WhatsApp login.
|
*/

export async function stopSocket() {
  isShuttingDown = true

  clearReconnectTimer()
  clearPairingTimer()

  const sock =
    currentSocket

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
    // Ignore shutdown errors.
  }
}

/*
|--------------------------------------------------------------------------
| DEFAULT EXPORT
|--------------------------------------------------------------------------
*/

export default startSocket
