import 'dotenv/config'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')

const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d
  return ['true', '1', 'yes', 'on', 'enable'].includes(String(v).trim().toLowerCase())
}

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.replace(/[^0-9]/g, ''))
    .filter(Boolean)

/**
 * Static config, read from .env at boot.
 * Anything a user can change at runtime with .setvar lives in the DB instead
 * and is merged over this object by src/lib/vars.js
 */
export const config = {
  // identity
  botName: process.env.BOT_NAME || 'Kenny',
  ownerName: process.env.OWNER_NAME || 'Kenny',
  ownerNumbers: list(process.env.OWNER_NUMBER),
  userTag: process.env.USER_TAG || 'USER',
  version: process.env.BOT_VERSION || 'v2.0.0',
  platform: process.env.PLATFORM || 'nodejs',
  prefix: process.env.PREFIX ?? '.',

  // auth
  authMethod: (process.env.AUTH_METHOD || 'qr').toLowerCase(),
  pairNumber: (process.env.PAIR_NUMBER || '').replace(/[^0-9]/g, ''),
  pairCustomCode: (process.env.PAIR_CUSTOM_CODE || '').toUpperCase().trim(),
  sessionStore: (process.env.SESSION_STORE || 'file').toLowerCase(),
  // base64 creds.json from the session generator site
  sessionId: (process.env.SESSION_ID || '').trim(),
  sessionDir: path.join(ROOT, 'session'),

  // database
  mongoUri: process.env.MONGO_URI || '',
  mongoDb: process.env.MONGO_DB || 'whatsappbot',

  // behaviour
  mode: (process.env.MODE || 'public').toLowerCase(),
  autoRead: bool(process.env.AUTO_READ),
  autoReadStatus: bool(process.env.AUTO_READ_STATUS),
  autoTyping: bool(process.env.AUTO_TYPING),
  alwaysOnline: bool(process.env.ALWAYS_ONLINE),
  rejectCall: bool(process.env.REJECT_CALL),
  antiDelete: bool(process.env.ANTI_DELETE, true),
  startupMessage: bool(process.env.STARTUP_MESSAGE, true),
  cmdReact: bool(process.env.CMD_REACT),
  cmdReactEmoji: process.env.CMD_REACT_EMOJI || '⚡',

  // api keys
  keys: {
    openai: process.env.OPENAI_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    weather: process.env.OPENWEATHER_KEY || ''
  },

  // paths
  pluginDir: path.join(ROOT, 'plugins'),
  tmpDir: path.join(ROOT, 'tmp'),

  startTime: Date.now()
}

/** Prefixes the bot will respond to. */
export function prefixes() {
  const p = config.prefix
  if (p === 'none' || p === '') return ['']
  if (p === 'multi') return ['.', '/', '!', '#', '$', ',']
  return [p]
}

export default config
