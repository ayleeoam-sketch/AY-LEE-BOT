import { http } from '../../src/lib/api.js'

/**
 * News without a key: Google News RSS for any topic, tuned for Nigeria
 * (the audience), straddling local dailies and the big wires.
 */

/** Parse Google News RSS <item> blocks without an XML dependency. */
export function parseNewsRss(xmlText, limit = 8) {
  const clean = (s = '') =>
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()

  const items = []
  for (const m of String(xmlText).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]
    const title = clean(block.match(/<title>([\s\S]*?)<\/title>/)?.[1])
    const link = clean(block.match(/<link>([\s\S]*?)<\/link>/)?.[1])
    const pubDate = block.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim()
    const source = clean(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1])
    if (title && link) items.push({ title, link, pubDate, source })
    if (items.length >= limit) break
  }
  return items
}

const timeAgo = (dateStr) => {
  const t = Date.parse(dateStr || '')
  if (!t) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

export default {
  name: 'news',
  alias: ['headlines', 'naijanews'],
  category: 'SEARCH',
  desc: 'Fresh news headlines for any topic',
  usage: '.news naira  |  .news football  |  .news',
  cooldown: 10,
  async run({ m, text }) {
    const q = text?.trim()
    await m.react('📰')
    try {
      const url = q
        ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-NG&gl=NG&ceid=NG:en`
        : `https://news.google.com/rss?hl=en-NG&gl=NG&ceid=NG:en`
      const { data } = await http.get(url, { timeout: 25_000, responseType: 'text' })

      const items = parseNewsRss(String(data), 8)
      if (!items.length) return m.reply(`📰 No fresh headlines for "${q || 'Nigeria'}".`)

      const body = items
        .map(
          (it, i) =>
            `*${i + 1}.* ${it.title.replace(/ - [^-]+$/, '')}\n` +
            `   🏷️ ${it.source || 'news'}${it.pubDate ? `  🕑 ${timeAgo(it.pubDate)}` : ''}\n` +
            `   🔗 ${it.link}`
        )
        .join('\n\n')
      await m.reply(`📰 *NEWS*${q ? ` - _${q}_` : ' - TOP HEADLINES'}\n\n${body}`)
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
}
