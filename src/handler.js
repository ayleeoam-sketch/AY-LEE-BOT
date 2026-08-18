import config, { prefixes } from './config.js'
import log from './lib/logger.js'
import DB from './lib/database.js'
import { getVar } from './lib/vars.js'
import { serialize, resolvePermissions } from './lib/serialize.js'
import { commands, middlewares, findCommand, pluginCount } from './lib/pluginLoader.js'
import { resolveRole, canRunOwnerCommand, atLeast, cooldownFor, invalidateRoles, ROLES } from './lib/roles.js'

/* ---------------------------- caches ---------------------------- */

const cooldowns = new Map() // `${cmd}:${jid}` -> expiry ms
let sudoCache = { at: 0, list: [] }
let bannedCache = { at: 0, list: [] }

/*
 * WhatsApp reports our cleanup deletions through messages.update too. Keep a
 * short-lived marker so anti-delete and snipe do not immediately restore the
 * command messages that this feature intentionally removed.
 */
const commandCleanupKeys = new Map()
const cleanupKey = (key, fallbackChat = '') => `${key?.remoteJid || fallbackChat}:${key?.id || ''}`

function markCommandCleanup(key, chat) {
  const now = Date.now()
  commandCleanupKeys.set(cleanupKey(key, chat), now + 120_000)
  if (commandCleanupKeys.size > 500) {
    for (const [id, expires] of commandCleanupKeys) {
      if (expires <= now) commandCleanupKeys.delete(id)
    }
  }
}

function forgetCommandCleanup(key, chat) {
  commandCleanupKeys.delete(cleanupKey(key, chat))
}

export function isCommandCleanup(key) {
  const id = cleanupKey(key)
  const expires = commandCleanupKeys.get(id) || 0
  if (expires > Date.now()) return true
  if (expires) commandCleanupKeys.delete(id)
  return false
}

async function removeForCommandCleanup(sock, chat, key) {
  if (!key?.id) return
  markCommandCleanup(key, chat)
  try {
    await sock.sendMessage(chat, { delete: key })
  } catch {
    forgetCommandCleanup(key, chat)
  }
}

async function cleanupCommandMessages(sock, m) {
  const seen = new Set()
  for (const key of [...(m.commandResponses || []), m.key]) {
    const id = cleanupKey(key, m.chat)
    if (!key?.id || seen.has(id)) continue
    seen.add(id)
    await removeForCommandCleanup(sock, m.chat, key)
  }
}

/** Track direct sock.sendMessage replies as well as m.reply/m.send replies. */
function socketForCommand(sock, m) {
  const sendMessage = async (jid, content, options) => {
    const sent = await sock.sendMessage(jid, content, options)
    const protocolOnly = content?.delete || content?.react
    if (!protocolOnly && jid === m.chat && sent?.key?.id) m.commandResponses.push(sent.key)
    return sent
  }

  return new Proxy(sock, {
    get(target, property) {
      if (property === 'sendMessage') return sendMessage
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

async function getSudo() {
  if (Date.now() - sudoCache.at < 30_000) return sudoCache.list
  const rows = await DB.sudo.all()
  sudoCache = { at: Date.now(), list: rows.map((r) => r.number) }
  return sudoCache.list
}

async function getBanned() {
  if (Date.now() - bannedCache.at < 30_000) return bannedCache.list
  const rows = await DB.banned.all()
  bannedCache = { at: Date.now(), list: rows.map((r) => r.id) }
  return bannedCache.list
}

export const invalidateCaches = () => {
  sudoCache.at = 0
  bannedCache.at = 0
  invalidateRoles()
}

/* --------------------------- prefix parse --------------------------- */

function parse(body) {
  const list = prefixes()
  for (const p of list) {
    if (p === '') {
      const [cmd, ...args] = body.trim().split(/\s+/)
      return { prefix: '', command: (cmd || '').toLowerCase(), args }
    }
    if (body.startsWith(p)) {
      const withoutPrefix = body.slice(p.length).trim()
      if (!withoutPrefix) return null
      const [cmd, ...args] = withoutPrefix.split(/\s+/)
      return { prefix: p, command: cmd.toLowerCase(), args }
    }
  }
  return null
}

/* ----------------------------- handler ----------------------------- */

export async function handleMessage(sock, raw, ctx = {}) {
  let cleanupMessage = null
  try {
    const m = await serialize(sock, raw)
    if (!m) return

    // status broadcasts never run commands, but plugins may act on them
    if (m.isStatus) {
      for (const mw of middlewares) {
        if (typeof mw.onStatus === 'function') {
          await mw.onStatus({ sock, m }).catch((e) => log.error('onStatus failed:', e.message))
        }
      }
      return
    }

    await resolvePermissions(sock, m, await getSudo())
    // m.role / m.roleLevel / m.isStaff - the staff ladder (src/lib/roles.js)
    await resolveRole(m)

    // hard bans (users and groups)
    const banned = await getBanned()
    if (!m.isOwner && (banned.includes(m.sender) || banned.includes(m.chat))) return

    if (getVar('AUTO_READ')) await sock.readMessages([m.key]).catch(() => {})
    if (getVar('ALWAYS_ONLINE')) sock.sendPresenceUpdate('available').catch(() => {})

    /* ---- middlewares: antilink, afk, chatbot, antidelete ... ---- */
    for (const mw of middlewares) {
      try {
        const stop = await mw.before({ sock, m, config, DB, getVar, commands, categories: null })
        if (stop === true) return
      } catch (e) {
        log.error(`Middleware ${mw.name || mw.file} failed:`, e.message)
      }
    }

    if (!m.body) return

    const parsed = parse(m.body)
    if (!parsed) return
    const { prefix, command, args } = parsed
    if (!command) return

    const plugin = findCommand(command)
    if (!plugin) return
    cleanupMessage = m

    const text = args.join(' ')

    /* --------------------- access control --------------------- */
    const mode = getVar('MODE')
    // staff and VIPs are trusted company: private mode still answers them
    const privileged = m.isSudo || atLeast(m.role, 'vip')
    if (mode === 'private' && !privileged) return
    if (mode === 'group' && !m.isGroup && !privileged) return
    if (mode === 'inbox' && m.isGroup && !privileged) return

    /* a refusal is still an answer - react so the user sees it registered */
    const deny = async (why) => {
      if (getVar('CMD_REACT')) await m.react('🚫').catch(() => {})
      return m.reply(why)
    }
    if (plugin.owner && !m.isSudo && !canRunOwnerCommand(m.role, plugin.name)) {
      return deny(
        m.roleLevel > 0
          ? `🚫 *${plugin.name}* is above your ${ROLES[m.role].emoji} ${ROLES[m.role].label} role.`
          : '🚫 This command is for the owner only.'
      )
    }
    if (plugin.group && !m.isGroup) return deny('🚫 This command only works in groups.')
    if (plugin.private && m.isGroup) return deny('🚫 This command only works in DM.')
    // moderators act through the bot without holding WhatsApp admin themselves
    if (plugin.admin && m.isGroup && !m.isAdmin && !m.isSudo && !atLeast(m.role, 'mod'))
      return deny('🚫 You need to be a group admin to use this.')
    if (plugin.botAdmin && m.isGroup && !m.isBotAdmin)
      return deny('🚫 I need to be a group admin to do that.')

    /* ------------------------ cooldown ------------------------ */
    // staff skip cooldowns, VIPs pay half - see roles.js
    const wait = plugin.cooldown ? cooldownFor(plugin.cooldown, m.role) : 0
    if (wait && !m.isSudo) {
      const key = `${plugin.name}:${m.sender}`
      const until = cooldowns.get(key) || 0
      if (Date.now() < until) {
        const left = Math.ceil((until - Date.now()) / 1000)
        if (getVar('CMD_REACT')) await m.react('⏳').catch(() => {})
        return m.reply(`⏳ Slow down - wait ${left}s before using *${plugin.name}* again.`)
      }
      cooldowns.set(key, Date.now() + wait * 1000)
    }

    /* -------------------------- run --------------------------- */
    log.cmd(
      `${prefix}${command}`,
      `| ${m.pushName} (${m.senderNumber})`,
      m.isGroup ? `| ${m.groupName}` : '| DM'
    )

    if (getVar('AUTO_TYPING')) sock.sendPresenceUpdate('composing', m.chat).catch(() => {})

    /*
     * Command feedback reactions.
     *
     * Plugins may react themselves (⏳ then ✅/❌ for slow work like
     * downloads). For the ~60% that do not, react centrally so every
     * command visibly acknowledges the user instead of appearing dead:
     * the trigger emoji immediately, then ✅ on success or ❌ on failure.
     *
     * m.reacted is set by m.react(), so a plugin that manages its own
     * reactions is never overridden here.
     */
    const wantReact = getVar('CMD_REACT')
    if (wantReact) {
      await m.react(getVar('CMD_REACT_EMOJI') || '⚡').catch(() => {})
      m.reacted = false // the trigger emoji does not count as the plugin reacting
    }

    let failed = false
    try {
      const pluginSock = getVar('AUTO_DELETE_COMMANDS') ? socketForCommand(sock, m) : sock
      await plugin.run({
        sock: pluginSock,
        m,
        args,
        text,
        command,
        prefix,
        config,
        DB,
        getVar,
        commands,
        pluginCount,
        ...ctx
      })
    } catch (e) {
      failed = true
      throw e
    } finally {
      // only close the loop if the plugin did not react on its own
      if (wantReact && !m.reacted) {
        await m.react(failed ? '❌' : '✅').catch(() => {})
      }
    }
  } catch (e) {
    // full detail to the console for the operator
    log.error('Handler error:', e?.stack || e?.message || e)

    /*
     * Users should never see a stack trace or an internal symbol name.
     * Translate the failures that actually happen in practice into
     * something a person can act on, and keep the raw text only for
     * genuinely unknown errors.
     */
    const raw_msg = String(e?.message || e)
    let friendly

    if (/is not a function/.test(raw_msg)) {
      friendly =
        '⚠️ I could not complete that — WhatsApp did not accept the request.\n\n' +
        '_This usually means I am missing admin rights, or the feature is not available for this chat._'
    } else if (/forbidden|not-authorized|401|403/i.test(raw_msg)) {
      friendly = '🚫 WhatsApp refused that action. I probably need to be a group admin.'
    } else if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(raw_msg)) {
      friendly = '⏱️ That took too long and timed out. Please try again.'
    } else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(raw_msg)) {
      friendly = '🌐 A service I rely on is unreachable right now. Try again shortly.'
    } else if (/rate.?limit|429|too many/i.test(raw_msg)) {
      friendly = '🐢 Rate limited. Please wait a moment and try again.'
    } else if (/not-acceptable|item-not-found|404/i.test(raw_msg)) {
      friendly = '❓ WhatsApp could not find that chat, user or message.'
    } else {
      friendly = `⚠️ Something went wrong:\n_${raw_msg.slice(0, 200)}_`
    }

    try {
      const sent = await sock.sendMessage(raw.key.remoteJid, { text: friendly })
      if (cleanupMessage && sent?.key?.id) cleanupMessage.commandResponses.push(sent.key)
    } catch {}
  } finally {
    if (cleanupMessage && getVar('AUTO_DELETE_COMMANDS')) {
      await cleanupCommandMessages(sock, cleanupMessage)
    }
  }
}

export default handleMessage
