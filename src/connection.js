```javascript
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from 'baileys'

import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import P from 'pino'

import config from '../config.js'

let sock = null
let reconnecting = false

const sessionDir = config.sessionDir || '/app/session'
const qrFile = '/app/qr.png'

/* ----------------------------------------
   Ensure Railway Volume exists
----------------------------------------- */
function ensureSessionDir() {
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, {
      recursive: true
    })
  }
}

/* ----------------------------------------
   Clean phone number
----------------------------------------- */
function cleanNumber(number) {
  return String(number || '').replace(/\D/g, '')
}

/* ----------------------------------------
   Start WhatsApp Socket
----------------------------------------- */
async function startSocket() {
  if (sock) {
    console.log('[WA] Socket already exists.')
    return sock
  }

  ensureSessionDir()

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(sessionDir)

  console.log('[WA] Starting WhatsApp connection...')
  console.log(`[WA] Session directory: ${sessionDir}`)
  console.log(`[WA] Authentication method: ${config.authMethod || process.env.AUTH_METHOD || 'qr'}`)

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

  /* ----------------------------------------
     Save authentication credentials
  ----------------------------------------- */
  sock.ev.on('creds.update', saveCreds)

  /* ----------------------------------------
     Connection updates
  ----------------------------------------- */
  sock.ev.on('connection.update', async (update) => {
    const {
      connection,
      lastDisconnect,
      qr
    } = update

    /* --------------------------------------
       QR CODE
    --------------------------------------- */
    if (qr) {
      const authMethod =
        config.authMethod ||
        process.env.AUTH_METHOD ||
        'qr'

      if (authMethod.toLowerCase() === 'qr') {
        console.log('')
        console.log('╔══════════════════════════════════════════════╗')
        console.log('║              SCAN QR CODE                   ║')
        console.log('╚══════════════════════════════════════════════╝')
        console.log('')
        console.log('Open WhatsApp → Linked Devices → Link a Device')
        console.log('')

        try {
          await QRCode.toFile(qrFile, qr, {
            width: 1000,
            margin: 4,
            errorCorrectionLevel: 'H'
          })

          console.log(`[WA] QR image saved to: ${qrFile}`)
        } catch (error) {
          console.log('[WA] Could not save QR image:', error.message)
        }

        /* ----------------------------------
           Also print terminal QR
        ----------------------------------- */
        try {
          const qrcodeTerminal = await import('qrcode-terminal')

          qrcodeTerminal.default.generate(qr, {
            small: true
          })
        } catch (error) {
          console.log('[WA] Terminal QR unavailable:', error.message)
        }
      }
    }

    /* --------------------------------------
       PAIRING CODE
    --------------------------------------- */
    const authMethod =
      config.authMethod ||
      process.env.AUTH_METHOD ||
      'qr'

    if (
      authMethod.toLowerCase() === 'pairing' &&
      !state.creds.registered
    ) {
      const phoneNumber = cleanNumber(
        config.pairingNumber ||
        process.env.PAIRING_NUMBER
      )

      if (!phoneNumber) {
        console.log('')
        console.log('[WA] ERROR: PAIRING_NUMBER is not configured.')
        console.log('[WA] Add your WhatsApp number to Railway Variables.')
        console.log('')
      } else {
        try {
          await new Promise(resolve => setTimeout(resolve, 3000))

          const code = await sock.requestPairingCode(phoneNumber)

          console.log('')
          console.log('╔══════════════════════════════════════════════╗')
          console.log('║             PAIRING CODE                    ║')
          console.log('╚══════════════════════════════════════════════╝')
          console.log('')
          console.log(`          ${code}`)
          console.log('')
          console.log('WhatsApp → Linked Devices → Link a Device')
          console.log('Then choose "Link with phone number instead".')
          console.log('')
        } catch (error) {
          console.log('[WA] Pairing code error:', error.message)
        }
      }
    }

    /* --------------------------------------
       Connected
    --------------------------------------- */
    if (connection === 'open') {
      reconnecting = false

      console.log('')
      console.log('╔══════════════════════════════════════════════╗')
      console.log('║          WHATSAPP CONNECTED                 ║')
      console.log('╚══════════════════════════════════════════════╝')
      console.log('')
      console.log('[WA] AY-LEE BOT is now connected.')
      console.log(`[WA] Session: ${sessionDir}`)
      console.log('')
    }

    /* --------------------------------------
       Disconnected
    --------------------------------------- */
    if (connection === 'close') {
      sock = null

      const statusCode =
        lastDisconnect?.error?.output?.statusCode

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut

      console.log('')
      console.log(`[WA] Connection closed. Code: ${statusCode}`)

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[WA] WhatsApp logged out.')
        console.log('[WA] Delete the SESSION FILES only if you want to link again.')
        console.log('')
        return
      }

      if (shouldReconnect && !reconnecting) {
        reconnecting = true

        console.log('[WA] Reconnecting in 5 seconds...')

        setTimeout(() => {
          reconnecting = false
          startSocket().catch(error => {
            console.error('[WA] Reconnect failed:', error)
          })
        }, 5000)
      }
    }
  })

  return sock
}

/* ----------------------------------------
   Get current socket
----------------------------------------- */
function getSocket() {
  return sock
}

/* ----------------------------------------
   Stop socket safely
----------------------------------------- */
async function stopSocket() {
  if (!sock) {
    return
  }

  try {
    sock.end(undefined)
  } catch (error) {
    console.log('[WA] Socket close error:', error.message)
  }

  sock = null
}

/* ----------------------------------------
   Exports
----------------------------------------- */
export {
  startSocket,
  getSocket,
  stopSocket
}

export default startSocket
```
