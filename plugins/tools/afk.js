import DB from '../../src/lib/database.js'
import { runtime } from '../../src/lib/utils.js'

/**
 * AFK system: mark yourself away, and the bot answers on your behalf
 * when someone tags you. Returning to chat clears it automatically.
 */
export default {
  name: 'afk',
  category: 'TOOLS',
  desc: 'Mark yourself as away',
  usage: '.afk [reason]',

  async run({ m, text }) {
    await DB.afk.set({ id: m.sender }, { reason: text || 'no reason given', since: Date.now() })
    await m.reply(`😴 You are now AFK.\n📝 Reason: ${text || 'no reason given'}\n\nI will tell anyone who mentions you.`)
  },

  async before({ sock, m }) {
    if (m.fromMe || !m.body) return false

    /* 1. did an AFK user just come back? */
    const mine = await DB.afk.findOne({ id: m.sender })
    if (mine && !m.body.toLowerCase().startsWith('.afk')) {
      await DB.afk.delete({ id: m.sender })
      await sock.sendMessage(
        m.chat,
        {
          text: `👋 Welcome back @${m.senderNumber}!\n⏱️ You were away for *${runtime(Date.now() - mine.since)}*`,
          mentions: [m.sender]
        },
        { quoted: m.raw }
      )
      // don't stop - let their message still run as a command
    }

    /* 2. did they mention someone who is AFK? */
    const targets = [...(m.mentions || [])]
    if (m.quoted?.sender) targets.push(m.quoted.sender)
    if (!targets.length) return false

    for (const target of [...new Set(targets)]) {
      if (target === m.sender) continue
      const row = await DB.afk.findOne({ id: target })
      if (!row) continue
      await sock.sendMessage(
        m.chat,
        {
          text: `😴 @${target.split('@')[0]} is AFK\n📝 Reason: ${row.reason}\n⏱️ Away for: ${runtime(Date.now() - row.since)}`,
          mentions: [target]
        },
        { quoted: m.raw }
      )
    }
    return false
  }
}
