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

    /* a refusal is still an answer - react so the user sees it registered */
    const deny = async (why) => {
      if (getVar('CMD_REACT')) await m.react('🚫').catch(() => {})
      return m.reply(why)
    }
    if (plugin.owner && !m.isSudo) return deny('🚫 This command is for the owner only.')
    if (plugin.group && !m.isGroup) return deny('🚫 This command only works in groups.')
    if (plugin.private && m.isGroup) return deny('🚫 This command only works in DM.')
    if (plugin.admin && m.isGroup && !m.isAdmin && !m.isSudo)
      return deny('🚫 You need to be a group admin to use this.')
    if (plugin.botAdmin && m.isGroup && !m.isBotAdmin)
      return deny('🚫 I need to be a group admin to do that.')

    /* ------------------------ cooldown ------------------------ */
    if (plugin.cooldown && !m.isSudo) {
      const key = `${plugin.name}:${m.sender}`
      const until = cooldowns.get(key) || 0
      if (Date.now() < until) {
        const left = Math.ceil((until - Date.now()) / 1000)
        if (getVar('CMD_REACT')) await m.react('⏳').catch(() => {})
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
      await sock.sendMessage(raw.key.remoteJid, { text: friendly })
    } catch {}
  }
}

export default handleMessage
