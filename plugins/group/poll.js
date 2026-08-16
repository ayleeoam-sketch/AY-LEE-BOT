/**
 * Native WhatsApp polls - the single most-requested group tool.
 * No API key, no service: the poll is a real WhatsApp poll people can tap.
 */

export function parsePoll(text) {
  const parts = String(text || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
  const question = parts.shift()
  return { question, options: parts }
}

export default {
  name: 'poll',
  alias: ['vote', 'mkpoll'],
  category: 'GROUP',
  desc: 'Create a native WhatsApp poll everyone can tap',
  usage: '.poll Best soup? | Egusi | Ogbono | Bitterleaf',
  cooldown: 10,
  async run({ sock, m, text }) {
    const { question, options } = parsePoll(text)
    if (!question || options.length < 2) {
      return m.reply(
        '📊 Split the question and options with the | bar:\n\n' +
          '*.poll Best soup? | Egusi | Ogbono | Bitterleaf*\n\n' +
          '_2 to 12 options._'
      )
    }
    if (options.length > 12) return m.reply('📊 WhatsApp polls allow at most *12* options.')

    await sock.sendMessage(
      m.chat,
      {
        poll: {
          name: question.slice(0, 300),
          values: options.map((o) => o.slice(0, 100)),
          selectableCount: 1
        }
      },
      { quoted: m.raw }
    )
  }
}
