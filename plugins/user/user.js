import { getBuffer } from '../../src/lib/api.js'
import { toJid } from '../../src/lib/utils.js'

export default [
  {
    name: 'pp',
    alias: ['getpp', 'profilepic'],
    category: 'USER',
    desc: 'Get someone\'s profile picture',
    usage: '.pp [@user]',
    cooldown: 5,
    async run({ sock, m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : m.sender)
      try {
        const url = await sock.profilePictureUrl(target, 'image')
        await m.reply({
          image: await getBuffer(url),
          caption: `🖼️ Profile picture of @${target.split('@')[0]}`,
          mentions: [target]
        })
      } catch {
        await m.reply('❌ No profile picture, or it is hidden by their privacy settings.')
      }
    }
  },
  {
    name: 'setpp',
    category: 'USER',
    desc: 'Change the bot\'s profile picture',
    usage: '.setpp (reply to an image)',
    owner: true,
    async run({ sock, m }) {
      const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
      if (!src) return m.reply('🖼️ Reply to an image with *.setpp*')
      try {
        await sock.updateProfilePicture(m.botJid, await src.download())
        await m.reply('✅ Profile picture updated.')
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'setname',
    alias: ['setbotname'],
    category: 'USER',
    desc: 'Change the bot\'s display name',
    usage: '.setname VENOM MD',
    owner: true,
    async run({ sock, m, text }) {
      if (!text) return m.reply('📝 Usage: .setname VENOM MD BOT')
      await sock.updateProfileName(text)
      await m.reply(`✅ Display name changed to *${text}*`)
    }
  },
  {
    name: 'bio',
    alias: ['setbio', 'setstatus'],
    category: 'USER',
    desc: 'Change the bot\'s about/bio',
    usage: '.bio Powered by VENOM MD',
    owner: true,
    async run({ sock, m, text }) {
      if (!text) return m.reply('📝 Usage: .bio Powered by VENOM MD BOT')
      await sock.updateProfileStatus(text)
      await m.reply(`✅ Bio updated to:\n\n${text}`)
    }
  },
  {
    name: 'block',
    category: 'USER',
    desc: 'Block a user',
    usage: '.block @user',
    owner: true,
    async run({ sock, m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Tag, reply to, or give the number to block.')
      await sock.updateBlockStatus(target, 'block')
      await m.reply(`🚫 Blocked ${target.split('@')[0]}`)
    }
  },
  {
    name: 'unblock',
    category: 'USER',
    desc: 'Unblock a user',
    usage: '.unblock 2348012345678',
    owner: true,
    async run({ sock, m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Give the number to unblock.')
      await sock.updateBlockStatus(target, 'unblock')
      await m.reply(`✅ Unblocked ${target.split('@')[0]}`)
    }
  },
  {
    name: 'blocklist',
    category: 'USER',
    desc: 'Show everyone the bot has blocked',
    usage: '.blocklist',
    owner: true,
    async run({ sock, m }) {
      const list = await sock.fetchBlocklist()
      if (!list?.length) return m.reply('✅ Nobody is blocked.')
      await m.reply(`🚫 *BLOCKED* (${list.length})\n\n${list.map((j) => `• ${j.split('@')[0]}`).join('\n')}`)
    }
  },
  {
    name: 'forward',
    alias: ['fwd'],
    category: 'USER',
    desc: 'Forward the replied message to another chat',
    usage: '.forward 2348012345678 (reply to a message)',
    owner: true,
    async run({ sock, m, args }) {
      if (!m.quoted) return m.reply('📩 Reply to the message you want to forward.')
      const target = args[0]?.includes('@g.us') ? args[0] : args[0] ? toJid(args[0]) : null
      if (!target) return m.reply('📝 Usage: .forward 2348012345678 (or a group jid)')
      await sock.sendMessage(target, { forward: { key: m.quoted.key, message: m.quoted.message } })
      await m.reply(`✅ Forwarded to ${target.split('@')[0]}`)
    }
  },
  {
    name: 'archive',
    category: 'USER',
    desc: 'Archive this chat',
    usage: '.archive',
    owner: true,
    async run({ sock, m }) {
      await sock.chatModify({ archive: true, lastMessages: [m.raw] }, m.chat)
      await m.reply('📦 Chat archived.')
    }
  },
  {
    name: 'unarchive',
    category: 'USER',
    desc: 'Unarchive this chat',
    usage: '.unarchive',
    owner: true,
    async run({ sock, m }) {
      await sock.chatModify({ archive: false, lastMessages: [m.raw] }, m.chat)
      await m.reply('📂 Chat unarchived.')
    }
  },
  {
    name: 'clearchat',
    alias: ['clear'],
    category: 'USER',
    desc: 'Clear all messages in this chat',
    usage: '.clearchat',
    owner: true,
    async run({ sock, m }) {
      await sock.chatModify({ delete: true, lastMessages: [{ key: m.key, messageTimestamp: m.timestamp }] }, m.chat)
      await m.reply('🧹 Chat cleared.')
    }
  },
  {
    name: 'presence',
    alias: ['setpresence'],
    category: 'PRIVACY',
    desc: 'Set the bot presence',
    usage: '.presence available | unavailable | composing | recording',
    owner: true,
    async run({ sock, m, args }) {
      const valid = ['available', 'unavailable', 'composing', 'recording', 'paused']
      const p = (args[0] || '').toLowerCase()
      if (!valid.includes(p)) return m.reply(`📝 Usage: .presence ${valid.join(' | ')}`)
      await sock.sendPresenceUpdate(p, m.chat)
      await m.reply(`✅ Presence set to *${p}*`)
    }
  }
]
