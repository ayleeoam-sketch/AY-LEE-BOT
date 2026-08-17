import DB from './database.js'

/**
 * Staff roles.
 *
 * The bot used to know exactly two kinds of people: the owner (everything)
 * and everyone else (nothing). That does not scale once other people help
 * run it, so there is now a ladder. Each rung inherits everything below it.
 *
 *   owner   you, from OWNER_NUMBER - untouchable, can never be revoked
 *   admin   a co-owner: everything except the locked list (see LOCKED)
 *   editor  content: custom commands, autoreplies, welcome/goodbye text
 *   mod     moderation: ban, warn, kick, mute, group locks
 *   vip     no powers, just perks: halved cooldowns, works in private mode
 *   user    the default
 *
 * Roles live in the `roles` collection, so they survive restarts and are
 * scoped to this deploy's database like everything else.
 */

export const ROLES = {
  owner: { level: 100, emoji: '👑', label: 'Owner' },
  admin: { level: 80, emoji: '🛡️', label: 'Admin' },
  editor: { level: 60, emoji: '✏️', label: 'Editor' },
  mod: { level: 40, emoji: '🔨', label: 'Moderator' },
  vip: { level: 20, emoji: '💎', label: 'VIP' },
  user: { level: 0, emoji: '👤', label: 'User' }
}

export const ROLE_NAMES = Object.keys(ROLES).filter((r) => r !== 'owner')

/**
 * Owner-only forever. Delegating these would hand over the bot itself:
 * credentials, code execution, the WhatsApp account, or free money.
 */
export const LOCKED = new Set([
  // credentials + database
  'setmongo', 'getmongo', 'delmongo', 'setkey', 'delkey',
  // who is staff
  'setrole', 'delrole', 'setsudo', 'delsudo', 'getsudo', 'setmod', 'delmod',
  // process + code
  'restart', 'shutdown', 'update', 'plugin', 'delplugin', 'reload', 'eval', 'exec',
  // the WhatsApp account itself
  'setpp', 'removepp', 'setname', 'bio', 'block', 'unblock', 'blocklist', 'privacy',
  // printing money
  'addmoney', 'resetecon', 'tax'
])

/** Commands an editor may run even when the plugin is flagged owner-only. */
export const EDITOR_COMMANDS = new Set([
  'setcmd', 'delcmd', 'listcmd', 'delcmds', 'savecmd', 'vvcmd',
  'gfilter', 'gstop', 'pfilter', 'pstop', 'listfilters',
  'welcome', 'goodbye', 'antiword'
])

/** Commands a moderator may run even when the plugin is flagged owner-only. */
export const MOD_COMMANDS = new Set([
  'ban', 'unban', 'banlist', 'warn', 'unwarn', 'warnlist',
  'kick', 'akick', 'tkick', 'kickr', 'mute', 'unmute', 'lock', 'unlock',
  'antilink', 'antibot', 'antispam', 'antitag', 'antigm', 'groupguard',
  'ignore', 'allow', 'del'
])

/* ------------------------------ storage ------------------------------ */

let cache = { at: 0, map: new Map() }

/** Drop the cache so the next lookup re-reads the database. */
export const invalidateRoles = () => {
  cache.at = 0
}

async function roleMap() {
  if (Date.now() - cache.at < 30_000) return cache.map
  const map = new Map()
  try {
    for (const row of await DB.roles.all()) {
      if (row.number && ROLES[row.role]) map.set(String(row.number), row.role)
    }
    // legacy: anyone made a moderator with .setmod keeps working
    for (const row of await DB.mods.all()) {
      if (row.number && !map.has(String(row.number))) map.set(String(row.number), 'mod')
    }
  } catch {
    /* database down - fall back to nobody having a role */
  }
  cache = { at: Date.now(), map }
  return map
}

const clean = (number) => String(number || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '')

/** The stored role for a number, or 'user'. */
export async function getRole(number) {
  const map = await roleMap()
  return map.get(clean(number)) || 'user'
}

/** Assign a role. Pass 'user' to strip one. */
export async function setRole(number, role, by = '') {
  const n = clean(number)
  if (!ROLES[role]) throw new Error(`Unknown role "${role}". Valid: ${ROLE_NAMES.join(', ')}`)
  if (role === 'user') return delRole(n)
  await DB.roles.set({ number: n }, { role, at: Date.now(), by: clean(by) })
  invalidateRoles()
  return role
}

export async function delRole(number) {
  const n = clean(number)
  await DB.roles.delete({ number: n })
  await DB.mods.delete({ number: n }) // clear the legacy entry too
  invalidateRoles()
  return 'user'
}

/** Everyone with a role, highest first. */
export async function listRoles() {
  const map = await roleMap()
  return [...map.entries()]
    .map(([number, role]) => ({ number, role, ...ROLES[role] }))
    .sort((a, b) => b.level - a.level || a.number.localeCompare(b.number))
}

/* ----------------------------- checks ------------------------------ */

export const levelOf = (role) => ROLES[role]?.level ?? 0

/** Is this role at least `min`? e.g. atLeast('editor', 'mod') === true */
export const atLeast = (role, min) => levelOf(role) >= levelOf(min)

/**
 * May this role run an owner-flagged command?
 * The owner always can; nobody else touches the locked list.
 *
 * @param {string} role  the caller's role
 * @param {string} name  the resolved command name
 */
export function canRunOwnerCommand(role, name) {
  const cmd = String(name || '').toLowerCase()
  if (role === 'owner') return true
  if (LOCKED.has(cmd)) return false
  if (role === 'admin') return true
  if (role === 'editor') return EDITOR_COMMANDS.has(cmd) || MOD_COMMANDS.has(cmd)
  if (role === 'mod') return MOD_COMMANDS.has(cmd)
  return false
}

/** Staff skip cooldowns entirely; VIPs pay half. */
export function cooldownFor(seconds, role) {
  if (atLeast(role, 'mod')) return 0
  if (role === 'vip') return Math.ceil(seconds / 2)
  return seconds
}

/** Attach m.role / m.roleLevel / m.isStaff before access control runs. */
export async function resolveRole(m) {
  m.role = m.isOwner || m.isSudo ? 'owner' : await getRole(m.senderNumber)
  m.roleLevel = levelOf(m.role)
  m.isStaff = atLeast(m.role, 'mod')
  m.isVip = atLeast(m.role, 'vip')
  return m.role
}

export default { ROLES, ROLE_NAMES, getRole, setRole, delRole, listRoles, atLeast, resolveRole }
