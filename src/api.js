import http from 'node:http'

/**
 * ============================================================
 * AY-LEE BOT
 * HTTP API for WhatsApp pairing.
 *
 * No Express required.
 * ============================================================
 */

let currentSocket = null
let pairingInProgress = false

/**
 * ============================================================
 * GIVE THE API ACCESS TO THE EXISTING BAILEYS SOCKET
 *
 * IMPORTANT:
 * Do NOT create another makeWASocket() inside this file.
 * ============================================================
 */

export function setSocket(sock) {
  currentSocket = sock
}

/**
 * ============================================================
 * SEND JSON RESPONSE
 * ============================================================
 */

function sendJson(res, status, data) {
  try {
    const body = JSON.stringify(data)

    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })

    res.end(body)
  } catch (error) {
    console.error(
      '[API] Failed to send JSON response:',
      error?.stack ||
        error?.message ||
        error
    )

    try {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })

      res.end(
        JSON.stringify({
          success: false,
          error: 'Internal server error.'
        })
      )
    } catch {}
  }
}

/**
 * ============================================================
 * READ JSON REQUEST BODY
 * ============================================================
 */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let settled = false

    req.on('data', (chunk) => {
      if (settled) {
        return
      }

      body += chunk.toString()

      /*
       * Prevent unnecessarily large requests.
       */

      if (body.length > 10_000) {
        settled = true

        reject(
          new Error(
            'Request body too large'
          )
        )

        req.destroy()
      }
    })

    req.on('end', () => {
      if (settled) {
        return
      }

      settled = true

      if (!body.trim()) {
        resolve({})
        return
      }

      try {
        resolve(
          JSON.parse(body)
        )
      } catch {
        reject(
          new Error(
            'Invalid JSON body'
          )
        )
      }
    })

    req.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      reject(error)
    })
  })
}

/**
 * ============================================================
 * CLEAN WHATSAPP PHONE NUMBER
 *
 * Baileys expects:
 *
 * country code + number
 * digits only
 *
 * Examples:
 *
 * 08012345678
 * -> 2348012345678
 *
 * +234 801 234 5678
 * -> 2348012345678
 *
 * 2348012345678
 * -> 2348012345678
 * ============================================================
 */

function normalizeNumber(value) {
  let number =
    String(
      value ?? ''
    ).replace(
      /\D/g,
      ''
    )

  /*
   * Nigerian local number support.
   *
   * Example:
   * 08012345678
   * becomes:
   * 2348012345678
   */

  if (
    number.startsWith('0') &&
    number.length === 11
  ) {
    number =
      '234' +
      number.slice(1)
  }

  return number
}

/**
 * ============================================================
 * BASIC PHONE NUMBER VALIDATION
 * ============================================================
 */

function validNumber(number) {
  return /^[1-9]\d{7,14}$/.test(
    number
  )
}

/**
 * ============================================================
 * CREATE PAIRING CODE
 * ============================================================
 */

async function generatePairingCode(number) {
  if (!currentSocket) {
    throw new Error(
      'WhatsApp socket is not ready yet.'
    )
  }

  /*
   * Prevent multiple pairing requests at the same time.
   */

  if (pairingInProgress) {
    throw new Error(
      'A pairing request is already in progress. Complete it before requesting another code.'
    )
  }

  /*
   * If the socket already has a WhatsApp identity,
   * pairing should not be requested again.
   */

  if (currentSocket.user?.id) {
    throw new Error(
      'This WhatsApp session is already connected.'
    )
  }

  pairingInProgress = true

  try {
    /*
     * Baileys requires the phone number without:
     *
     * +
     * spaces
     * brackets
     * hyphens
     */

    const code =
      await currentSocket.requestPairingCode(
        number
      )

    return code
  } finally {
    /*
     * Only prevent overlapping requests.
     *
     * The socket itself remains alive so the user
     * can enter the code on WhatsApp.
     */

    pairingInProgress = false
  }
}

/**
 * ============================================================
 * HTTP SERVER
 * ============================================================
 */

const server =
  http.createServer(
    async (req, res) => {
      try {
        /*
         * ======================================================
         * CORS PREFLIGHT
         * ======================================================
         */

        if (
          req.method ===
          'OPTIONS'
        ) {
          res.writeHead(
            204,
            {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods':
                'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers':
                'Content-Type'
            }
          )

          res.end()

          return
        }

        /*
         * ======================================================
         * REQUEST URL
         * ======================================================
         */

        const url =
          new URL(
            req.url || '/',
            'http://' +
              (
                req.headers.host ||
                'localhost'
              )
          )

        /*
         * ======================================================
         * HEALTH CHECK
         *
         * GET /api/status
         * ======================================================
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/api/status'
        ) {
          const connected =
            Boolean(
              currentSocket?.user?.id
            )

          sendJson(
            res,
            200,
            {
              success: true,
              connected,
              socketReady:
                Boolean(
                  currentSocket
                )
            }
          )

          return
        }

        /*
         * ======================================================
         * PAIRING ENDPOINT
         *
         * POST /api/pair
         *
         * Body:
         *
         * {
         *   "number": "2348012345678"
         * }
         * ======================================================
         */

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/api/pair'
        ) {
          try {
            const body =
              await readBody(
                req
              )

            const number =
              normalizeNumber(
                body?.number
              )

            /*
             * Number required.
             */

            if (!number) {
              sendJson(
                res,
                400,
                {
                  success: false,
                  error:
                    'Phone number is required.'
                }
              )

              return
            }

            /*
             * Validate number.
             */

            if (
              !validNumber(
                number
              )
            ) {
              sendJson(
                res,
                400,
                {
                  success: false,
                  error:
                    'Invalid phone number. Use country code + number.'
                }
              )

              return
            }

            /*
             * Generate pairing code.
             */

            const code =
              await generatePairingCode(
                number
              )

            /*
             * Baileys normally returns
             * an 8-character code.
             *
             * Format:
             *
             * XXXX-XXXX
             */

            const cleanCode =
              String(
                code || ''
              ).replace(
                /-/g,
                ''
              )

            const codeParts =
              cleanCode.match(
                /.{1,4}/g
              )

            const formattedCode =
              codeParts?.join(
                '-'
              ) ||
              String(
                code || ''
              )

            /*
             * Return successful response.
             */

            sendJson(
              res,
              200,
              {
                success: true,
                code:
                  formattedCode
              }
            )

            console.log(
              '[PAIRING API] Pairing code generated for ' +
                number +
                ': ' +
                formattedCode
            )

            return
          } catch (error) {
            console.error(
              '[PAIRING API] Error:',
              error?.stack ||
                error?.message ||
                error
            )

            /*
             * If the error is caused by a bad request,
             * use 400. Otherwise use 500.
             */

            const message =
              error?.message ||
              'Failed to generate pairing code.'

            const status =
              message.includes(
                'required'
              ) ||
              message.includes(
                'Invalid'
              )
                ? 400
                : 500

            sendJson(
              res,
              status,
              {
                success: false,
                error:
                  message
              }
            )

            return
          }
        }

        /*
         * ======================================================
         * ROOT ENDPOINT
         *
         * Useful for checking that Railway can reach the API.
         * ======================================================
         */

        if (
          req.method ===
            'GET' &&
          url.pathname === '/'
        ) {
          sendJson(
            res,
            200,
            {
              success: true,
              name: 'AY-LEE BOT API',
              status: 'online',
              socketReady:
                Boolean(
                  currentSocket
                )
            }
          )

          return
        }

        /*
         * ======================================================
         * NOT FOUND
         *
         * Always return JSON.
         *
         * This prevents:
         *
         * Unexpected token '<'
         *
         * when the frontend expects JSON.
         * ======================================================
         */

        sendJson(
          res,
          404,
          {
            success: false,
            error:
              'API endpoint not found.'
          }
        )
      } catch (error) {
        console.error(
          '[API] Request error:',
          error?.stack ||
            error?.message ||
            error
        )

        sendJson(
          res,
          500,
          {
            success: false,
            error:
              'Internal server error.'
          }
        )
      }
    }
  )

/**
 * ============================================================
 * START API SERVER
 * ============================================================
 */

export function startApiServer(
  port =
    process.env.PORT ||
    3000
) {
  const numericPort =
    Number(port) || 3000

  /*
   * Prevent the same server from being
   * started multiple times.
   */

  if (
    server.listening
  ) {
    console.log(
      '[API] Server is already running on port ' +
        numericPort
    )

    return server
  }

  server.listen(
    numericPort,
    '0.0.0.0',
    () => {
      console.log(
        '[API] AY-LEE BOT API listening on port ' +
          numericPort
      )
    }
  )

  server.on(
    'error',
    (error) => {
      console.error(
        '[API] Server error:',
        error?.stack ||
          error?.message ||
          error
      )
    }
  )

  return server
}

/**
 * ============================================================
 * DEFAULT EXPORT
 * ============================================================
 */

export default {
  setSocket,
  startApiServer
}
