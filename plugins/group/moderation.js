import DB from '../../src/lib/database.js'
import { toJid } from '../../src/lib/utils.js'

const targetOf = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /^\d{7,}$/.test(args[0].replace(/\D/g, ''))) return toJid(args[0])
  return null
}

/* antiword cache */
const wordCache = new Map()
const WTTL = 60_000
async function badWords(chat) {
  const hit = wordCache.get(chat)
  if (hit && Date.now() - hit.at < WTTL) return hit.words
  const row = await DB.groups.findOne({ id: chat })
  const words = row?.antiword || []
  wordCache.set(chat, { at: Date.now(), words })
  return words
}

/* antispam tracking (memory only) */
const spamTracker = new Map()

export default [
  {
    name: 'warn',
    category: 'GROUP',
    desc: 'Warn a member (3 warnings = removal)',
    usage: '.warn @user [reason]',
    group: true,
    admin: true,
    async run({ sock, m, args, text }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag or reply to the person to warn.')
      if (target === m.botJid) return m.reply('🙃 I am not warning myself.')

      const reason = text.replace(/@\d+/g, '').trim() || 'no reason given'
      await DB.warns.inc({ id: target, chat: m.chat }, 'count', 1)
      const row = await DB.warns.findOne({ id: target, chat: m.chat })
      const count = row?.count || 1

      if (count >= 3) {
        if (m.isBotAdmin) {
          await sock.groupParticipantsUpdate(m.chat, [target], 'remove').catch(() => {})
          await DB.warns.delete({ id: target, chat: m.chat })
          return m.reply({ text: `🚫 @${target.split('@')[0]} reached 3 warnings and was removed.`, mentions: [target] })
        }
        return m.reply({ text: `⚠️ @${target.split('@')[0]} has 3 warnings but I need admin rights to remove them.`, mentions: [target] })
      }

      await m.reply({
        text: `⚠️ *WARNING ${count}/3*\n\n👤 @${target.split('@')[0]}\n📝 Reason: ${reason}\n\n3 warnings means removal.`,
        mentions: [target]
      })
    }
  },
  {
    name: 'unwarn',
    alias: ['delwarn'],
    category: 'GROUP',
    desc: 'Remove a warning from a member',
    usage: '.unwarn @user',
    group: true,
    admin: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag or reply to the person.')
      const row = await DB.warns.findOne({ id: target, chat: m.chat })
      if (!row?.count) return m.reply('✅ That user has no warnings.')
      if (row.count <= 1) await DB.warns.delete({ id: target, chat: m.chat })
      else await DB.warns.set({ id: target, chat: m.chat }, { count: row.count - 1 })
      await m.reply({ text: `✅ Warning removed. @${target.split('@')[0]} now has ${Math.max(0, row.count - 1)}/3.`, mentions: [target] })
    }
  },
  {
    name: 'warnlist',
    alias: ['warns'],
    category: 'GROUP',
    desc: 'Show everyone with warnings',
    usage: '.warnlist',
    group: true,
    admin: true,
    async run({ m }) {
      const rows = (await DB.warns.find({ chat: m.chat })).filter((r) => r.count > 0)
      if (!rows.length) return m.reply('✅ Nobody in this group has warnings.')
      await m.reply({
        text: `⚠️ *WARNINGS*\n\n${rows.map((r) => `• @${r.id.split('@')[0]} — ${r.count}/3`).join('\n')}`,
        mentions: rows.map((r) => r.id)
      })
    }
  },
  {
    name: 'antiword',
    alias: ['badword'],
    category: 'GROUP',
    desc: 'Block specific words in the group',
    usage: '.antiword add <word> | del <word> | list | off',
    group: true,
    admin: true,
    async run({ m, args }) {
      const sub = (args[0] || '').toLowerCase()
      const word = args.slice(1).join(' ').toLowerCase().trim()
      const row = (await DB.groups.findOne({ id: m.chat })) || {}
      const words = row.antiword || []

      if (sub === 'add') {
        if (!word) return m.reply('📝 Usage: .antiword add badword')
        if (words.includes(word)) return m.reply('❌ That word is already blocked.')
        words.push(word)
        await DB.groups.set({ id: m.chat }, { antiword: words })
        wordCache.delete(m.chat)
        return m.reply(`✅ Blocked word added. ${words.length} word(s) blocked.`)
      }
      if (sub === 'del' || sub === 'remove') {
        const next = words.filter((w) => w !== word)
        await DB.groups.set({ id: m.chat }, { antiword: next })
        wordCache.delete(m.chat)
        return m.reply(`✅ Removed. ${next.length} word(s) still blocked.`)
      }
      if (sub === 'off' || sub === 'clear') {
        await DB.groups.set({ id: m.chat }, { antiword: [] })
        wordCache.delete(m.chat)
        return m.reply('✅ Word filter cleared.')
      }
      return m.reply(
        `🔤 *WORD FILTER*\n\nBlocked: ${words.length ? words.map((w) => `"${w}"`).join(', ') : 'none'}\n\n` +
          `.antiword add <word>\n.antiword del <word>\n.antiword list\n.antiword off`
      )
    },

    async before({ sock, m }) {
      if (!m.isGroup || m.fromMe || m.isAdmin || m.isSudo || !m.body) return false
      const words = await badWords(m.chat)
      if (!words.length) return false
      const lower = m.body.toLowerCase()
      const hit = words.find((w) => lower.includes(w))
      if (!hit) return false
      if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
      await sock.sendMessage(m.chat, {
        text: `🚫 @${m.senderNumber} that word is not allowed here.`,
        mentions: [m.sender]
      })
      return true
    }
  },
  {
    name: 'antispam',
    category: 'GROUP',
    desc: 'Auto-delete rapid repeated messages',
    usage: '.antispam on | off',
    group: true,
    admin: true,
    async run({ m, args }) {
      const sub = (args[0] || '').toLowerCase()
      if (sub !== 'on' && sub !== 'off') {
        const row = await DB.groups.findOne({ id: m.chat })
        return m.reply(`🛡️ *Antispam:* currently *${row?.antispam ? 'on' : 'off'}*\n\nUse *.antispam on* or *.antispam off*`)
      }
      await DB.groups.set({ id: m.chat }, { antispam: sub === 'on' })
      await m.reply(`✅ Antispam turned *${sub}*.`)
    },

    async before({ sock, m }) {
      if (!m.isGroup || m.fromMe || m.isAdmin || m.isSudo || !m.body) return false
      const row = await DB.groups.findOne({ id: m.chat })
      if (!row?.antispam) return false

      const key = `${m.chat}:${m.sender}`
      const now = Date.now()
      const hist = (spamTracker.get(key) || []).filter((t) => now - t < 8000)
      hist.push(now)
      spamTracker.set(key, hist)

      if (hist.length >= 6) {
        spamTracker.set(key, [])
        if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
        await sock.sendMessage(m.chat, {
          text: `🛡️ @${m.senderNumber} slow down - you are sending messages too fast.`,
          mentions: [m.sender]
        })
        return true
      }
      return false
    }
  },
  {
    name: 'lock',
    category: 'GROUP',
    desc: 'Only admins can edit group info',
    usage: '.lock',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      await sock.groupSettingUpdate(m.chat, 'locked')
      await m.reply('🔒 Group info locked - only admins can edit it.')
    }
  },
  {
    name: 'unlock',
    category: 'GROUP',
    desc: 'Let everyone edit group info',
    usage: '.unlock',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      await sock.groupSettingUpdate(m.chat, 'unlocked')
      await m.reply('🔓 Group info unlocked - everyone can edit it.')
    }
  },
  {
    name: 'revoke',
    alias: ['resetlink'],
    category: 'GROUP',
    desc: 'Reset the group invite link',
    usage: '.revoke',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      await sock.groupRevokeInvite(m.chat)
      await m.reply('🔄 Invite link reset. The old link no longer works.')
    }
  },
  {
    name: 'kickall',
    category: 'GROUP',
    desc: 'Remove every non-admin (dangerous)',
    usage: '.kickall confirm',
    group: true,
    owner: true,
    botAdmin: true,
    async run({ sock, m, args }) {
      if (args[0] !== 'confirm') {
        return m.reply('⚠️ This removes EVERY non-admin member.\n\nType *.kickall confirm* if you are sure.')
      }
      const victims = m.participants
        .filter((p) => !p.admin && p.id !== m.botJid && p.id !== m.sender)
        .map((p) => p.id)
      if (!victims.length) return m.reply('❌ Nobody to remove.')
      await m.reply(`⏳ Removing ${victims.length} members...`)
      let done = 0
      for (const v of victims) {
        try {
          await sock.groupParticipantsUpdate(m.chat, [v], 'remove')
          done++
          await new Promise((r) => setTimeout(r, 800)) // avoid rate limits
        } catch {}
      }
      await m.reply(`✅ Removed ${done}/${victims.length} members.`)
    }
  },
  {
    name: 'listadmin',
    alias: ['admins'],
    category: 'GROUP',
    desc: 'List all group admins',
    usage: '.admins',
    group: true,
    async run({ m }) {
      const admins = m.participants.filter((p) => p.admin)
      if (!admins.length) return m.reply('❌ Could not read the admin list.')
      await m.reply({
        text:
          `🛡️ *GROUP ADMINS* (${admins.length})\n\n` +
          admins.map((a) => `${a.admin === 'superadmin' ? '👑' : '🛡️'} @${a.id.split('@')[0]}`).join('\n'),
        mentions: admins.map((a) => a.id)
      })
    }
  }
]
