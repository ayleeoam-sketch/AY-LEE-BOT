```javascript
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from 'baileys'

import QRCode from 'qrcode'
import fs from 'fs'
import P from 'pino'

import config from '../config.js'

let sock = null
let reconnecting = false

const sessionDir = config.sessionDir || '/app/session'
const qrFile = '/app/qr.png'

function ensureSessionDir() {
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }
}

function cleanNumber(number) {
  return String(number || '').replace(/\D/g, '')
}

async function startSocket() {
  if (sock) {
    console.log('[WA] Socket already exists.')
    return sock
  }

  ensureSessionDir()

  const auth = await useMultiFileAuthState(sessionDir)
  const state = auth.state
  const saveCreds = auth.saveCreds

  const authMethod =
    config.authMethod ||
    process.env.AUTH_METHOD ||
    'qr'

  console.log('[WA] Starting WhatsApp connection...')
  console.log('[WA] Session directory: ' + sessionDir)
  console.log('[WA] Authentication method: ' + authMethod)

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

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async function (update) {
    const connection = update.connection
    const lastDisconnect = update.lastDisconnect
    const qr = update.qr

    /*
     * QR CODE
     */
    if (qr && authMethod.toLowerCase() === 'qr') {
      console.log('')
      console.log('==============================================')
      console.log('           AY-LEE BOT QR CODE')
      console.log('==============================================')
      console.log('')
      console.log('Open WhatsApp')
      console.log('Go to Linked Devices')
      console.log('Choose Link a Device')
      console.log('')

      try {
        await QRCode.toFile(qrFile, qr, {
          width: 1000,
          margin: 4,
          errorCorrectionLevel: 'H'
        })

        console.log('[WA] QR image saved to: ' + qrFile)
      } catch (error) {
        console.log('[WA] QR image error: ' + error.message)
      }

      /*
       * Terminal QR
       */
      try {
        const terminalQR = await import('qrcode-terminal')

        terminalQR.default.generate(qr, {
          small: true
        })
      } catch (error) {
        console.log(
          '[WA] Terminal QR error: ' + error.message
        )
      }
    }

    /*
     * PAIRING CODE
     */
    if (
      authMethod.toLowerCase() === 'pairing' &&
      !state.creds.registered
    ) {
      const phoneNumber = cleanNumber(
        config.pairingNumber ||
        process.env.PAIRING_NUMBER
      )

      if (!phoneNumber) {
        console.log(
          '[WA] ERROR: PAIRING_NUMBER is not configured.'
        )
      } else {
        try {
          await new Promise(function (resolve) {
            setTimeout(resolve, 3000)
          })

          const code =
            await sock.requestPairingCode(phoneNumber)

          console.log('')
          console.log('==============================================')
          console.log('           AY-LEE BOT PAIRING CODE')
          console.log('==============================================')
          console.log('')
          console.log('PAIRING CODE: ' + code)
          console.log('')
          console.log(
            'WhatsApp -> Linked Devices -> Link with phone number instead'
          )
          console.log('')
        } catch (error) {
          console.log(
            '[WA] Pairing code error: ' + error.message
          )
        }
      }
    }

    /*
     * CONNECTED
     */
    if (connection === 'open') {
      reconnecting = false

      console.log('')
      console.log('==============================================')
      console.log('          WHATSAPP CONNECTED')
      console.log('==============================================')
      console.log('')
      console.log('[WA] AY-LEE BOT is now connected.')
      console.log('[WA] Session saved in: ' + sessionDir)
      console.log('')
    }

    /*
     * DISCONNECTED
     */
    if (connection === 'close') {
      sock = null

      const statusCode =
        lastDisconnect &&
        lastDisconnect.error &&
        lastDisconnect.error.output
          ? lastDisconnect.error.output.statusCode
          : undefined

      console.log(
        '[WA] Connection closed. Code: ' +
        String(statusCode)
      )

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[WA] WhatsApp logged out.')
        console.log(
          '[WA] Session was not automatically deleted.'
        )

        return
      }

      if (!reconnecting) {
        reconnecting = true

        console.log(
          '[WA] Reconnecting in 5 seconds...'
        )

        setTimeout(function () {
          reconnecting = false

          startSocket().catch(function (error) {
            console.error(
              '[WA] Reconnect failed:',
              error
            )
          })
        }, 5000)
      }
    }
  })

  return sock
}

function getSocket() {
  return sock
}

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

export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
