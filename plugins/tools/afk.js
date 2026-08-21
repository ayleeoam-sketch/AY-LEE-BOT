```js
import DB from '../../src/lib/database.js'
import { runtime } from '../../src/lib/utils.js'

/**
 * AFK SYSTEM
 *
 * .afk [reason] -> Enable AFK
 * .afk off      -> Disable AFK
 *
 * Features:
 * - Automatically removes AFK when the user sends a message
 * - Notifies users when they mention an AFK user
 * - Notifies users when they reply to an AFK user's message
 * - Tells people that the AFK user will reply when they return
 * - .afk off immediately disables AFK
 */

export default {
  name: 'afk',
  category: 'TOOLS',
  desc: 'Mark yourself as away',
  usage: '.afk [reason] | .afk off',

  async run({ m, text }) {
    const input = String(text || '').trim()
    const lower = input.toLowerCase()

    /* =========================================================
     * DISABLE AFK
     * ========================================================= */

    if (lower === 'off') {
      const existing = await DB.afk.findOne({
        id: m.sender
      })

      if (!existing) {
        return m.reply('✅ You are not currently AFK.')
      }

      await DB.afk.delete({
        id: m.sender
      })

      return m.reply(
        '👋 AFK mode disabled.\n' +
        'Welcome back!'
      )
    }

    /* =========================================================
     * ENABLE AFK
     * ========================================================= */

    const reason =
      input || 'no reason given'

    await DB.afk.set(
      { id: m.sender },
      {
        reason,
        since: Date.now()
      }
    )

    await m.reply(
      `😴 *AFK MODE ENABLED*\n\n` +
      `📝 *Reason:* ${reason}\n` +
      `📩 I will notify anyone who mentions or replies to you.\n\n` +
      `💬 *When I'm back, I'll reply to your message.*\n\n` +
      `Use *.afk off* to disable AFK.`
    )

    return true
  },

  /* =========================================================
   * BEFORE MESSAGE HOOK
   * ========================================================= */

  async before({ sock, m }) {
    if (m.fromMe || !m.body) {
      return false
    }

    const body =
      String(m.body || '').trim()

    /* =========================================================
     * DON'T PROCESS .afk OFF AS A RETURN MESSAGE
     * ========================================================= */

    if (
      body.toLowerCase() === '.afk off' ||
      body.toLowerCase().startsWith('.afk off ')
    ) {
      return false
    }

    /* =========================================================
     * 1. CHECK IF CURRENT USER IS AFK
     * ========================================================= */

    const mine =
      await DB.afk.findOne({
        id: m.sender
      })

    if (mine) {
      /*
       * Any normal message means the user has returned.
       */

      if (
        !body.toLowerCase().startsWith('.afk')
      ) {
        await DB.afk.delete({
          id: m.sender
        })

        await sock.sendMessage(
          m.chat,
          {
            text:
              `👋 *Welcome back* @${m.senderNumber}!\n\n` +
              `⏱️ You were away for *${runtime(
                Date.now() - mine.since
              )}*.\n\n` +
              `💬 Your AFK mode has been disabled.`,
            mentions: [m.sender]
          },
          {
            quoted: m.raw
          }
        )
      }
    }

    /* =========================================================
     * 2. FIND MENTIONED / QUOTED USERS
     * ========================================================= */

    const targets = [
      ...(Array.isArray(m.mentions)
        ? m.mentions
        : [])
    ]

    if (m.quoted?.sender) {
      targets.push(
        m.quoted.sender
      )
    }

    if (!targets.length) {
      return false
    }

    /* =========================================================
     * 3. REMOVE DUPLICATE TARGETS
     * ========================================================= */

    const uniqueTargets = [
      ...new Set(targets)
    ]

    /* =========================================================
     * 4. CHECK EACH TARGET FOR AFK
     * ========================================================= */

    for (
      const target of uniqueTargets
    ) {
      if (!target) {
        continue
      }

      if (
        target === m.sender
      ) {
        continue
      }

      /*
       * If the person used .afk off,
       * their database record has been removed,
       * so no AFK message will be sent.
       */

      const row =
        await DB.afk.findOne({
          id: target
        })

      if (!row) {
        continue
      }

      const targetNumber =
        target.split('@')[0]

      await sock.sendMessage(
        m.chat,
        {
          text:
            `😴 @${targetNumber} is currently *AFK*.\n\n` +
            `📝 *Reason:* ${row.reason}\n\n` +
            `💬 *When they're back, they'll reply to your message.*`,
          mentions: [target]
        },
        {
          quoted: m.raw
        }
      )
    }

    return false
  }
}
```
