import { renderEffect, effectList, TWO_LINE } from '../../src/lib/textfx.js'

/**
 * TEXTMAKER commands.
 *
 * The original menu used ephoto360 / textpro.me. Both now block automated
 * form submission (every request returns {"success":false,"code":-1}), so
 * these are rendered locally with SVG + sharp instead: instant, offline,
 * and nothing external to break.
 */

const makeCommand = (name) => ({
  name,
  category: 'TEXTMAKER',
  desc: `Create a "${name}" text image`,
  usage: TWO_LINE.includes(name) ? `.${name} line1 | line2` : `.${name} your text`,
  cooldown: 3,
  async run({ m, text }) {
    const body = text || m.quoted?.text
    if (!body) {
      return m.reply(
        `🎨 Give me some text:\n*.${name} VENOM MD*` +
          (TWO_LINE.includes(name) ? `\n\nThis effect supports two lines:\n*.${name} VENOM | MD BOT*` : '')
      )
    }
    if (body.length > 60) return m.reply('❌ Keep it under 60 characters.')

    const [t1, t2] = body.includes('|') ? body.split('|').map((s) => s.trim()) : [body.trim(), '']

    await m.react('🎨')
    try {
      const buffer = await renderEffect(name, t1, t2)
      await m.reply({ image: buffer, caption: `🎨 *${name}*` })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ Could not render that: ${e.message}`)
    }
  }
})

export default [
  ...effectList().map(makeCommand),
  {
    name: 'textmaker',
    alias: ['textfx', 'effects'],
    category: 'TEXTMAKER',
    desc: 'List every text effect available',
    usage: '.textmaker',
    async run({ m, prefix }) {
      const list = effectList()
      await m.reply(
        `🎨 *TEXT EFFECTS* (${list.length})\n\n` +
          list.map((n) => `• ${prefix}${n}`).join('\n') +
          `\n\n💡 Usage: *${prefix}neonlight VENOM MD*\n` +
          `Two-line effects (${TWO_LINE.join(', ')}) accept:\n*${prefix}gaming VENOM | MD BOT*`
      )
    }
  }
]
