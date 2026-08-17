import 'dotenv/config'

/*
 * Test isolation: test/_isolate.js sets VENOM_TEST_ISOLATE before importing
 * this file. dotenv above has just (re)loaded .env, so strip the production
 * database here - after it is read, before anything uses it.
 */
if (process.env.VENOM_TEST_ISOLATE === '1') delete process.env.MONGO_URI
import { fileURLToPath } from 'url'
import path from 'path'
import { applyBuiltinKeys, builtinKey } from './builtin-keys.js'
import { readMongoOverride } from './lib/mongoStore.js'

/*
 * A URI set from WhatsApp with .setmongo outranks the built-in cluster but
 * yields to a MONGO_URI the host operator put in the environment themselves.
 */
if (process.env.VENOM_TEST_ISOLATE !== '1') {
  const override = readMongoOverride()
  if (override.uri && !String(process.env.MONGO_URI || '').trim()) {
    process.env.MONGO_URI = override.uri
    if (override.db && !String(process.env.MONGO_DB || '').trim()) process.env.MONGO_DB = override.db
  }
}

/*
 * Keys that ship with the code (src/builtin-keys.js) fill in anything the
 * environment left blank, so a fresh deploy works with no .env at all.
 * A real .env value always wins - this only fills gaps.
 */
export const builtinKeysApplied = applyBuiltinKeys()

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
  botName: process.env.BOT_NAME || 'VENOM MD BOT',
  ownerName: process.env.OWNER_NAME || 'Owner',
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

  // Per-deploy namespace. Everyone who leaves the built-in cluster in place
  // shares one MongoDB account, so each bot gets its OWN database inside it,
  // named from the owner's number. Without this, one deployer running
  // .setvar BOT_NAME would rename every other bot, and economy balances,
  // warns and sessions would all collide.
  botId: (
    process.env.BOT_ID ||
    list(process.env.OWNER_NUMBER)[0] ||
    (process.env.PAIR_NUMBER || '').replace(/[^0-9]/g, '') ||
    'default'
  )
    .toString()
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 32) || 'default',

  // database
  // The shared cluster in src/builtin-keys.js has already been folded into
  // process.env above, so a fresh clone keeps its economy balances, group
  // settings and .setvar values across restarts with no setup at all.
  mongoUri: (process.env.MONGO_URI || '').trim(),
  // Filled in below: 'venom' normally, 'venom_<botId>' on the shared cluster.
  mongoDb: process.env.MONGO_DB || 'venom',
  // true when this deploy is riding the URI that ships in builtin-keys.js
  sharedCluster: false,

  // keep-alive HTTP server - stops Render free tier sleeping
  keepAlive: bool(process.env.KEEP_ALIVE, true),
  keepAlivePort: (() => {
    const p = parseInt(process.env.PORT || process.env.KEEP_ALIVE_PORT || '8000', 10)
    return Number.isFinite(p) && p > 0 ? p : 8000
  })(),

  // behaviour
  mode: (process.env.MODE || 'public').toLowerCase(),
  autoRead: bool(process.env.AUTO_READ),
  autoReadStatus: bool(process.env.AUTO_READ_STATUS),
  autoTyping: bool(process.env.AUTO_TYPING),
  alwaysOnline: bool(process.env.ALWAYS_ONLINE),
  rejectCall: bool(process.env.REJECT_CALL),
  antiDelete: bool(process.env.ANTI_DELETE, true),
  startupMessage: bool(process.env.STARTUP_MESSAGE, true),
  cmdReact: bool(process.env.CMD_REACT, true),
  cmdReactEmoji: process.env.CMD_REACT_EMOJI || '⚡',

  /* support-group gate: users must be members to run commands,
   * and anyone who leaves gets pulled back in (bot must be admin there) */
  forceJoin: bool(process.env.FORCE_JOIN, true),
  forceAutoAdd: bool(process.env.FORCE_AUTOADD, true),
  // spam protection: max auto-adds per hour (WhatsApp flags mass-adding)
  forceAutoAddHourly: Math.max(1, parseInt(process.env.FORCE_AUTOADD_HOURLY || '20', 10) || 20),
  forceReAdd: bool(process.env.FORCE_READD, true),
  supportGroupLink: (
    process.env.SUPPORT_GROUP_LINK || 'https://chat.whatsapp.com/DYCYPJ602Un8ibZbMAnle7'
  ).trim(),
  // image shown above the menu - URL or local path; blank uses assets/menu.jpg
  menuImage: (process.env.MENU_IMAGE || '').trim(),

  // downloads - see src/lib/downloader.js (DL_SOURCE) and ytapi.js
  dlSource: (process.env.DL_SOURCE || 'auto').toLowerCase(),
  dlProvider: (process.env.DL_PROVIDER || 'auto').toLowerCase(),

  // VENOM SCHOOL
  schoolReward: Number(process.env.SCHOOL_REWARD || 100),

  // affiliate programme - .affiliate builds share links off this
  affiliateUrl: (process.env.AFFILIATE_URL || 'https://github.com/MykelGoal/VENOM-MD-BOT').trim(),
  refReward: Number(process.env.REF_REWARD || 500),
  refBonus: Number(process.env.REF_BONUS || 250),
  refVipAt: Number(process.env.REF_VIP_AT || 5),

  // api keys
  keys: {
    openai: process.env.OPENAI_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    groq: process.env.GROQ_API_KEY || '',
    pexels: process.env.PEXELS_KEY || '',
    pixabay: process.env.PIXABAY_KEY || '',
    // .weather uses keyless open-meteo - this is only here for custom forks
    weather: process.env.OPENWEATHER_KEY || ''
  },

  // paths
  pluginDir: path.join(ROOT, 'plugins'),
  tmpDir: path.join(ROOT, 'tmp'),

  startTime: Date.now()
}

/*
 * Isolate deploys that share the built-in cluster.
 *
 * If the active URI is the one shipped in src/builtin-keys.js and the operator
 * did not name a database themselves, give this bot a private database inside
 * that cluster: venom_<botId>. Two people running this repo then never see or
 * overwrite each other's settings, balances or session.
 *
 * Bring your own MONGO_URI (or set MONGO_DB) and nothing here applies.
 */
{
  const builtinUri = builtinKey('MONGO_URI')
  config.sharedCluster = Boolean(builtinUri) && config.mongoUri === builtinUri
  if (config.sharedCluster && !String(process.env.MONGO_DB || '').trim()) {
    config.mongoDb = `venom_${config.botId}`
  }
}

/** Prefixes the bot will respond to. */
export function prefixes() {
  const p = config.prefix
  if (p === 'none' || p === '') return ['']
  if (p === 'multi') return ['.', '/', '!', '#', '$', ',']
  return [p]
}

export default config
