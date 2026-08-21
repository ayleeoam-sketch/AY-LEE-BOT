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
  MODE: {
    type: 'enum',
    values: ['public', 'private', 'group', 'inbox'],
    get: () => config.mode
  },

  AUTO_READ: { type: 'bool', get: () => config.autoRead },
  AUTO_READ_STATUS: { type: 'bool', get: () => config.autoReadStatus },
  AUTO_TYPING: { type: 'bool', get: () => config.autoTyping },
  ALWAYS_ONLINE: { type: 'bool', get: () => config.alwaysOnline },
  REJECT_CALL: { type: 'bool', get: () => config.rejectCall },

  /* ============================================================
   * ANTI-DELETE
   * ============================================================ */

  ANTI_DELETE: {
    type: 'bool',
    get: () => config.antiDelete
  },

  /*
   * WhatsApp number where deleted messages/media are archived.
   *
   * Example:
   * .antidelete archive 2348012345678
   *
   * If empty, antidelete.js automatically falls back to
   * config.ownerNumbers[0].
   */
  ANTI_DELETE_ARCHIVE: {
    type: 'string',
    get: () => ''
  },

  STARTUP_MESSAGE: {
    type: 'bool',
    get: () => config.startupMessage
  },

  CMD_REACT: {
    type: 'bool',
    get: () => config.cmdReact
  },

  CMD_REACT_EMOJI: {
    type: 'string',
    get: () => config.cmdReactEmoji
  },

  AUTO_DELETE_COMMANDS: {
    type: 'bool',
    get: () => config.autoDeleteCommands
  },

  BOT_NAME: {
    type: 'string',
    get: () => config.botName
  },

  OWNER_NAME: {
    type: 'string',
    get: () => config.ownerName
  },

  USER_TAG: {
    type: 'string',
    get: () => config.userTag
  },

  MENU_IMAGE: {
    type: 'string',
    get: () => config.menuImage
  },

  /* ============================================================
   * STATUS / PRESENCE AUTOMATION
   * ============================================================ */

  READ_STATUS: {
    type: 'bool',
    get: () => false
  },

  LIKE_STATUS: {
    type: 'bool',
    get: () => false
  },

  STATUS_EMOJI: {
    type: 'string',
    get: () => '💚'
  },

  SAVE_STATUS: {
    type: 'bool',
    get: () => false
  },

  READ_MSG: {
    type: 'bool',
    get: () => false
  },

  /* ============================================================
   * ANTI-EDIT
   * ============================================================ */

  ANTI_EDIT: {
    type: 'bool',
    get: () => false
  },

  ANTI_EDIT_CHAT: {
    type: 'enum',
    values: ['same', 'owner'],
    get: () => 'same'
  },

  /* ============================================================
   * MISC AUTOMATION
   * ============================================================ */

  AUTO_BIO: {
    type: 'bool',
    get: () => false
  },

  ANTI_CALL_BLOCK: {
    type: 'bool',
    get: () => false
  },

  /* ============================================================
   * CHAT XP / RANK SYSTEM
   * ============================================================ */

  LEVEL_UP: {
    type: 'bool',
    get: () => true
  },

  /* ============================================================
   * DOWNLOADS
   * ============================================================ */

  DL_SOURCE: {
    type: 'enum',
    values: ['auto', 'api', 'ytdlp'],
    get: () => config.dlSource
  },

  DL_PROVIDER: {
    type: 'string',
    get: () => config.dlProvider
  },

  /* ============================================================
   * DATABASE HOUSEKEEPING
   * ============================================================ */

  DB_RETAIN_DAYS: {
    type: 'number',
    get: () => config.dbRetainDays
  },

  DB_AUTOCLEAN: {
    type: 'bool',
    get: () => config.dbAutoClean
  },

  /* ============================================================
   * VENOM SCHOOL
   * ============================================================ */

  SCHOOL_REWARD: {
    type: 'number',
    get: () => config.schoolReward
  },

  /* ============================================================
   * AFFILIATE PROGRAMME
   * ============================================================ */

  AFFILIATE_URL: {
    type: 'string',
    get: () => config.affiliateUrl
  },

  REF_REWARD: {
    type: 'number',
    get: () => config.refReward
  },

  REF_BONUS: {
    type: 'number',
    get: () => config.refBonus
  },

  REF_VIP_AT: {
    type: 'number',
    get: () => config.refVipAt
  },

  /* ============================================================
   * SUPPORT-GROUP GATE
   * ============================================================ */

  FORCE_JOIN: {
    type: 'bool',
    get: () => config.forceJoin
  },

  FORCE_READD: {
    type: 'bool',
    get: () => config.forceReAdd
  },

  FORCE_AUTOADD: {
    type: 'bool',
    get: () => config.forceAutoAdd
  },

  SUPPORT_LINK: {
    type: 'string',
    get: () => config.supportGroupLink
  }
}

/* ============================================================
 * TYPE CONVERSION
 * ============================================================ */

const coerce = (type, raw) => {
  if (type === 'bool') {
    return [
      'true',
      '1',
      'on',
      'yes',
      'enable'
    ].includes(
      String(raw).toLowerCase()
    )
  }

  if (type === 'number') {
    return Number(raw)
  }

  return String(raw)
}

/* ============================================================
 * LOAD VARIABLES
 * ============================================================ */

/**
 * Load every stored var into memory.
 * Call once at boot.
 */
export async function loadVars() {
  const rows = await DB.vars.all()

  for (const row of rows) {
    cache.set(
      row.key,
      row.value
    )
  }

  return cache
}

/* ============================================================
 * GET VARIABLE
 * ============================================================ */

/**
 * Read a var:
 * DB value if set, otherwise the .env/default value.
 */
export function getVar(key) {
  const k = key.toUpperCase()

  if (cache.has(k)) {
    return cache.get(k)
  }

  return SCHEMA[k]
    ? SCHEMA[k].get()
    : undefined
}

/* ============================================================
 * SET VARIABLE
 * ============================================================ */

/**
 * Persist a var and update the live cache.
 */
export async function setVar(key, raw) {
  const k = key.toUpperCase()
  const def = SCHEMA[k]

  if (!def) {
    throw new Error(
      `Unknown var: ${k}`
    )
  }

  if (
    def.type === 'enum' &&
    !def.values.includes(
      String(raw).toLowerCase()
    )
  ) {
    throw new Error(
      `${k} must be one of: ${def.values.join(', ')}`
    )
  }

  const value =
    coerce(
      def.type,
      raw
    )

  cache.set(
    k,
    value
  )

  await DB.vars.set(
    { key: k },
    { value }
  )

  return value
}

/* ============================================================
 * DELETE VARIABLE OVERRIDE
 * ============================================================ */

/**
 * Remove an override so the .env/default value applies again.
 */
export async function delVar(key) {
  const k = key.toUpperCase()

  cache.delete(k)

  await DB.vars.delete({
    key: k
  })
}

/* ============================================================
 * ALL VARIABLES
 * ============================================================ */

/**
 * Every var with its effective value + source.
 */
export function allVars() {
  return Object.keys(
    SCHEMA
  ).map((k) => ({
    key: k,

    value:
      cache.has(k)
        ? cache.get(k)
        : SCHEMA[k].get(),

    source:
      cache.has(k)
        ? 'db'
        : 'env'
  }))
}

/* ============================================================
 * DEFAULT EXPORT
 * ============================================================ */

export default {
  loadVars,
  getVar,
  setVar,
  delVar,
  allVars,
  SCHEMA
}
