import config, { prefixes } from '../../src/config.js'
import { getVar, setVar } from '../../src/lib/vars.js'

/**
 * Support-group gate.
 *
 *   FORCE_JOIN  - every command user must be a member of the support group.
 *                 Strangers get the invite link and nothing runs until they
 *                 join. Owner + sudo are always exempt.
 *   FORCE_READD - anyone who leaves the support group is added back
 *                 automatically (needs the bot to be an admin there).
 *
 * Everything is controllable from WhatsApp:
 *   .forcejoin            -> status card
 *   .forcejoin on | off
 *   .forcejoin readd on | off
 *   .forcejoin link <invite url>
 *   .forcejoin check @user
 *
 * .env support: FORCE_JOIN=false, FORCE_READD=false, SUPPORT_GROUP_LINK=...
 */

const num = (jid) => String(jid || '').split('@')[0].split(':')[0]

/** "https://chat.whatsapp.com/ABC123?junk=query" -> "ABC123" */
export function parseInviteCode(raw) {
  const m = String(raw || '').trim().match(/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,})/)
  return m ? m[1] : null
}

/* ------------------------------ caches ------------------------------ */

// resolved group: { jid, subject } extracted from the invite
let groupInfo = null
let groupInfoAt = 0
let members = null
let membersAt = 0
const INFO_TTL = 5 * 60_000
const MEMBERS_TTL = 45_000

const resetCaches = () => {
  groupInfo = null
  groupInfoAt = 0
  members = null
  membersAt = 0
}

/* re-add bookkeeping: user number -> last re-add attempt, and a once-hourly
 * owner warning so a non-admin bot doesn't spam */
const readds = new Map()
let ownerWarnedAt = 0
const READD_COOLDOWN = 10 * 60_000

/** Resolve the support group jid/subject from the invite link. */
async function resolveGroup(sock, getVar) {
  if (groupInfo && Date.now() - groupInfoAt < INFO_TTL) return groupInfo
  const code = parseInviteCode(getVar('SUPPORT_LINK') || config.supportGroupLink)
  if (!code) throw new Error('SUPPORT_LINK is not a valid chat.whatsapp.com invite')
  const info = await sock.groupGetInviteInfo(code)
  if (!info?.id) throw new Error('Could not resolve the support-group invite')
  groupInfo = { jid: info.id, subject: info.subject || 'Support Group', code }
  groupInfoAt = Date.now()
  return groupInfo
}

/** Live member-number set for the support group. */
async function memberNumbers(sock, getVar, { fresh = false } = {}) {
  if (!fresh && members && Date.now() - membersAt < MEMBERS_TTL) return members
  const group = await resolveGroup(sock, getVar)
  const meta = await sock.groupMetadata(group.jid)
  members = new Set(new Set(meta.participants.map((p) => num(p.id))))
  membersAt = Date.now()
  return members
}

const isCommandText = (body) => {
  const list = prefixes()
  if (list.includes('')) return true
  return list.some((p) => p && body.startsWith(p))
}

/* ---------------------------- plugin ---------------------------- */

export default {
  name: 'forcejoin',
  alias: ['forcesupport', 'mustjoin'],
  category: 'CONFIG',
  desc: 'Users must join the support group before the bot answers them',
  usage: '.forcejoin on | off | readd on|off | link <url> | check @user | status',
  owner: true,

  async run({ m, args, sock }) {
    const sub = (args[0] || '').toLowerCase()
    const link = getVar('SUPPORT_LINK') || config.supportGroupLink
    const code = parseInviteCode(link)

    if (['on', 'off'].includes(sub)) {
      await setVar('FORCE_JOIN', sub)
      return m.reply(`🔒 Support-group gate turned *${sub}*.${sub === 'on' ? ' Only members of the group can use commands now.' : ''}`)
    }

    if (sub === 'readd' && ['on', 'off'].includes((args[1] || '').toLowerCase())) {
      await setVar('FORCE_READD', (args[1] || '').toLowerCase())
      return m.reply(`🔁 Auto re-add is now *${args[1].toLowerCase()}* — ${args[1].toLowerCase() === 'on' ? 'anyone who leaves gets pulled back.' : 'leavers stay out.'}`)
    }

    if (sub === 'link') {
      const newCode = parseInviteCode(args[1])
      if (!newCode) return m.reply('📝 Usage: *.forcejoin link https://chat.whatsapp.com/XXXX*')
      await setVar('SUPPORT_LINK', `https://chat.whatsapp.com/${newCode}`)
      resetCaches()
      // re-resolve immediately so a bad link surfaces here, not later
      try {
        const g = await resolveGroup(sock, getVar)
        return m.reply(`✅ Support group updated:\n\n*${g.subject}*\n${getVar('SUPPORT_LINK')}`)
      } catch (e) {
        return m.reply(`⚠️ Link saved, but the invite would not resolve: ${e.message}`)
      }
    }

    if (sub === 'check') {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[1] ? `${args[1].replace(/\D/g, '')}@s.whatsapp.net` : null)
      if (!target) return m.reply('📝 Usage: .forcejoin check @user')
      try {
        const set = await memberNumbers(sock, getVar, { fresh: true })
        return m.reply({
          text: set.has(num(target))
            ? `✅ @${num(target)} *is* a member of the support group.`
            : `❌ @${num(target)} is *not* in the support group.`,
          mentions: [target]
        })
      } catch (e) {
        return m.reply(`❌ Could not check: ${e.message}\n\n_Is the bot a member of the support group?_`)
      }
    }

    // default: status
    let gline = `_${link}_`
    try {
      if (!code) throw new Error('invalid link saved')
      const g = await resolveGroup(sock, getVar)
      const set = await memberNumbers(sock, getVar, { fresh: true })
      const me = num(m.botJid)
      let rank = 'member'
      try {
        const meta = await sock.groupMetadata(g.jid)
        const self = meta.participants.find((p) => num(p.id) === me)
        rank = self?.admin || (self?.isSuperAdmin ? 'superadmin' : self?.isAdmin ? 'admin' : null) || 'member'
      } catch {}
      gline = `*${g.subject}*\n┃ 🔗 ${link}\n┃ 👥 ${set.size} members\n┃ 🤖 Bot in group as: *${rank}*`
    } catch (e) {
      gline = `⚠️ ${link}\n┃ ❌ Invite does not resolve: ${e.message.split('\n')[0]}`
    }

    await m.reply(
      `╭━━━〔 *SUPPORT GATE* 〕━━━╮\n` +
        `┃ Gate: ${getVar('FORCE_JOIN') ? '🔒 *on*' : '🔓 off'}\n` +
        `┃ Re-add leavers: ${getVar('FORCE_READD') ? '🔁 *on*' : 'off'}\n` +
        `┃ Group: ${gline}\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
        `Commands:\n` +
        `.forcejoin on | off\n` +
        `.forcejoin readd on | off\n` +
        `.forcejoin link <invite url>\n` +
        `.forcejoin check @user`
    )
  },

  /**
   * Gate every incoming command: non-members get the invite link and nothing
   * runs. Fail-open on WhatsApp errors so a broken link never bricks the bot
   * (the owner can always see the failure in .forcejoin status).
   */
  async before({ sock, m, commands }) {
    if (!getVar('FORCE_JOIN')) return
    if (!m.body || m.fromMe || m.isOwner || m.isSudo) return
    if (!isCommandText(m.body)) return

    // only intercept REAL commands - don't gate mistyped text
    const prefix = prefixes().find((p) => p && m.body.startsWith(p))
    const name = m.body.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase()
    if (!name || !commands.has(name)) return

    // exempt the support group's own chat - senders there are members by definition
    try {
      const group = await resolveGroup(sock, getVar)
      if (m.chat === group.jid) return

      const set = await memberNumbers(sock, getVar)
      if (set.has(num(m.sender))) return
    } catch (e) {
      return // fail-open: invite/metadata problems must not brick the bot
    }

    const group = groupInfo || { subject: 'our support group' }
    await m.react('🔒').catch(() => {})
    await m.reply({
      text:
        `╭━━━〔 *ACCESS LOCKED* 〕━━━╮\n` +
        `┃ @${m.senderNumber}, join *${group.subject}*\n` +
        `┃ before using commands.\n` +
        `╰━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `👉 ${getVar('SUPPORT_LINK') || config.supportGroupLink}\n\n` +
        `_Join, then send your command again._`,
      mentions: [m.sender]
    })
    return true // stop further processing
  },

  /**
   * Pull leavers back into the support group.
   * One re-add per user per 10 minutes so the feature can't get into a
   * leave/re-add war, and the user gets a polite DM explaining why they're back.
   */
  async onGroupUpdate({ sock, event }) {
    try {
      if (!getVar('FORCE_READD')) return
      if (event.action !== 'remove') return

      const group = await resolveGroup(sock, getVar)
      if (event.id !== group.jid) return

      for (const participant of event.participants) {
        const user = typeof participant === 'string' ? participant : participant.id
        const n = num(user)
        if (!n || n === num(sock.user?.id)) continue

        if (Date.now() - (readds.get(n) || 0) < READD_COOLDOWN) continue
        readds.set(n, Date.now())

        const res = await sock
          .groupParticipantsUpdate(group.jid, [user], 'add')
          .catch((e) => [{ status: 'failed', error: e.message }])

        const ok = Array.isArray(res) && res[0]?.status === '200'
        if (ok) {
          await sock
            .sendMessage(user, {
              text:
                `👋 You left *${group.subject}*, so I added you back.\n\n` +
                `Members of that group keep full access to *${config.botName}* — ` +
                `you can leave again, but the bot will stop answering you until you rejoin.`
            })
            .catch(() => {})
        } else if (Date.now() - ownerWarnedAt > 60 * 60_000) {
          // usually means: bot is not an admin there. Tell the owner once per hour.
          ownerWarnedAt = Date.now()
          const owner = config.ownerNumbers[0]
          if (owner) {
            await sock
              .sendMessage(`${owner}@s.whatsapp.net`, {
                text:
                  `⚠️ I could not re-add ${n} to *${group.subject}*.\n\n` +
                  `Make me an *admin* of the support group or turn it off with *.forcejoin readd off*.`
              })
              .catch(() => {})
          }
        }
      }
    } catch {
      /* never let re-add break connection event handling */
    }
  }
}
