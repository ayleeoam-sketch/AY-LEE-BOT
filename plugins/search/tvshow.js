import { getJson, getBuffer } from '../../src/lib/api.js'

/**
 * TV show lookup via TVmaze (breathing, keyless, generous free API).
 *   .tvshow stranger things
 */

const stripHtml = (s = '') =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function pickShowFields(d) {
  if (!d?.name) return null
  return {
    name: d.name,
    status: d.status || 'unknown',
    genres: (d.genres || []).join(', ') || 'unknown',
    rating: d.rating?.average != null ? `${d.rating.average}/10` : 'unrated',
    network: d.network?.name || d.webChannel?.name || 'unknown',
    premiered: d.premiered ? d.premiered.slice(0, 4) : 'n/a',
    summary: stripHtml(d.summary || 'No summary available.').slice(0, 700),
    image: d.image?.original || d.image?.medium || null,
    url: d.url || null
  }
}

export default {
  name: 'tvshow',
  alias: ['series', 'show'],
  category: 'SEARCH',
  desc: 'Look up a TV series: cast poster, rating, summary',
  usage: '.tvshow money heist',
  cooldown: 8,
  async run({ m, text }) {
    const q = (text || '').trim()
    if (!q) return m.reply('📺 Usage: *.tvshow stranger things*')
    await m.react('📺')
    try {
      const d = await getJson(
        `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(q)}`
      )
      const show = pickShowFields(d)
      if (!show) return m.reply(`📺 No TV show found for "${q}".`)

      const caption =
        `╭━━━〔 *TV SHOW* 〕━━━╮\n` +
        `┃ 📺 ${show.name}\n` +
        `┃ ⭐ ${show.rating}  🎭 ${show.genres}\n` +
        `┃ 📡 ${show.network}  📅 ${show.premiered}  📶 ${show.status}\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
        `${show.summary}\n\n🔗 ${show.url || ''}`

      const img = show.image ? await getBuffer(show.image).catch(() => null) : null
      if (img) {
        await m.reply({ image: img, caption })
      } else {
        await m.reply(caption)
      }
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      const msg = /Nothing found/.test(e.message) ? `📺 No TV show found for "${q}".` : `❌ ${e.message}`
      await m.reply(msg)
    }
  }
}
