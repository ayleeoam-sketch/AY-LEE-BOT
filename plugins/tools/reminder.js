import { schedule, listTasks, cancelTask, parseDuration, humanDelay } from '../../src/lib/scheduler.js'

/**
 * Reminders and scheduled messages.
 *
 * Stored in the database, so they survive restarts — the whole point. A
 * reminder that evaporates when the host redeploys is worse than no reminder.
 */

const numberOf = (jid) => String(jid).split('@')[0].split(':')[0]

export default [
  {
    name: 'remind',
    alias: ['reminder', 'remindme'],
    category: 'TOOLS',
    desc: 'Remind you about something later',
    usage: '.remind 30m call mum',
    cooldown: 3,
    async run({ m, args, prefix }) {
      const ms = parseDuration(args[0])
      const text = args.slice(1).join(' ').trim()

      if (!ms || !text) {
        return m.reply(
          `⏰ *Usage:* ${prefix}remind <when> <what>\n\n` +
            `*Examples*\n` +
            `▸ ${prefix}remind 30m call mum\n` +
            `▸ ${prefix}remind 2h30m check the oven\n` +
            `▸ ${prefix}remind 1d renew the server\n` +
            `▸ ${prefix}remind 90 pay the bill  _(bare number = minutes)_\n\n` +
            `_I remember across restarts._`
        )
      }
      if (ms > 30 * 86_400_000) return m.reply('⏰ A month is my limit. Pick something sooner.')

      const at = Date.now() + ms
      const id = await schedule({ chat: m.chat, text, at, owner: numberOf(m.sender), kind: 'reminder' })

      await m.reply(
        `⏰ *Reminder set*\n\n` +
          `┃ 📝 ${text}\n` +
          `┃ ⏳ In ${humanDelay(ms)}\n` +
          `┃ 🕒 ${new Date(at).toLocaleString()}\n` +
          `┃ 🎫 ID: *${id}*\n\n` +
          `_Cancel with ${prefix}delremind ${id} · list with ${prefix}reminders_`
      )
    }
  },
  {
    name: 'reminders',
    alias: ['listremind', 'myreminders'],
    category: 'TOOLS',
    desc: 'Everything you have queued',
    usage: '.reminders',
    async run({ m, prefix }) {
      const mine = await listTasks(numberOf(m.sender))
      if (!mine.length) return m.reply(`⏰ Nothing queued.\n\nSet one: *${prefix}remind 30m call mum*`)

      const body = mine
        .map(
          (t) =>
            `🎫 *${t.id}* — in ${humanDelay(Math.max(0, t.at - Date.now()))}\n` +
            `   ${t.text.slice(0, 60)}${t.text.length > 60 ? '…' : ''}`
        )
        .join('\n\n')

      await m.reply(
        `╭━━━〔 *YOUR REMINDERS* 〕━━━╮\n${body}\n╰━━━━━━━━━━━━━━━━━╯\n\n_Cancel: ${prefix}delremind <id>_`
      )
    }
  },
  {
    name: 'delremind',
    alias: ['cancelremind', 'unremind'],
    category: 'TOOLS',
    desc: 'Cancel a reminder',
    usage: '.delremind A1B2C3',
    async run({ m, args, prefix }) {
      if (!args[0]) return m.reply(`📝 Usage: ${prefix}delremind <id>  — see ids with ${prefix}reminders`)
      const row = await cancelTask(args[0])
      if (!row) return m.reply(`❌ No reminder with id *${args[0].toUpperCase()}*.`)
      await m.reply(`🗑️ Cancelled: _${row.text.slice(0, 60)}_`)
    }
  },
  {
    name: 'schedule',
    alias: ['schedulemsg', 'sendlater'],
    category: 'TOOLS',
    desc: 'Send a message to this chat later',
    usage: '.schedule 2h Good morning everyone',
    owner: true,
    async run({ m, args, prefix }) {
      const ms = parseDuration(args[0])
      const text = args.slice(1).join(' ').trim()
      if (!ms || !text) {
        return m.reply(
          `📨 *Usage:* ${prefix}schedule <when> <message>\n\n` +
            `Sends it to *this chat* later, as the bot — no "reminder" wrapper.\n\n` +
            `Example: *${prefix}schedule 8h Good morning everyone ☀️*`
        )
      }
      const at = Date.now() + ms
      const id = await schedule({ chat: m.chat, text, at, owner: numberOf(m.sender), kind: 'message' })
      await m.reply(
        `📨 *Scheduled*\n\n┃ 🕒 ${new Date(at).toLocaleString()}\n┃ ⏳ In ${humanDelay(ms)}\n┃ 🎫 ID: *${id}*\n\n_Cancel: ${prefix}delremind ${id}_`
      )
    }
  }
]
