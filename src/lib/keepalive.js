import http from 'http'
import log from './logger.js'

/*
 * Keep-alive HTTP server.
 *
 * Render's free tier puts a Web Service to sleep after ~15 minutes without
 * inbound traffic. A WhatsApp bot receives no HTTP traffic, so it sleeps.
 * UptimeRobot (and cron-job.org etc.) can only ping an HTTP endpoint — so we
 * expose one. Point a free monitor at this server every 5 minutes and Render
 * counts it as traffic, so the instance never sleeps.
 *
 * The server answers 200 on every path (Render's health check hits "/") and
 * returns a small JSON status so the endpoint doubles as a dashboard.
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

/**
 * Start the keep-alive server.
 * @param {{port:number, botName:string, version:string}} opts
 * @returns {import('http').Server | null} the server, or null if it failed to bind
 */
export function startKeepAlive({ port, botName, version }) {
  const server = http.createServer((req, res) => {
    const uptimeSec = Math.floor((Date.now() - state.startedAt) / 1000)
    const payload = {
      ok: true,
      name: botName,
      version,
      connected: state.connected,
      uptime: fmtUptime(uptimeSec),
      uptimeSeconds: uptimeSec,
      lastMessageAt: state.lastMessageAt ? new Date(state.lastMessageAt).toISOString() : null,
      time: new Date().toISOString()
    }
    const body = JSON.stringify(payload, null, 2)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(body)
  })

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log.warn(`Keep-alive: port ${port} already in use — skipping (bot still runs)`)
    } else {
      log.warn(`Keep-alive server error: ${e.message}`)
    }
  })

  server.listen(port, '0.0.0.0', () => {
    log.ok(`Keep-alive server listening on 0.0.0.0:${port}`)
    log.info('Point UptimeRobot at this URL every 5 min so Render never sleeps')
  })

  return server
}

export default startKeepAlive
