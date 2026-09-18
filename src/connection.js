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

/*
|--------------------------------------------------------------------------
| PAIRING SETTINGS
|--------------------------------------------------------------------------
|
| We don't request a pairing code immediately.
| The socket needs a little time to establish the connection first.
|
*/

const PAIRING_DELAY = 8000

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
| IMPORTANT:
| This deletes only the files INSIDE the Railway Volume.
|
| /app/session itself is preserved.
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
| Always try the current WhatsApp Web version first.
|
*/

async function getWhatsAppVersion() {
  log.info(
    'Fetching current WhatsApp Web version...'
  )

  /*
  |--------------------------------------------------------------------------
  | LIVE WHATSAPP WEB VERSION
  |--------------------------------------------------------------------------
  */

  if (
    typeof fetchLatestWaWebVersion ===
    'function'
  ) {
    try {
      const result =
        await fetchLatestWaWebVersion()

      if (
        result?.version &&
        Array.isArray(result.version)
      ) {
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

      if (
        result?.version &&
        Array.isArray(result.version)
      ) {
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
| REQUEST PAIRING CODE
|--------------------------------------------------------------------------
|
| This version:
|
| - checks that the socket is still active
| - checks that the account isn't already registered
| - waits for the socket to be usable
| - supports custom pairing code
| - retries if WhatsApp rejects the request
| - never deletes the Railway Volume
|
*/

async function requestPairingCode(sock) {
  if (
    isShuttingDown ||
    currentSocket !== sock
  ) {
    return
  }

  /*
  |--------------------------------------------------------------------------
  | Check credentials
  |--------------------------------------------------------------------------
  */

  if (
    sock.authState?.creds?.registered
  ) {
    log.info(
      '[PAIRING] Account is already registered.'
    )

    return
  }

  const pairNumber =
    normalizePairNumber(
      config.pairNumber
    )

  if (!pairNumber) {
    log.error(
      '[PAIRING] PAIR_NUMBER is empty.'
    )

    return
  }

  try {
    /*
    |--------------------------------------------------------------------------
    | Make sure the socket connection is alive.
    |--------------------------------------------------------------------------
    */

    if (
      sock.ws?.readyState !== undefined &&
      sock.ws.readyState !== 1
    ) {
      log.info(
        '[PAIRING] WhatsApp socket is not ready yet. Retrying...'
      )

      schedulePairing(sock)

      return
    }

    log.info(
      '[PAIRING] Preparing WhatsApp pairing code for +' +
      pairNumber
    )

    let code

    /*
    |--------------------------------------------------------------------------
    | CUSTOM PAIRING CODE
    |--------------------------------------------------------------------------
    |
    | Only use it if configured.
    |
    */

    const customCode =
      String(
        config.pairCustomCode || ''
      )
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()

    if (customCode) {
      if (
        customCode.length < 8
      ) {
        log.warn(
          '[PAIRING] PAIR_CUSTOM_CODE must contain at least 8 characters.'
        )

        code =
          await sock.requestPairingCode(
            pairNumber
          )
      } else {
        code =
          await sock.requestPairingCode(
            pairNumber,
            customCode
          )
      }
    } else {
      code =
        await sock.requestPairingCode(
          pairNumber
        )
    }

    if (!code) {
      log.warn(
        '[PAIRING] WhatsApp returned an empty pairing code.'
      )

      schedulePairing(sock)

      return
    }

    log.info(
      '[PAIRING] Pairing code: ' +
      code
    )

    log.info(
      '[PAIRING] Enter this code in WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number instead.'
    )

    log.info(
      '[PAIRING] Waiting for WhatsApp to complete the link...'
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

    /*
    |--------------------------------------------------------------------------
    | Do NOT destroy the session directory.
    |
    | Just try again with the same socket if it is still alive.
    |--------------------------------------------------------------------------
    */

    if (
      currentSocket === sock &&
      !isShuttingDown &&
      !sock.authState?.creds?.registered
    ) {
      log.warn(
        '[PAIRING] Pairing request failed. A new code will be attempted.'
      )

      schedulePairing(sock)
    }
  }
}

/*
|--------------------------------------------------------------------------
| SCHEDULE PAIRING
|--------------------------------------------------------------------------
*/

function schedulePairing(sock) {
  clearPairingTimer()

  if (
    isShuttingDown ||
    currentSocket !== sock
  ) {
    return
  }

  pairingTimer = setTimeout(
    async () => {
      pairingTimer = null

      await requestPairingCode(sock)
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

  /*
  |--------------------------------------------------------------------------
  | If a healthy socket already exists, don't create another one.
  |--------------------------------------------------------------------------
  */

  if (
    currentSocket &&
    currentSocket.ws &&
    currentSocket.ws.readyState === 1
  ) {
    log.info(
      '[SOCKET] Existing WhatsApp socket is already active.'
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

        /*
        |--------------------------------------------------------------------------
        | Browser identity
        |--------------------------------------------------------------------------
        |
        | This is kept stable for pairing and reconnects.
        |--------------------------------------------------------------------------
        */

        browser:
          Browsers.macOS(
            'Safari'
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
    | This is what makes the Railway Volume persistent.
    |--------------------------------------------------------------------------
    */

    sock.ev.on(
      'creds.update',
      async () => {
        try {
          await saveCreds()
        } catch (error) {
          log.error(
            '[AUTH] Failed to save credentials: ' +
            error.message
          )
        }
      }
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

          /*
          |--------------------------------------------------------------------------
          | If this is a fresh account, prepare pairing.
          |--------------------------------------------------------------------------
          */

          if (
            !sock.authState?.creds?.registered
          ) {
            schedulePairing(sock)
          }
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
        | Clear authentication files only.
        |
        | NEVER remove /app/session itself.
        |--------------------------------------------------------------------------
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
          clearPairingTimer()

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
          clearPairingTimer()

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
        | Don't destroy credentials.
        |--------------------------------------------------------------------------
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
    | AUTHENTICATION STATUS
    |--------------------------------------------------------------------------
    */

    if (
      !state.creds.registered
    ) {
      log.info(
        '[AUTH] No registered WhatsApp account found.'
      )

      log.info(
        '[AUTH] Pairing code authentication required.'
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
| DO NOT DELETE SESSION.
|
| Railway restarts/redeploys can therefore reuse
| the saved WhatsApp authentication.
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
