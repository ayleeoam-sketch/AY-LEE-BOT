import fs from 'fs'
import config from './src/config.js'
import log from './src/lib/logger.js'
import { connectDB, closeDB } from './src/lib/database.js'
import { loadVars } from './src/lib/vars.js'
import { loadPlugins } from './src/lib/pluginLoader.js'
import { loadKeys } from './src/lib/ai.js'
import { startSocket } from './src/connection.js'
import { setSocket, startApiServer } from './src/api.js'
import { startKeepAlive } from './src/lib/keepalive.js'

/* ============================================================
 * CLI FLAGS
 *
 * node index.js --pair
 * node index.js --qr
 * ============================================================ */

if (
  process.argv.includes('--pair')
) {
  config.authMethod = 'pair'
}

if (
  process.argv.includes('--qr')
) {
  config.authMethod = 'qr'
}

/* ============================================================
 * BANNER
 * ============================================================ */

const banner = `
╔══════════════════════════════════════════════╗
║        ${config.botName.toUpperCase().padEnd(38)}║
║        WhatsApp Bot ${config.version.padEnd(25)}║
║        Baileys v7 · Node ${process.version.padEnd(20)}║
╚══════════════════════════════════════════════╝`

/* ============================================================
 * MAIN
 * ============================================================ */

async function main() {
  log.banner(
    banner
  )

  /* ==========================================================
   * TEMP DIRECTORY
   * ========================================================== */

  if (
    !fs.existsSync(
      config.tmpDir
    )
  ) {
    fs.mkdirSync(
      config.tmpDir,
      {
        recursive: true
      }
    )
  }

  /* ==========================================================
   * DATABASE
   * ========================================================== */

  await connectDB()

  /* ==========================================================
   * VARIABLES
   * ========================================================== */

  await loadVars()

  /* ==========================================================
   * AI KEYS
   * ========================================================== */

  await loadKeys()

  /* ==========================================================
   * PLUGINS
   * ========================================================== */

  await loadPlugins()

  /* ==========================================================
   * KEEP ALIVE
   *
   * IMPORTANT:
   *
   * Railway already provides the main HTTP port through
   * process.env.PORT.
   *
   * Therefore the keep-alive server MUST NOT use the same
   * port as the main API.
   * ========================================================== */

  if (
    config.keepAlive
  ) {
    const railwayPort =
      Number(
        process.env.PORT
      )

    const configuredKeepAlivePort =
      Number(
        config.keepAlivePort
      )

    /*
     * Only start the keep-alive server when it has a
     * different port from Railway's main PORT.
     */

    if (
      configuredKeepAlivePort &&
      configuredKeepAlivePort !==
        railwayPort
    ) {
      startKeepAlive({
        port:
          configuredKeepAlivePort,
        botName:
          config.botName,
        version:
          config.version
      })

      log.info(
        `Keep-alive server started on port ${configuredKeepAlivePort}`
      )
    } else {
      log.info(
        'Keep-alive skipped because it uses the same port as the Railway API.'
      )
    }
  }

  /* ==========================================================
   * WHATSAPP SOCKET
   *
   * Start the socket before the API so the API can use the
   * exact same Baileys socket.
   * ========================================================== */

  const sock =
    await startSocket()

  /* ==========================================================
   * GIVE API THE SOCKET
   * ========================================================== */

  setSocket(
    sock
  )

  /* ==========================================================
   * MAIN RAILWAY HTTP API
   *
   * api.js uses process.env.PORT automatically.
   * ========================================================== */

  startApiServer()

  log.ok(
    'AY-LEE BOT startup completed.'
  )
}

/* ============================================================
 * UNCAUGHT EXCEPTION
 * ============================================================ */

process.on(
  'uncaughtException',
  (e) => {
    log.error(
      'Uncaught exception:',
      e?.stack ||
        e
    )
  }
)

/* ============================================================
 * UNHANDLED REJECTION
 * ============================================================ */

process.on(
  'unhandledRejection',
  (e) => {
    log.error(
      'Unhandled rejection:',
      e?.stack ||
        e
    )
  }
)

/* ============================================================
 * CLEAN SHUTDOWN
 * ============================================================ */

const shutdown =
  async (
    signal
  ) => {
    log.warn(
      `${signal} received - shutting down cleanly`
    )

    try {
      await closeDB()
    } catch (e) {
      log.error(
        'Error while closing database:',
        e?.message ||
          e
      )
    }

    process.exit(0)
  }

/* ============================================================
 * SIGNAL HANDLERS
 * ============================================================ */

process.on(
  'SIGINT',
  () =>
    shutdown(
      'SIGINT'
    )
)

process.on(
  'SIGTERM',
  () =>
    shutdown(
      'SIGTERM'
    )
)

/* ============================================================
 * START APPLICATION
 * ============================================================ */

main().catch(
  (e) => {
    log.error(
      'Fatal startup error:',
      e?.stack ||
        e
    )

    process.exit(1)
  }
)
