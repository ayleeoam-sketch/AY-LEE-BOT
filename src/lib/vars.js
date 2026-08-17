import config from '../config.js'
import DB from './database.js'

/**
 * Runtime-editable settings.
 *
 * .env provides the defaults; anything changed at runtime with .setvar is
 * written to the DB and wins over the .env value. Cached in memory so plugins
 * can read synchronously on the hot path.
 */

const cache = new Map()

/** Keys a user is allowed to flip at runtime, with their type + default. */
export const SCHEMA = {
  PREFIX: { type: 'string', get: () => config.prefix },
  MODE: { type: 'enum', values: ['public', 'private', 'group', 'inbox'], get: () => config.mode },
  AUTO_READ: { type: 'bool', get: () => config.autoRead },
  AUTO_READ_STATUS: { type: 'bool', get: () => config.autoReadStatus },
  AUTO_TYPING: { type: 'bool', get: () => config.autoTyping },
  ALWAYS_ONLINE: { type: 'bool', get: () => config.alwaysOnline },
  REJECT_CALL: { type: 'bool', get: () => config.rejectCall },
  ANTI_DELETE: { type: 'bool', get: () => config.antiDelete },
  STARTUP_MESSAGE: { type: 'bool', get: () => config.startupMessage },
  CMD_REACT: { type: 'bool', get: () => config.cmdReact },
  CMD_REACT_EMOJI: { type: 'string', get: () => config.cmdReactEmoji },
  BOT_NAME: { type: 'string', get: () => config.botName },
  OWNER_NAME: { type: 'string', get: () => config.ownerName },
  USER_TAG: { type: 'string', get: () => config.userTag },
  MENU_IMAGE: { type: 'string', get: () => config.menuImage },

  /* status / presence automation */
  READ_STATUS: { type: 'bool', get: () => false },
  LIKE_STATUS: { type: 'bool', get: () => false },
  STATUS_EMOJI: { type: 'string', get: () => '💚' },
  SAVE_STATUS: { type: 'bool', get: () => false },
  READ_MSG: { type: 'bool', get: () => false },

  /* anti-edit */
  ANTI_EDIT: { type: 'bool', get: () => false },
  ANTI_EDIT_CHAT: { type: 'enum', values: ['same', 'owner'], get: () => 'same' },

  /* misc automation */
  AUTO_BIO: { type: 'bool', get: () => false },
  ANTI_CALL_BLOCK: { type: 'bool', get: () => false },

  /* chat XP / rank system (.rank, .topranks) */
  LEVEL_UP: { type: 'bool', get: () => true },

  /* downloads: which YouTube route to use - api | ytdlp | auto */
  DL_SOURCE: { type: 'enum', values: ['auto', 'api', 'ytdlp'], get: () => config.dlSource },
  DL_PROVIDER: { type: 'string', get: () => config.dlProvider },

  /* database housekeeping (.dbclean / .dbsize) */
  DB_RETAIN_DAYS: { type: 'number', get: () => config.dbRetainDays },
  DB_AUTOCLEAN: { type: 'bool', get: () => config.dbAutoClean },

  /* VENOM SCHOOL - coins paid per class (half for showing up) */
  SCHOOL_REWARD: { type: 'number', get: () => config.schoolReward },

  /* affiliate programme (.affiliate / .ref) */
  AFFILIATE_URL: { type: 'string', get: () => config.affiliateUrl },
  REF_REWARD: { type: 'number', get: () => config.refReward },   // coins to the referrer
  REF_BONUS: { type: 'number', get: () => config.refBonus },     // coins to the newcomer
  REF_VIP_AT: { type: 'number', get: () => config.refVipAt },    // invites needed for VIP, 0 = off

  /* support-group gate (.forcejoin) */
  FORCE_JOIN: { type: 'bool', get: () => config.forceJoin },
  FORCE_READD: { type: 'bool', get: () => config.forceReAdd },
  FORCE_AUTOADD: { type: 'bool', get: () => config.forceAutoAdd }, // add command users into the group on first use
  SUPPORT_LINK: { type: 'string', get: () => config.supportGroupLink }
}

const coerce = (type, raw) => {
  if (type === 'bool') return ['true', '1', 'on', 'yes', 'enable'].includes(String(raw).toLowerCase())
  if (type === 'number') return Number(raw)
  return String(raw)
}

/** Load every stored var into memory. Call once at boot. */
export async function loadVars() {
  const rows = await DB.vars.all()
  for (const row of rows) cache.set(row.key, row.value)
  return cache
}

/** Read a var: DB value if set, else the .env default. */
export function getVar(key) {
  const k = key.toUpperCase()
  if (cache.has(k)) return cache.get(k)
  return SCHEMA[k] ? SCHEMA[k].get() : undefined
}

/** Persist a var and update the live cache. */
export async function setVar(key, raw) {
  const k = key.toUpperCase()
  const def = SCHEMA[k]
  if (!def) throw new Error(`Unknown var: ${k}`)
  if (def.type === 'enum' && !def.values.includes(String(raw).toLowerCase())) {
    throw new Error(`${k} must be one of: ${def.values.join(', ')}`)
  }
  const value = coerce(def.type, raw)
  cache.set(k, value)
  await DB.vars.set({ key: k }, { value })
  return value
}

/** Remove an override so the .env default applies again. */
export async function delVar(key) {
  const k = key.toUpperCase()
  cache.delete(k)
  await DB.vars.delete({ key: k })
}

/** Every var with its effective value + source. */
export function allVars() {
  return Object.keys(SCHEMA).map((k) => ({
    key: k,
    value: cache.has(k) ? cache.get(k) : SCHEMA[k].get(),
    source: cache.has(k) ? 'db' : 'env'
  }))
}

export default { loadVars, getVar, setVar, delVar, allVars, SCHEMA }
