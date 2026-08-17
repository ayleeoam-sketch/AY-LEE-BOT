import { getJson, race } from '../../src/lib/api.js'

/**
 * Horoscope — in nearly every big bot's menu and missing from ours.
 * Keyless: the aztro API died in 2023, so this uses the two community
 * endpoints that are still up, with a graceful message if both are down.
 */

const SIGNS = {
  aries: { emoji: '♈', dates: 'Mar 21 – Apr 19' },
  taurus: { emoji: '♉', dates: 'Apr 20 – May 20' },
  gemini: { emoji: '♊', dates: 'May 21 – Jun 20' },
  cancer: { emoji: '♋', dates: 'Jun 21 – Jul 22' },
  leo: { emoji: '♌', dates: 'Jul 23 – Aug 22' },
  virgo: { emoji: '♍', dates: 'Aug 23 – Sep 22' },
  libra: { emoji: '♎', dates: 'Sep 23 – Oct 22' },
  scorpio: { emoji: '♏', dates: 'Oct 23 – Nov 21' },
  sagittarius: { emoji: '♐', dates: 'Nov 22 – Dec 21' },
  capricorn: { emoji: '♑', dates: 'Dec 22 – Jan 19' },
  aquarius: { emoji: '♒', dates: 'Jan 20 – Feb 18' },
  pisces: { emoji: '♓', dates: 'Feb 19 – Mar 20' }
}

const ALIASES = { scorpion: 'scorpio', sagitarius: 'sagittarius', capricornus: 'capricorn' }

export default [
  {
    name: 'horoscope',
    alias: ['zodiac', 'zodiak', 'astro'],
    category: 'FUN',
    desc: 'Daily horoscope for any star sign',
    usage: '.horoscope leo  |  .horoscope leo tomorrow',
    cooldown: 6,
    async run({ m, args, prefix }) {
      const raw = (args[0] || '').toLowerCase()
      const sign = ALIASES[raw] || raw
      const when = ['today', 'tomorrow', 'yesterday'].includes((args[1] || '').toLowerCase())
        ? args[1].toLowerCase()
        : 'today'

      if (!SIGNS[sign]) {
        const list = Object.entries(SIGNS)
          .map(([n, s]) => `${s.emoji} *${n}* — ${s.dates}`)
          .join('\n')
        return m.reply(
          `🔮 *Usage:* ${prefix}horoscope <sign> [today|tomorrow]\n\n${list}\n\n` +
            `Example: *${prefix}horoscope leo tomorrow*`
        )
      }

      await m.react('🔮')
      try {
        const text = await race([
          async () => {
            const d = await getJson(
              `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${sign}&day=${when}`
            )
            return d?.data?.horoscope_data
          },
          async () => {
            const d = await getJson(`https://aztro.sameerkumar.website/?sign=${sign}&day=${when}`, { method: 'POST' })
            return d?.description
          }
        ])

        const s = SIGNS[sign]
        await m.reply(
          `╭━━━〔 *HOROSCOPE* 〕━━━╮\n` +
            `┃ ${s.emoji} *${sign.toUpperCase()}*\n` +
            `┃ 📅 ${s.dates}\n` +
            `┃ 🕒 ${when}\n` +
            `╰━━━━━━━━━━━━━━━━╯\n\n${text}`
        )
        await m.react('✅')
      } catch {
        await m.react('❌')
        await m.reply(`🔮 The horoscope services are down right now. Try again later.`)
      }
    }
  }
]
