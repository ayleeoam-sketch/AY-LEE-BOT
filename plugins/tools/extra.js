import { getContentType } from 'baileys'
import DB from '../../src/lib/database.js'
import { toJid } from '../../src/lib/utils.js'

export default [
  {
    name: 'listonline',
    alias: ['online-list'],
    category: 'TOOLS',
    desc: 'Show members currently online',
    usage: '.listonline',
    group: true,
    async run({ sock, m }) {
      await sock.presenceSubscribe(m.chat).catch(() => {})
      await m.reply('👀 Watching presence for 8 seconds...')
      const seen = new Set()
      const listener = ({ id, presences }) => {
        if (id !== m.chat) return
        for (const [jid, p] of Object.entries(presences || {})) {
          if (p?.lastKnownPresence && p.lastKnownPresence !== 'unavailable') seen.add(jid)
        }
      }
      sock.ev.on('presence.update', listener)
      await new Promise((r) => setTimeout(r, 8000))
      sock.ev.off('presence.update', listener)

      if (!seen.size) return m.reply('😴 Nobody appeared online.\n\n_WhatsApp only reports presence for people who have the chat open._')
      await m.reply({
        text: `🟢 *ONLINE NOW* (${seen.size})\n\n${[...seen].map((j) => `• @${j.split('@')[0]}`).join('\n')}`,
        mentions: [...seen]
      })
    }
  },
  {
    name: 'element',
    alias: ['msginfo', 'rawmsg'],
    category: 'TOOLS',
    desc: 'Show the raw structure of a message',
    usage: '.element (reply to a message)',
    owner: true,
    async run({ m }) {
      const target = m.quoted || m
      const json = JSON.stringify(target.message, null, 1).slice(0, 3000)
      await m.reply(
        `🔍 *MESSAGE STRUCTURE*\n\n` +
          `📦 Type: ${target.type}\n` +
          `🆔 ID: ${target.id || m.id}\n` +
          `👤 Sender: ${target.sender || m.sender}\n\n` +
          `\`\`\`${json}\`\`\``
      )
    }
  },
  {
    name: 'permit',
    alias: ['allowuser'],
    category: 'TOOLS',
    desc: 'Let a specific user bypass private mode',
    usage: '.permit @user',
    owner: true,
    async run({ m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Tag or reply to the person to permit.')
      const number = target.split('@')[0].split(':')[0]
      await DB.sudo.set({ number }, { at: Date.now(), permitted: true })
      const { invalidateCaches } = await import('../../src/handler.js')
      invalidateCaches()
      await m.reply({ text: `✅ @${number} can now use the bot in private mode.`, mentions: [target] })
    }
  },
  {
    name: 'areact',
    alias: ['autoreact'],
    category: 'TOOLS',
    desc: 'Auto-react to every message in this chat',
    usage: '.areact 🔥 | .areact off',
    admin: true,
    async run({ m, args }) {
      const arg = args[0]
      if (!arg) {
        const row = await DB.groups.findOne({ id: m.chat })
        return m.reply(`😀 *Auto-react:* ${row?.areact || 'off'}\n\nUsage: *.areact 🔥* or *.areact off*`)
      }
      if (arg.toLowerCase() === 'off') {
        await DB.groups.set({ id: m.chat }, { areact: null })
        return m.reply('✅ Auto-react turned off.')
      }
      if (arg.length > 8) return m.reply('❌ That does not look like an emoji.')
      await DB.groups.set({ id: m.chat }, { areact: arg })
      await m.reply(`✅ I will now react ${arg} to every message here.`)
    },

    async before({ m }) {
      if (m.fromMe || !m.chat) return false
      const row = await DB.groups.findOne({ id: m.chat })
      if (!row?.areact) return false
      await m.react(row.areact).catch(() => {})
      return false // never swallow the message
    }
  },
  {
    name: 'msgs',
    alias: ['msgcount'],
    category: 'TOOLS',
    desc: 'Show how many messages each member has sent',
    usage: '.msgs',
    group: true,
    async run({ m }) {
      const rows = (await DB.users.all()).filter((r) => r.msgCount > 0)
      if (!rows.length) return m.reply('📊 No message statistics recorded yet.')
      const top = rows.sort((a, b) => (b.msgCount || 0) - (a.msgCount || 0)).slice(0, 15)
      await m.reply({
        text:
          `📊 *MESSAGE COUNT*\n\n` +
          top.map((r, i) => `${i + 1}. @${r.id} — ${r.msgCount}`).join('\n'),
        mentions: top.map((r) => `${r.id}@s.whatsapp.net`)
      })
    },

    /** silently tally messages so the command has data */
    async before({ m }) {
      if (m.fromMe || !m.body) return false
      const id = m.senderNumber
      if (id) await DB.users.inc({ id }, 'msgCount', 1).catch(() => {})
      return false
    }
  },
  {
    name: 'getdevice',
    alias: ['device'],
    category: 'UTILITIES',
    desc: 'Detect which device sent a message',
    usage: '.getdevice (reply to a message)',
    async run({ m }) {
      const id = m.quoted?.id || m.id
      let device = 'Android'
      if (id.length > 21) device = 'Web / Desktop'
      else if (id.startsWith('3EB0') || id.startsWith('3A')) device = 'iOS'
      else if (id.length === 16) device = 'Desktop'
      await m.reply(`📱 *Device detection*\n\n🆔 ${id}\n💻 Likely: *${device}*\n\n_Based on message-ID format; not always exact._`)
    }
  },
  {
    name: 'quotedinfo',
    alias: ['qinfo'],
    category: 'TOOLS',
    desc: 'Details about the message you replied to',
    usage: '.quotedinfo (reply)',
    async run({ m }) {
      if (!m.quoted) return m.reply('📩 Reply to a message with *.quotedinfo*')
      await m.reply(
        `📩 *QUOTED MESSAGE*\n\n` +
          `👤 From: @${m.quoted.senderNumber}\n` +
          `📦 Type: ${m.quoted.type}\n` +
          `🖼️ Media: ${m.quoted.isMedia ? 'yes' : 'no'}\n` +
          `💬 Text: ${(m.quoted.text || '_none_').slice(0, 300)}`,
        { mentions: [m.quoted.sender] }
      )
    }
  }
]
