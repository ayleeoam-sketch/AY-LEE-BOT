import config, { prefixes } from './config.js'
import log from './lib/logger.js'
import DB from './lib/database.js'
import { getVar } from './lib/vars.js'
import { serialize, resolvePermissions } from './lib/serialize.js'
import { commands, middlewares, findCommand, pluginCount } from './lib/pluginLoader.js'

/* ---------------------------- caches ---------------------------- */

const cooldowns = new Map() // `${cmd}:${jid}` -> expiry ms
let sudoCache = { at: 0, list: [] }
let bannedCache = { at: 0, list: [] }

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
  try {
    const m = await serialize(sock, raw)
    if (!m) return

    // status broadcasts: optionally auto-read, never run commands
    if (m.isStatus) {
      if (getVar('AUTO_READ_STATUS')) await sock.readMessages([m.key]).catch(() => {})
      return
    }

    await resolvePermissions(sock, m, await getSudo())

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

    const text = args.join(' ')

    /* --------------------- access control --------------------- */
    const mode = getVar('MODE')
    if (mode === 'private' && !m.isSudo) return
    if (mode === 'group' && !m.isGroup && !m.isSudo) return
    if (mode === 'inbox' && m.isGroup && !m.isSudo) return

    if (plugin.owner && !m.isSudo) return m.reply('🚫 This command is for the owner only.')
    if (plugin.group && !m.isGroup) return m.reply('🚫 This command only works in groups.')
    if (plugin.private && m.isGroup) return m.reply('🚫 This command only works in DM.')
    if (plugin.admin && m.isGroup && !m.isAdmin && !m.isSudo)
      return m.reply('🚫 You need to be a group admin to use this.')
    if (plugin.botAdmin && m.isGroup && !m.isBotAdmin)
      return m.reply('🚫 I need to be a group admin to do that.')

    /* ------------------------ cooldown ------------------------ */
    if (plugin.cooldown && !m.isSudo) {
      const key = `${plugin.name}:${m.sender}`
      const until = cooldowns.get(key) || 0
      if (Date.now() < until) {
        const left = Math.ceil((until - Date.now()) / 1000)
        return m.reply(`⏳ Slow down - wait ${left}s before using *${plugin.name}* again.`)
      }
      cooldowns.set(key, Date.now() + plugin.cooldown * 1000)
    }

    /* -------------------------- run --------------------------- */
    log.cmd(
      `${prefix}${command}`,
      `| ${m.pushName} (${m.senderNumber})`,
      m.isGroup ? `| ${m.groupName}` : '| DM'
    )

    if (getVar('CMD_REACT')) m.react(getVar('CMD_REACT_EMOJI')).catch(() => {})
    if (getVar('AUTO_TYPING')) sock.sendPresenceUpdate('composing', m.chat).catch(() => {})

    await plugin.run({
      sock,
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
    log.error('Handler error:', e?.stack || e?.message || e)
    try {
      await sock.sendMessage(raw.key.remoteJid, {
        text: `⚠️ Something went wrong:\n\`\`\`${String(e?.message || e).slice(0, 400)}\`\`\``
      })
    } catch {}
  }
}

export default handleMessage
