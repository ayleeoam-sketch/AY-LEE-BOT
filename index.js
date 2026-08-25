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

/* CLI flags override .env: node index.js --pair | --qr */
if (process.argv.includes('--pair')) config.authMethod = 'pair'
if (process.argv.includes('--qr')) config.authMethod = 'qr'

const banner = `
╔══════════════════════════════════════════════╗
║        ${config.botName.toUpperCase().padEnd(38)}║
║        WhatsApp Bot ${config.version.padEnd(25)}║
║        Baileys v7 · Node ${process.version.padEnd(20)}║
╚══════════════════════════════════════════════╝`

async function main() {
  log.banner(banner)

  if (!fs.existsSync(config.tmpDir)) {
    fs.mkdirSync(config.tmpDir, { recursive: true })
  }

  await connectDB()
  await loadVars()
  await loadKeys()
  await loadPlugins()

  if (config.keepAlive) {
    startKeepAlive({
      port: config.keepAlivePort,
      botName: config.botName,
      version: config.version
    })
  }

  /*
   * Start the WhatsApp socket first.
   * The API will use this exact socket for pairing.
   */
  const sock = await startSocket()

  /*
   * Make the active Baileys socket available
   * to the pairing API.
   */
  setSocket(sock)

  /*
   * Start our own AY-LEE BOT HTTP API.
   */
  startApiServer()
}

/* keep the process alive on unexpected errors - a bot must not die */
process.on('uncaughtException', (e) => {
  log.error(
    'Uncaught exception:',
    e?.stack || e
  )
})

process.on('unhandledRejection', (e) => {
  log.error(
    'Unhandled rejection:',
    e?.stack || e
  )
})

const shutdown = async (signal) => {
  log.warn(`${signal} received - shutting down cleanly`)

  await closeDB()

  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

main().catch((e) => {
  log.error(
    'Fatal startup error:',
    e?.stack || e
  )

  process.exit(1)
})
