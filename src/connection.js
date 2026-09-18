```javascript
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from 'baileys'

import QRCode from 'qrcode'
import P from 'pino'
import fs from 'fs'

let sock = null
let reconnectTimer = null
let pairingRequested = false

const SESSION_DIR = '/app/session'
const QR_FILE = '/app/qr.png'

const AUTH_METHOD = (
  process.env.AUTH_METHOD || 'qr'
).toLowerCase()

const PAIRING_NUMBER = String(
  process.env.PAIRING_NUMBER || ''
).replace(/\D/g, '')

/*
|--------------------------------------------------------------------------
| Make sure the Railway Volume directory exists
|--------------------------------------------------------------------------
*/
function ensureSessionDirectory() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, {
      recursive: true
    })
  }
}

/*
|--------------------------------------------------------------------------
| Start WhatsApp
|--------------------------------------------------------------------------
*/
async function startSocket() {
  if (sock) {
    console.log('[WA] WhatsApp socket already running.')
    return sock
  }

  ensureSessionDirectory()

  const authState = await useMultiFileAuthState(
    SESSION_DIR
  )

  const state = authState.state
  const saveCreds = authState.saveCreds

  console.log('')
  console.log('==============================================')
  console.log('          AY-LEE BOT WHATSAPP')
  console.log('==============================================')
  console.log('[WA] Authentication: ' + AUTH_METHOD)
  console.log('[WA] Session directory: ' + SESSION_DIR)
  console.log('')

  sock = makeWASocket({
    auth: state,

    browser: Browsers.ubuntu(
      'AY-LEE BOT'
    ),

    logger: P({
      level: 'silent'
    }),

    printQRInTerminal: false,

    markOnlineOnConnect: false,

    syncFullHistory: false,

    generateHighQualityLinkPreview: false
  })

  /*
  |--------------------------------------------------------------------------
  | Save WhatsApp credentials
  |--------------------------------------------------------------------------
  */
  sock.ev.on(
    'creds.update',
    saveCreds
  )

  /*
  |--------------------------------------------------------------------------
  | Connection events
  |--------------------------------------------------------------------------
  */
  sock.ev.on(
    'connection.update',
    async function (update) {
      const connection = update.connection
      const qr = update.qr
      const lastDisconnect = update.lastDisconnect

      /*
      |--------------------------------------------------------------------------
      | QR CODE
      |--------------------------------------------------------------------------
      */
      if (
        qr &&
        AUTH_METHOD === 'qr' &&
        !state.creds.registered
      ) {
        console.log('')
        console.log('==============================================')
        console.log('              SCAN QR CODE')
        console.log('==============================================')
        console.log('')
        console.log(
          'Open WhatsApp > Linked Devices > Link a Device'
        )
        console.log('')

        /*
        | Save QR as PNG
        */
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

          console.log(
            '[WA] QR image created: ' + QR_FILE
          )
        } catch (error) {
          console.log(
            '[WA] QR image error: ' +
            error.message
          )
        }

        /*
        | Terminal QR
        */
        try {
          const terminalQR =
            await import('qrcode-terminal')

          terminalQR.default.generate(
            qr,
            {
              small: true
            }
          )
        } catch (error) {
          console.log(
            '[WA] Terminal QR error: ' +
            error.message
          )
        }
      }

      /*
      |--------------------------------------------------------------------------
      | PAIRING CODE
      |--------------------------------------------------------------------------
      */
      if (
        AUTH_METHOD === 'pairing' &&
        !state.creds.registered &&
        !pairingRequested
      ) {
        pairingRequested = true

        if (!PAIRING_NUMBER) {
          console.log(
            '[WA] PAIRING_NUMBER is missing.'
          )

          pairingRequested = false
          return
        }

        try {
          await new Promise(
            function (resolve) {
              setTimeout(
                resolve,
                3000
              )
            }
          )

          const code =
            await sock.requestPairingCode(
              PAIRING_NUMBER
            )

          console.log('')
          console.log('==============================================')
          console.log('             PAIRING CODE')
          console.log('==============================================')
          console.log('')
          console.log(
            'CODE: ' + code
          )
          console.log('')
          console.log(
            'WhatsApp > Linked Devices >'
          )
          console.log(
            'Link with phone number instead'
          )
          console.log('')

        } catch (error) {
          console.log(
            '[WA] Pairing code error: ' +
            error.message
          )

          pairingRequested = false
        }
      }

      /*
      |--------------------------------------------------------------------------
      | CONNECTED
      |--------------------------------------------------------------------------
      */
      if (connection === 'open') {
        pairingRequested = false

        console.log('')
        console.log('==============================================')
        console.log('          WHATSAPP CONNECTED')
        console.log('==============================================')
        console.log('')
        console.log(
          '[WA] AY-LEE BOT is connected.'
        )
        console.log(
          '[WA] Session saved to ' +
          SESSION_DIR
        )
        console.log('')
      }

      /*
      |--------------------------------------------------------------------------
      | DISCONNECTED
      |--------------------------------------------------------------------------
      */
      if (connection === 'close') {
        const statusCode =
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output
            ? lastDisconnect.error.output.statusCode
            : null

        sock = null
        pairingRequested = false

        console.log('')
        console.log(
          '[WA] Connection closed.'
        )
        console.log(
          '[WA] Status code: ' +
          String(statusCode)
        )

        /*
        | Logged out
        */
        if (
          statusCode ===
          DisconnectReason.loggedOut
        ) {
          console.log(
            '[WA] WhatsApp logged out.'
          )

          console.log(
            '[WA] Session files were NOT deleted.'
          )

          return
        }

        /*
        | Reconnect
        */
        if (!reconnectTimer) {
          console.log(
            '[WA] Reconnecting in 5 seconds...'
          )

          reconnectTimer = setTimeout(
            async function () {
              reconnectTimer = null

              try {
                await startSocket()
              } catch (error) {
                console.log(
                  '[WA] Reconnection error: ' +
                  error.message
                )
              }
            },
            5000
          )
        }
      }
    }
  )

  return sock
}

/*
|--------------------------------------------------------------------------
| Get socket
|--------------------------------------------------------------------------
*/
function getSocket() {
  return sock
}

/*
|--------------------------------------------------------------------------
| Stop socket
|--------------------------------------------------------------------------
*/
async function stopSocket() {
  if (!sock) {
    return
  }

  try {
    sock.end(undefined)
  } catch (error) {
    console.log(
      '[WA] Socket close error: ' +
      error.message
    )
  }

  sock = null
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/
export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
