import http from 'http'
import log from './logger.js'
import { handleDeployHttp } from './deploySite.js'

/*
 * Keep-alive HTTP server + VENOM MD deploy portal.
 *
 * Render's free tier puts a Web Service to sleep after ~15 minutes without
 * inbound traffic. This server answers 200 on /health (and /api/status) so
 * UptimeRobot can ping it. The same port serves the public deploy site on /
 * so people pair and launch a bot without copying a giant SESSION_ID.
 */

const state = {
  startedAt: Date.now(),
  connected: false,
  lastMessageAt: null
}

/** Call when the WhatsApp socket opens/closes. */
export function setConnected(v) {
  state.connected = !!v
}

/** Call on every incoming message so the status page shows real activity. */
export function touchMessage() {
  state.lastMessageAt = Date.now()
}

const fmtUptime = (sec) => {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

function statusPayload(botName, version) {
  const uptimeSec = Math.floor((Date.now() - state.startedAt) / 1000)
  return {
    ok: true,
    name: botName,
    version,
    connected: state.connected,
    uptime: fmtUptime(uptimeSec),
    uptimeSeconds: uptimeSec,
    lastMessageAt: state.lastMessageAt ? new Date(state.lastMessageAt).toISOString() : null,
    time: new Date().toISOString()
  }
}

/**
 * Start the keep-alive / deploy-site server.
 * @param {{port:number, botName:string, version:string, publicUrl?:string}} opts
 */
export function startKeepAlive({ port, botName, version, publicUrl }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname === '/health' || url.pathname === '/api/status' || url.pathname === '/status.json') {
        const payload = statusPayload(botName, version)
        const body = JSON.stringify(payload, null, 2)
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        })
        res.end(body)
        return
      }

      const handled = await handleDeployHttp(req, res, { publicUrl })
      if (handled) return

      // unknown API-ish path → JSON so monitors stay happy
      if ((url.pathname || '').startsWith('/api/')) {
        const body = JSON.stringify({ ok: false, error: 'not found' })
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
        return
      }

      const payload = statusPayload(botName, version)
      const body = JSON.stringify(payload, null, 2)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
      })
      res.end(body)
    } catch (e) {
      const body = JSON.stringify({ ok: false, error: e.message })
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
    }
  })

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log.warn(`Keep-alive: port ${port} already in use — skipping (bot still runs)`)
    } else {
      log.warn(`Keep-alive server error: ${e.message}`)
    }
  })

  server.listen(port, '0.0.0.0', () => {
    log.ok(`Keep-alive + deploy site listening on 0.0.0.0:${port}`)
    log.info('Point UptimeRobot at /health every 5 min so Render never sleeps')
  })

  return server
}

export default startKeepAlive
