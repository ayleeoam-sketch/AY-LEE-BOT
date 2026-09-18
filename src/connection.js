```javascript
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from 'baileys'

import QRCode from 'qrcode'
import P from 'pino'
import fs from 'fs'

const SESSION_DIR = '/app/session'
const QR_FILE = '/app/qr.png'

let sock = null
let reconnectTimer = null
let pairingRequested = false

const AUTH_METHOD = String(
  process.env.AUTH_METHOD || 'qr'
).toLowerCase()

const PAIRING_NUMBER = String(
  process.env.PAIRING_NUMBER || ''
).replace(/\D/g, '')

function ensureSessionDirectory() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, {
      recursive: true
    })
  }
}

export async function startSocket() {
  console.log('[WA] startSocket() loaded')

  if (sock) {
    console.log('[WA] WhatsApp socket already running')
    return sock
  }

  ensureSessionDirectory()

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(SESSION_DIR)

  console.log('')
  console.log('==============================================')
  console.log('          AY-LEE BOT WHATSAPP')
  console.log('==============================================')
  console.log('[WA] Authentication: ' + AUTH_METHOD)
  console.log('[WA] Session directory: ' + SESSION_DIR)
  console.log('')

  sock = makeWASocket({
    auth: state,

    browser: Browsers.ubuntu('AY-LEE BOT'),

    logger: P({
      level: 'silent'
    }),

    printQRInTerminal: false,

    markOnlineOnConnect: false,

    syncFullHistory: false,

    generateHighQualityLinkPreview: false
  })

  sock.ev.on(
    'creds.update',
    saveCreds
  )

  sock.ev.on(
    'connection.update',
    async (update) => {
      const {
        connection,
        qr,
        lastDisconnect
      } = update

      // ==========================================
      // QR CODE
      // ==========================================

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

      // ==========================================
      // PAIRING CODE
      // ==========================================

      if (
        AUTH_METHOD === 'pairing' &&
        !state.creds.registered &&
        !pairingRequested
      ) {
        pairingRequested = true

        if (!PAIRING_NUMBER) {
          console.log(
            '[WA] PAIRING_NUMBER is missing'
          )

          pairingRequested = false
          return
        }

        try {
          await new Promise(
            (resolve) => {
              setTimeout(resolve, 3000)
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
          console.log('CODE: ' + code)
          console.log('')
          console.log(
            'WhatsApp > Linked Devices > Link with phone number instead'
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

      // ==========================================
      // CONNECTED
      // ==========================================

      if (connection === 'open') {
        pairingRequested = false

        console.log('')
        console.log('==============================================')
        console.log('          WHATSAPP CONNECTED')
        console.log('==============================================')
        console.log('')
        console.log('[WA] AY-LEE BOT is connected.')
        console.log(
          '[WA] Session saved to ' + SESSION_DIR
        )
        console.log('')
      }

      // ==========================================
      // DISCONNECTED
      // ==========================================

      if (connection === 'close') {
        sock = null
        pairingRequested = false

        const statusCode =
          lastDisconnect?.error?.output?.statusCode

        console.log('')
        console.log('[WA] Connection closed.')
        console.log(
          '[WA] Status code: ' +
          String(statusCode)
        )

        // Do NOT delete Railway Volume/session files
        if (
          statusCode ===
          DisconnectReason.loggedOut
        ) {
          console.log('[WA] WhatsApp logged out.')
          console.log(
            '[WA] Session files were NOT deleted.'
          )

          return
        }

        if (!reconnectTimer) {
          console.log(
            '[WA] Reconnecting in 5 seconds...'
          )

          reconnectTimer = setTimeout(
            async () => {
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

export function getSocket() {
  return sock
}

export async function stopSocket() {
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

export default startSocket
```
