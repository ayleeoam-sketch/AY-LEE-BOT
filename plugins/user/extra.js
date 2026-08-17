import { getVar, setVar } from '../../src/lib/vars.js'

export default [
  {
    name: 'delete',
    alias: ['del', 'unsend'],
    category: 'USER',
    desc: 'Delete a bot message or toggle automatic command cleanup',
    usage: '.del on | off  (or reply to a bot message with .del)',
    async run({ sock, m, args }) {
      const sub = (args[0] || '').toLowerCase()
      if (sub === 'on' || sub === 'off') {
        if (!m.isSudo) return m.reply('🚫 Only the owner can change automatic command cleanup.')
        await setVar('AUTO_DELETE_COMMANDS', sub === 'on' ? 'true' : 'false')
        return m.reply(
          `✅ Automatic command cleanup turned *${sub}*.` +
            (sub === 'on'
              ? '\n\n_Command messages and their bot replies will now be removed. I need group admin rights to delete members\' commands._'
              : '\n\n_Command messages and replies will now stay visible._')
        )
      }

      if (!m.quoted) {
        return m.reply(
          `🧹 *Automatic command cleanup:* *${getVar('AUTO_DELETE_COMMANDS') ? 'on' : 'off'}*\n\n` +
            `Owner: use *.del on* or *.del off*\n` +
            `Anyone: reply to one of my messages with *.del* to remove it.`
        )
      }

      // only allow deleting the bot's own messages unless you are admin
      if (!m.quoted.fromMe && !m.isAdmin && !m.isSudo) {
        return m.reply('🚫 You can only delete my messages, unless you are an admin.')
      }
      try {
        await sock.sendMessage(m.chat, { delete: m.quoted.key })
      } catch (e) {
        await m.reply(`❌ Could not delete: ${e.message}`)
      }
    }
  },
  {
    name: 'removepp',
    alias: ['delpp'],
    category: 'USER',
    desc: 'Remove the bot\'s profile picture',
    usage: '.removepp',
    owner: true,
    async run({ sock, m }) {
      try {
        await sock.removeProfilePicture(m.botJid)
        await m.reply('🗑️ Profile picture removed.')
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'pinchat',
    alias: ['pin'],
    category: 'USER',
    desc: 'Pin this chat',
    usage: '.pinchat',
    owner: true,
    async run({ sock, m }) {
      try {
        await sock.chatModify({ pin: true }, m.chat)
        await m.reply('📌 Chat pinned.')
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'unpinchat',
    alias: ['unpin'],
    category: 'USER',
    desc: 'Unpin this chat',
    usage: '.unpinchat',
    owner: true,
    async run({ sock, m }) {
      try {
        await sock.chatModify({ pin: false }, m.chat)
        await m.reply('📍 Chat unpinned.')
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'mute-chat',
    alias: ['mutechat'],
    category: 'USER',
    desc: 'Mute notifications for this chat',
    usage: '.mute-chat 8h | off',
    owner: true,
    async run({ sock, m, args }) {
      const map = { '8h': 8 * 60 * 60 * 1000, '1w': 7 * 24 * 60 * 60 * 1000, always: -1 }
      const arg = (args[0] || '8h').toLowerCase()
      try {
        if (arg === 'off') {
          await sock.chatModify({ mute: null }, m.chat)
          return m.reply('🔊 Chat unmuted.')
        }
        const ms = map[arg]
        if (!ms) return m.reply('📝 Usage: .mute-chat 8h | 1w | always | off')
        await sock.chatModify({ mute: ms }, m.chat)
        await m.reply(`🔇 Chat muted (${arg}).`)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'markread',
    alias: ['readchat'],
    category: 'USER',
    desc: 'Mark this chat as read',
    usage: '.markread',
    owner: true,
    async run({ sock, m }) {
      try {
        await sock.chatModify({ markRead: true, lastMessages: [m.raw] }, m.chat)
        await m.reply('✅ Chat marked as read.')
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
