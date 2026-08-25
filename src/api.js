```js
import http from 'node:http'

/**
 * AY-LEE BOT
 * Simple HTTP API for WhatsApp pairing.
 *
 * No Express required.
 */

let currentSocket = null

let pairingInProgress = false

/**
 * Give the API access to the existing Baileys socket.
 *
 * IMPORTANT:
 * Do not create another makeWASocket() inside this file.
 */
export function setSocket(sock) {
  currentSocket = sock
}

/**
 * Send JSON response.
 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data)

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })

  res.end(body)
}

/**
 * Read JSON request body.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk

      // Prevent unnecessarily large requests.
      if (body.length > 10_000) {
        req.destroy()
        reject(new Error('Request body too large'))
      }
    })

    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })

    req.on('error', reject)
  })
}

/**
 * Clean WhatsApp phone number.
 *
 * Baileys expects:
 * country code + number
 * digits only
 *
 * Example:
 * 08012345678 -> 2348012345678
 * +234 801 234 5678 -> 2348012345678
 */
function normalizeNumber(value) {
  let number = String(value ?? '').replace(/\D/g, '')

  // Nigerian local number support.
  if (number.startsWith('0') && number.length === 11) {
    number = `234${number.slice(1)}`
  }

  return number
}

/**
 * Basic phone-number validation.
 */
function validNumber(number) {
  return /^[1-9]\d{7,14}$/.test(number)
}

/**
 * Create pairing code.
 */
async function generatePairingCode(number) {
  if (!currentSocket) {
    throw new Error('WhatsApp socket is not ready yet.')
  }

  if (currentSocket.authState?.creds?.registered) {
    throw new Error('This WhatsApp session is already connected.')
  }

  if (pairingInProgress) {
    throw new Error(
      'A pairing request is already in progress. Complete it before requesting another code.'
    )
  }

  pairingInProgress = true

  try {
    /*
     * Baileys requires the phone number without +, spaces,
     * brackets, or hyphens.
     */
    const code = await currentSocket.requestPairingCode(number)

    return code
  } finally {
    /*
     * We only prevent overlapping code-generation requests.
     * The WhatsApp socket itself remains alive so the user
     * can enter the code on their phone.
     */
    pairingInProgress = false
  }
}

/**
 * HTTP server.
 */
const server = http.createServer(async (req, res) => {
  /*
   * CORS preflight.
   */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })

    res.end()
    return
  }

  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  )

  /*
   * Health check.
   *
   * GET /api/status
   */
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const connected = Boolean(
      currentSocket?.authState?.creds?.registered
    )

    sendJson(res, 200, {
      success: true,
      connected,
      socketReady: Boolean(currentSocket)
    })

    return
  }

  /*
   * Pairing endpoint.
   *
   * POST /api/pair
   *
   * Body:
   * {
   *   "number": "2348012345678"
   * }
   */
  if (req.method === 'POST' && url.pathname === '/api/pair') {
    try {
      const body = await readBody(req)

      const number = normalizeNumber(body.number)

      if (!number) {
        sendJson(res, 400, {
          success: false,
          error: 'Phone number is required.'
        })

        return
      }

      if (!validNumber(number)) {
        sendJson(res, 400, {
          success: false,
          error: 'Invalid phone number. Use country code + number.'
        })

        return
      }

      const code = await generatePairingCode(number)

      /*
       * Baileys normally returns an 8-character code.
       *
       * Format it as XXXX-XXXX for easier reading.
       */
      const formattedCode =
        String(code)
          .replace(/-/g, '')
          .match(/.{1,4}/g)
          ?.join('-') || String(code)

      sendJson(res, 200, {
        success: true,
        code: formattedCode
      })

      console.log(
        `[PAIRING API] Pairing code generated for ${number}: ${formattedCode}`
      )

      return
    } catch (error) {
      console.error(
        '[PAIRING API] Error:',
        error?.stack || error?.message || error
      )

      sendJson(res, 500, {
        success: false,
        error: error?.message || 'Failed to generate pairing code.'
      })

      return
    }
  }

  /*
   * Not found.
   *
   * IMPORTANT:
   * Always return JSON here.
   *
   * This prevents the old:
   *
   * Unexpected token '<', "<!DOCTYPE..."
   *
   * problem when the frontend expects JSON.
   */
  sendJson(res, 404, {
    success: false,
    error: 'API endpoint not found.'
  })
})

/**
 * Start API server.
 */
export function startApiServer(port = process.env.PORT || 3000) {
  const numericPort = Number(port)

  server.listen(numericPort, '0.0.0.0', () => {
    console.log(
      `[API] AY-LEE BOT API listening on port ${numericPort}`
    )
  })

  server.on('error', (error) => {
    console.error(
      '[API] Server error:',
      error?.stack || error?.message || error
    )
  })

  return server
}

export default {
  setSocket,
  startApiServer
}
```
