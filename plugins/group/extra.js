import DB from '../../src/lib/database.js'
import { toJid, sleep } from '../../src/lib/utils.js'

const targetOf = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /^\d{7,}$/.test(args[0].replace(/\D/g, ''))) return toJid(args[0])
  return null
}

/** shared toggle helper for the anti-* group switches */
const groupToggle = ({ name, alias, field, label, emoji, desc, note }) => ({
  name,
  alias,
  category: 'GROUP',
  desc,
  usage: `.${name} on | off`,
  group: true,
  admin: true,
  async run({ m, args }) {
    const sub = (args[0] || '').toLowerCase()
    const row = (await DB.groups.findOne({ id: m.chat })) || {}
    if (sub !== 'on' && sub !== 'off') {
      return m.reply(
        `${emoji} *${label}:* currently *${row[field] ? 'on' : 'off'}*\n\n` +
          `Use *.${name} on* or *.${name} off*` + (note ? `\n\n${note}` : '')
      )
    }
    await DB.groups.set({ id: m.chat }, { [field]: sub === 'on' })
    await m.reply(`✅ ${label} turned *${sub}* for this group.`)
  }
})

export default [
  {
    name: 'join',
    alias: ['joingc'],
    category: 'GROUP',
    desc: 'Make the bot join a group by invite link',
    usage: '.join https://chat.whatsapp.com/xxxx',
    owner: true,
    async run({ sock, m, text }) {
      const code = String(text || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)?.[1]
      if (!code) return m.reply('📝 Usage: .join https://chat.whatsapp.com/XXXXXXXX')
      try {
        const id = await sock.groupAcceptInvite(code)
        await m.reply(`✅ Joined the group.\n🆔 ${id}`)
      } catch (e) {
        await m.reply(`❌ Could not join: ${e.message}`)
      }
    }
  },
  {
    name: 'gpp',
    alias: ['setgpp', 'setgrouppp'],
    category: 'GROUP',
    desc: 'Change the group profile picture',
    usage: '.gpp (reply to an image)',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
      if (!src) return m.reply('🖼️ Reply to an image with *.gpp*')
      try {
        await sock.updateProfilePicture(m.chat, await src.download())
        await m.reply('✅ Group picture updated.')
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'tkick',
    alias: ['kicktag'],
    category: 'GROUP',
    desc: 'Kick everyone you tag at once',
    usage: '.tkick @user1 @user2',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      const targets = (m.mentions || []).filter((j) => j !== m.botJid && j !== m.sender)
      if (!targets.length) return m.reply('📝 Tag the people to remove: *.tkick @a @b*')
      let done = 0
      for (const t of targets) {
        try { await sock.groupParticipantsUpdate(m.chat, [t], 'remove'); done++; await sleep(700) } catch {}
      }
      await m.reply(`✅ Removed ${done}/${targets.length} members.`)
    }
  },
  {
    name: 'tag',
    category: 'GROUP',
    desc: 'Tag everyone with a custom message',
    usage: '.tag your announcement',
    group: true,
    admin: true,
    async run({ sock, m, text }) {
      const members = m.participants.map((p) => p.id)
      if (!members.length) return m.reply('❌ Could not read the member list.')
      const body = text || (m.quoted?.text ?? '📢 Attention')
      await sock.sendMessage(m.chat, { text: body, mentions: members }, { quoted: m.raw })
    }
  },
  {
    name: 'creategc',
    alias: ['newgc', 'creategroup'],
    category: 'GROUP',
    desc: 'Create a new group',
    usage: '.creategc My Group Name',
    owner: true,
    async run({ sock, m, text }) {
      if (!text) return m.reply('📝 Usage: .creategc My New Group')
      try {
        const res = await sock.groupCreate(text, [m.sender])
        const code = await sock.groupInviteCode(res.id).catch(() => null)
        await m.reply(
          `✅ Group *${text}* created.\n🆔 ${res.id}` +
            (code ? `\n🔗 https://chat.whatsapp.com/${code}` : '')
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'gcstatus',
    alias: ['groupstatus'],
    category: 'GROUP',
    desc: 'Enable or disable the bot in this group',
    usage: '.gcstatus on | off',
    group: true,
    admin: true,
    async run({ m, args }) {
      const sub = (args[0] || '').toLowerCase()
      const row = (await DB.groups.findOne({ id: m.chat })) || {}
      if (sub !== 'on' && sub !== 'off') {
        return m.reply(`🤖 *Bot in this group:* *${row.disabled ? 'off' : 'on'}*\n\nUse *.gcstatus on* or *.gcstatus off*`)
      }
      await DB.groups.set({ id: m.chat }, { disabled: sub === 'off' })
      await m.reply(sub === 'on' ? '✅ Bot enabled in this group.' : '🔇 Bot disabled here. Only admins can re-enable with *.gcstatus on*')
    },

    /** block all commands when the group is disabled */
    async before({ m }) {
      if (!m.isGroup || m.isSudo) return false
      const body = (m.body || '').trim().toLowerCase()
      if (/^[.\/!#$,]gcstatus/.test(body)) return false
      const row = await DB.groups.findOne({ id: m.chat })
      if (!row?.disabled) return false
      return /^[.\/!#$,]/.test(body) // silently swallow commands
    }
  },
  {
    name: 'events',
    alias: ['eventlog'],
    category: 'GROUP',
    desc: 'Announce group setting changes',
    usage: '.events on | off',
    group: true,
    admin: true,
    async run({ m, args }) {
      const sub = (args[0] || '').toLowerCase()
      const row = (await DB.groups.findOne({ id: m.chat })) || {}
      if (sub !== 'on' && sub !== 'off') {
        return m.reply(`📋 *Event announcements:* *${row.events ? 'on' : 'off'}*\n\nUse *.events on* or *.events off*`)
      }
      await DB.groups.set({ id: m.chat }, { events: sub === 'on' })
      await m.reply(`✅ Event announcements turned *${sub}*.`)
    },

    async onGroupUpdate({ sock, event, metadata }) {
      const row = await DB.groups.findOne({ id: event.id })
      if (!row?.events) return
      const verbs = { promote: '👑 was promoted to admin', demote: '⬇️ was demoted' }
      const verb = verbs[event.action]
      if (!verb) return
      for (const p of event.participants) {
        const jid = typeof p === 'string' ? p : p.id
        await sock.sendMessage(event.id, { text: `@${jid.split('@')[0]} ${verb}`, mentions: [jid] }).catch(() => {})
      }
    }
  },
  {
    name: 'kickr',
    alias: ['kickinactive'],
    category: 'GROUP',
    desc: 'Remove members whose number starts with a prefix',
    usage: '.kickr 234',
    group: true,
    owner: true,
    botAdmin: true,
    async run({ sock, m, args }) {
      const prefix = (args[0] || '').replace(/\D/g, '')
      if (!prefix) return m.reply('📝 Usage: .kickr 234  (removes everyone whose number starts with 234)')
      const victims = m.participants
        .filter((p) => !p.admin && p.id !== m.botJid && p.id !== m.sender && p.id.startsWith(prefix))
        .map((p) => p.id)
      if (!victims.length) return m.reply(`❌ Nobody matches the prefix ${prefix}.`)
      if (args[1] !== 'confirm') {
        return m.reply(`⚠️ This will remove *${victims.length}* members starting with ${prefix}.\n\nType *.kickr ${prefix} confirm* to proceed.`)
      }
      let done = 0
      for (const v of victims) {
        try { await sock.groupParticipantsUpdate(m.chat, [v], 'remove'); done++; await sleep(800) } catch {}
      }
      await m.reply(`✅ Removed ${done}/${victims.length} members.`)
    }
  },
  {
    name: 'reset',
    alias: ['resetgroup'],
    category: 'GROUP',
    desc: 'Reset every bot setting for this group',
    usage: '.reset confirm',
    group: true,
    admin: true,
    async run({ m, args }) {
      if (args[0] !== 'confirm') {
        return m.reply('⚠️ This clears antilink, antiword, welcome, filters and warnings for this group.\n\nType *.reset confirm* to proceed.')
      }
      await DB.groups.delete({ id: m.chat })
      await DB.warns.delete({ chat: m.chat })
      await DB.filters.delete({ scope: m.chat })
      await DB.customcmd.delete({ scope: m.chat })
      await m.reply('♻️ All group settings have been reset to defaults.')
    }
  },

  /* ---------------------- anti-* toggles ---------------------- */
  groupToggle({
    name: 'antibot', field: 'antibot', label: 'Anti-bot', emoji: '🤖',
    desc: 'Remove other bots that post in the group',
    note: 'Detects messages sent from linked-device bot clients.'
  }),
  groupToggle({
    name: 'antitag', field: 'antitag', label: 'Anti-tag', emoji: '🏷️',
    desc: 'Warn members who mass-tag everyone'
  }),
  groupToggle({
    name: 'antigm', alias: ['antigroupmention'], field: 'antigm', label: 'Anti group-mention', emoji: '📢',
    desc: 'Delete messages that mention the whole group'
  }),
  groupToggle({
    name: 'antigcstatus', alias: ['antistatusmention'], field: 'antigcstatus', label: 'Anti status-mention', emoji: '📸',
    desc: 'Delete group status mentions'
  }),

  {
    name: 'akick',
    alias: ['autokick'],
    category: 'GROUP',
    desc: 'Auto-kick anyone whose number starts with a prefix when they join',
    usage: '.akick 1 | .akick off',
    group: true,
    admin: true,
    async run({ m, args }) {
      const sub = (args[0] || '').toLowerCase()
      const row = (await DB.groups.findOne({ id: m.chat })) || {}
      if (!sub) {
        return m.reply(
          `🚷 *Auto-kick prefixes:* ${row.akick?.length ? row.akick.join(', ') : 'none'}\n\n` +
            `.akick 1      — auto kick numbers starting with 1\n.akick off    — disable`
        )
      }
      if (sub === 'off') {
        await DB.groups.set({ id: m.chat }, { akick: [] })
        return m.reply('✅ Auto-kick disabled.')
      }
      const prefix = sub.replace(/\D/g, '')
      if (!prefix) return m.reply('📝 Usage: .akick 234')
      const list = [...new Set([...(row.akick || []), prefix])]
      await DB.groups.set({ id: m.chat }, { akick: list })
      await m.reply(`✅ Auto-kick enabled for numbers starting with: ${list.join(', ')}`)
    },

    async onGroupUpdate({ sock, event }) {
      if (event.action !== 'add') return
      const row = await DB.groups.findOne({ id: event.id })
      if (!row?.akick?.length) return
      for (const p of event.participants) {
        const jid = typeof p === 'string' ? p : p.id
        const num = jid.split('@')[0]
        if (row.akick.some((pre) => num.startsWith(pre))) {
          await sock.groupParticipantsUpdate(event.id, [jid], 'remove').catch(() => {})
          await sock.sendMessage(event.id, { text: `🚷 Auto-removed @${num} (blocked country code).`, mentions: [jid] }).catch(() => {})
        }
      }
    }
  },

  /* the enforcement middleware for antitag / antigm / antibot */
  {
    name: 'groupguard',
    category: 'GROUP',
    desc: 'Internal enforcement for anti-tag and anti-bot',
    usage: '(automatic)',
    hidden: true,
    async run({ m }) {
      await m.reply('ℹ️ This runs automatically. Configure with *.antitag*, *.antigm* or *.antibot*.')
    },

    async before({ sock, m }) {
      if (!m.isGroup || m.fromMe || m.isAdmin || m.isSudo) return false
      const row = await DB.groups.findOne({ id: m.chat })
      if (!row) return false

      const total = m.participants?.length || 0

      /* anti group-mention: tagging (almost) everyone */
      if (row.antigm && total > 3 && (m.mentions?.length || 0) >= Math.floor(total * 0.8)) {
        if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
        await sock.sendMessage(m.chat, { text: `📢 @${m.senderNumber} do not tag the whole group.`, mentions: [m.sender] })
        return true
      }

      /* anti-tag: heavy mention spam */
      if (row.antitag && (m.mentions?.length || 0) >= 8) {
        if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
        await sock.sendMessage(m.chat, { text: `🏷️ @${m.senderNumber} stop mass-tagging.`, mentions: [m.sender] })
        return true
      }

      /* anti-bot: messages from linked-device bot clients */
      if (row.antibot && /^(3EB0|BAE5|3A)/.test(m.id || '') && (m.id || '').length > 20) {
        if (m.isBotAdmin) {
          await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
          await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {})
        }
        await sock.sendMessage(m.chat, { text: `🤖 Removed @${m.senderNumber} — bots are not allowed here.`, mentions: [m.sender] })
        return true
      }

      return false
    }
  }
]
