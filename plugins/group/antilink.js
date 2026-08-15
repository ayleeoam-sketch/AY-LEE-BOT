import DB from '../../src/lib/database.js'
import { urlsIn } from '../../src/lib/utils.js'

/**
 * Demonstrates the middleware hook: `before` runs on EVERY message,
 * ahead of command parsing. Return true to swallow the message.
 */

const cache = new Map() // chat -> { mode, at }
const TTL = 60_000

async function settings(chat) {
  const hit = cache.get(chat)
  if (hit && Date.now() - hit.at < TTL) return hit
  const row = await DB.groups.findOne({ id: chat })
  const val = { mode: row?.antilink || 'off', at: Date.now() }
  cache.set(chat, val)
  return val
}

export default {
  name: 'antilink',
  category: 'GROUP',
  desc: 'Auto-moderate links posted in the group',
  usage: '.antilink on | warn | kick | off',
  group: true,
  admin: true,

  async run({ m, args }) {
    const mode = (args[0] || '').toLowerCase()
    const valid = ['on', 'delete', 'warn', 'kick', 'off']
    if (!valid.includes(mode)) {
      const current = (await settings(m.chat)).mode
      return m.reply(
        `🔗 *Antilink:* currently *${current}*\n\n` +
          `.antilink on    - delete links\n` +
          `.antilink warn  - delete + warn the sender\n` +
          `.antilink kick  - delete + remove the sender\n` +
          `.antilink off   - disable`
      )
    }
    const stored = mode === 'on' ? 'delete' : mode
    await DB.groups.set({ id: m.chat }, { antilink: stored })
    cache.delete(m.chat)
    await m.reply(`✅ Antilink set to *${stored}*`)
  },

  /* ---------------------- middleware ---------------------- */
  async before({ sock, m }) {
    if (!m.isGroup || m.fromMe) return false
    if (m.isAdmin || m.isSudo) return false

    const { mode } = await settings(m.chat)
    if (mode === 'off') return false

    const links = urlsIn(m.body).filter((u) => /chat\.whatsapp\.com|wa\.me|t\.me|https?:\/\//i.test(u))
    if (!links.length) return false

    // bot must be admin to delete
    if (!m.isBotAdmin) {
      await m.reply('⚠️ A link was posted but I need admin rights to remove it.')
      return true
    }

    await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})

    if (mode === 'delete') {
      await sock.sendMessage(m.chat, {
        text: `🔗 @${m.senderNumber} links are not allowed here.`,
        mentions: [m.sender]
      })
      return true
    }

    if (mode === 'warn') {
      await DB.warns.inc({ id: m.sender, chat: m.chat }, 'count', 1)
      const row = await DB.warns.findOne({ id: m.sender, chat: m.chat })
      const count = row?.count || 1
      if (count >= 3) {
        await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {})
        await DB.warns.delete({ id: m.sender, chat: m.chat })
        await sock.sendMessage(m.chat, {
          text: `🚫 @${m.senderNumber} removed after 3 link warnings.`,
          mentions: [m.sender]
        })
      } else {
        await sock.sendMessage(m.chat, {
          text: `⚠️ @${m.senderNumber} no links allowed. Warning *${count}/3*.`,
          mentions: [m.sender]
        })
      }
      return true
    }

    if (mode === 'kick') {
      await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {})
      await sock.sendMessage(m.chat, {
        text: `🚫 @${m.senderNumber} was removed for posting a link.`,
        mentions: [m.sender]
      })
      return true
    }

    return true
  }
}
