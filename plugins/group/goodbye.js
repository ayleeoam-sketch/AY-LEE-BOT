import DB from '../../src/lib/database.js'

/** Goodbye toggle - the actual sending is handled by welcome.js's hook. */
export default {
  name: 'goodbye',
  alias: ['setgoodbye', 'leavemsg'],
  category: 'GROUP',
  desc: 'Toggle or customise the goodbye message',
  usage: '.goodbye on | off | set <text>',
  group: true,
  admin: true,

  async run({ m, args, text }) {
    const sub = (args[0] || '').toLowerCase()
    const row = (await DB.groups.findOne({ id: m.chat })) || {}

    if (sub === 'on' || sub === 'off') {
      await DB.groups.set({ id: m.chat }, { goodbye: sub === 'on' })
      return m.reply(`👋 Goodbye messages turned *${sub}*.`)
    }

    if (sub === 'set') {
      const body = text.slice(3).trim()
      if (!body) return m.reply('📝 Usage: .goodbye set Farewell @user!')
      await DB.groups.set({ id: m.chat }, { goodbyeText: body, goodbye: true })
      return m.reply(`✅ Goodbye message saved:\n\n${body}`)
    }

    await m.reply(
      `👋 *GOODBYE SETTINGS*\n\n` +
        `Status: *${row.goodbye ? 'on' : 'off'}*\n` +
        `Message: ${row.goodbyeText || '_default_'}\n\n` +
        `.goodbye on\n.goodbye off\n.goodbye set <text>\n\n` +
        `Placeholders: @user @group @count`
    )
  }
}
