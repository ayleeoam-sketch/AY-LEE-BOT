import { getJson, getBuffer } from '../../src/lib/api.js'

/**
 * Matching anime couple DPs - people screenshot these constantly.
 *   .couple   -> sends two matching-style anime pics (his & hers)
 *
 * waifu.im is keyless; if it is ever down we tell the user plainly.
 */

export async function fetchWaifuPics(count = 2) {
  const out = []
  for (let i = 0; i < count; i++) {
    const d = await getJson('https://api.waifu.im/search?included_tags=waifu')
    const url = d?.images?.[0]?.url
    if (url) out.push(url)
  }
  return out
}

export default {
  name: 'couple',
  alias: ['couplepp', 'matchingdp'],
  category: 'IMAGE',
  desc: 'Send two matching anime couple profile pictures',
  usage: '.couple',
  cooldown: 10,
  async run({ m }) {
    await m.react('💑')
    try {
      const urls = await fetchWaifuPics(2)
      if (urls.length < 2) throw new Error('the picture service is busy right now')

      await m.reply({ image: await getBuffer(urls[0]), caption: '💑 *Matching couple DP* — 1/2 🧔' })
      await m.reply({ image: await getBuffer(urls[1]), caption: '💑 2/2 👩' })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
}
