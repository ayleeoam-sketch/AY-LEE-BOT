import { getJson, getBuffer, race } from '../../src/lib/api.js'
import { pick } from '../../src/lib/utils.js'

/**
 * ANIME lookups.
 *
 * Kitsu is the primary source: it stayed up throughout testing while Jikan
 * (MyAnimeList) returned 504/429 intermittently. Jikan is kept as a fallback
 * because it has richer data when it is healthy.
 */

const clean = (s, n = 700) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[Written by MAL Rewrite\]/gi, '')
    .trim()
    .slice(0, n)

async function searchAnime(query) {
  return race([
    async () => {
      const r = await getJson(
        `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=1`
      )
      const a = r.data?.[0]?.attributes
      if (!a) throw new Error('no results')
      return {
        title: a.canonicalTitle,
        japanese: a.titles?.ja_jp,
        synopsis: a.synopsis,
        episodes: a.episodeCount,
        status: a.status,
        rating: a.averageRating ? `${a.averageRating}/100` : null,
        started: a.startDate,
        ended: a.endDate,
        ageRating: a.ageRatingGuide || a.ageRating,
        duration: a.episodeLength ? `${a.episodeLength} min` : null,
        image: a.posterImage?.original || a.posterImage?.large,
        source: 'Kitsu'
      }
    },
    async () => {
      const r = await getJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`)
      const a = r.data?.[0]
      if (!a) throw new Error('no results')
      return {
        title: a.title,
        japanese: a.title_japanese,
        synopsis: a.synopsis,
        episodes: a.episodes,
        status: a.status,
        rating: a.score ? `${a.score}/10` : null,
        started: a.aired?.from?.slice(0, 10),
        ended: a.aired?.to?.slice(0, 10),
        ageRating: a.rating,
        duration: a.duration,
        genres: a.genres?.map((g) => g.name).join(', '),
        image: a.images?.jpg?.large_image_url,
        source: 'MyAnimeList'
      }
    }
  ])
}

const card = (d) =>
  `╭━━━〔 *ANIME* 〕━━━╮\n` +
  `┃ 📺 ${d.title}\n` +
  (d.japanese ? `┃ 🇯🇵 ${d.japanese}\n` : '') +
  `┃ 🎬 Episodes: ${d.episodes || 'n/a'}\n` +
  `┃ 📊 Status: ${d.status || 'n/a'}\n` +
  (d.rating ? `┃ ⭐ Rating: ${d.rating}\n` : '') +
  (d.duration ? `┃ ⏱️ Length: ${d.duration}\n` : '') +
  `┃ 📅 Aired: ${d.started || '?'}${d.ended ? ` → ${d.ended}` : ''}\n` +
  (d.genres ? `┃ 🏷️ ${d.genres}\n` : '') +
  (d.ageRating ? `┃ 🔞 ${d.ageRating}\n` : '') +
  `╰━━━━━━━━━━━━━━━╯\n\n📝 ${clean(d.synopsis) || 'No synopsis available.'}`

export default [
  {
    name: 'manga',
    category: 'ANIME',
    desc: 'Search for a manga',
    usage: '.manga berserk',
    cooldown: 8,
    async run({ m, text }) {
      if (!text) return m.reply('📚 Usage: *.manga berserk*')
      await m.react('🔎')
      try {
        const d = await race([
          async () => {
            const r = await getJson(
              `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(text)}&page[limit]=1`
            )
            const a = r.data?.[0]?.attributes
            if (!a) throw new Error('no results')
            return {
              title: a.canonicalTitle, synopsis: a.synopsis, chapters: a.chapterCount,
              volumes: a.volumeCount, status: a.status,
              rating: a.averageRating ? `${a.averageRating}/100` : null,
              started: a.startDate, image: a.posterImage?.original
            }
          },
          async () => {
            const r = await getJson(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(text)}&limit=1`)
            const a = r.data?.[0]
            if (!a) throw new Error('no results')
            return {
              title: a.title, synopsis: a.synopsis, chapters: a.chapters, volumes: a.volumes,
              status: a.status, rating: a.score ? `${a.score}/10` : null,
              started: a.published?.from?.slice(0, 10), image: a.images?.jpg?.large_image_url
            }
          }
        ])
        const caption =
          `╭━━━〔 *MANGA* 〕━━━╮\n` +
          `┃ 📚 ${d.title}\n` +
          `┃ 📖 Chapters: ${d.chapters || 'n/a'}\n` +
          `┃ 📗 Volumes: ${d.volumes || 'n/a'}\n` +
          `┃ 📊 Status: ${d.status || 'n/a'}\n` +
          (d.rating ? `┃ ⭐ Rating: ${d.rating}\n` : '') +
          `┃ 📅 Started: ${d.started || 'n/a'}\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n📝 ${clean(d.synopsis)}`
        if (d.image) await m.reply({ image: await getBuffer(d.image), caption })
        else await m.reply(caption)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'character',
    alias: ['anichar'],
    category: 'ANIME',
    desc: 'Look up an anime character',
    usage: '.character luffy',
    cooldown: 8,
    async run({ m, text }) {
      if (!text) return m.reply('👤 Usage: *.character luffy*')
      await m.react('🔎')
      try {
        const d = await race([
          async () => {
            const r = await getJson(
              `https://kitsu.io/api/edge/characters?filter[name]=${encodeURIComponent(text)}&page[limit]=1`
            )
            const a = r.data?.[0]?.attributes
            if (!a) throw new Error('no results')
            return { name: a.canonicalName, japanese: a.names?.ja_jp, about: a.description, image: a.image?.original }
          },
          async () => {
            const r = await getJson(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(text)}&limit=1`)
            const a = r.data?.[0]
            if (!a) throw new Error('no results')
            return { name: a.name, japanese: a.name_kanji, about: a.about, favorites: a.favorites, image: a.images?.jpg?.image_url }
          }
        ])
        const caption =
          `👤 *${d.name}*\n` +
          (d.japanese ? `🇯🇵 ${d.japanese}\n` : '') +
          (d.favorites ? `❤️ ${d.favorites.toLocaleString()} favourites\n` : '') +
          `\n📝 ${clean(d.about, 800) || 'No description available.'}`
        if (d.image) await m.reply({ image: await getBuffer(d.image), caption })
        else await m.reply(caption)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ No character found for "${text}".`)
      }
    }
  },
  {
    name: 'airing',
    alias: ['season', 'seasonal'],
    category: 'ANIME',
    desc: 'Anime airing this season',
    usage: '.airing',
    cooldown: 15,
    async run({ m }) {
      await m.react('📺')
      try {
        const list = await race([
          async () => {
            const r = await getJson(
              'https://kitsu.io/api/edge/anime?filter[status]=current&sort=-userCount&page[limit]=10'
            )
            const rows = r.data || []
            if (!rows.length) throw new Error('none')
            return rows.map((x) => ({
              title: x.attributes.canonicalTitle,
              rating: x.attributes.averageRating ? `${Math.round(x.attributes.averageRating)}%` : 'n/a',
              eps: x.attributes.episodeCount || '?'
            }))
          },
          async () => {
            const r = await getJson('https://api.jikan.moe/v4/seasons/now?limit=10')
            const rows = r.data || []
            if (!rows.length) throw new Error('none')
            return rows.map((x) => ({ title: x.title, rating: x.score ? `${x.score}/10` : 'n/a', eps: x.episodes || '?' }))
          }
        ])
        await m.reply(
          `📺 *AIRING NOW*\n\n` +
            list.map((a, i) => `*${i + 1}.* ${a.title}\n   ⭐ ${a.rating}  🎬 ${a.eps} eps`).join('\n\n')
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'animerec',
    alias: ['randomanime'],
    category: 'ANIME',
    desc: 'Get a random anime recommendation',
    usage: '.animerec',
    cooldown: 10,
    async run({ m }) {
      await m.react('🎲')
      try {
        const d = await race([
          async () => {
            // Kitsu has no random endpoint - page into the popular list
            const offset = Math.floor(Math.random() * 400)
            const r = await getJson(
              `https://kitsu.io/api/edge/anime?sort=-userCount&page[limit]=1&page[offset]=${offset}`
            )
            const a = r.data?.[0]?.attributes
            if (!a) throw new Error('none')
            return {
              title: a.canonicalTitle, synopsis: a.synopsis, episodes: a.episodeCount,
              status: a.status, rating: a.averageRating ? `${a.averageRating}/100` : null,
              started: a.startDate, image: a.posterImage?.original
            }
          },
          async () => {
            const r = await getJson('https://api.jikan.moe/v4/random/anime')
            const a = r.data
            if (!a) throw new Error('none')
            return {
              title: a.title, synopsis: a.synopsis, episodes: a.episodes, status: a.status,
              rating: a.score ? `${a.score}/10` : null, started: a.aired?.from?.slice(0, 10),
              genres: a.genres?.map((g) => g.name).join(', '), image: a.images?.jpg?.large_image_url
            }
          }
        ])
        const caption = `🎲 *RANDOM PICK*\n\n` + card(d).split('\n').slice(1).join('\n')
        if (d.image) await m.reply({ image: await getBuffer(d.image), caption })
        else await m.reply(caption)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'animequote',
    alias: ['aniquote'],
    category: 'ANIME',
    desc: 'Random anime quote',
    usage: '.animequote',
    cooldown: 5,
    async run({ m }) {
      try {
        const d = await race([
          async () => {
            const r = await getJson('https://animechan.io/api/v1/quotes/random')
            const q = r?.data
            if (!q?.content) throw new Error('none')
            return { quote: q.content, character: q.character?.name, anime: q.anime?.name }
          },
          async () => {
            const r = await getJson('https://yurippe.vercel.app/api/quotes?random=1')
            const q = Array.isArray(r) ? r[0] : r
            if (!q?.quote) throw new Error('none')
            return { quote: q.quote, character: q.character, anime: q.show }
          }
        ])
        await m.reply(
          `🎌 _"${d.quote}"_\n\n— *${d.character || 'Unknown'}*\n📺 ${d.anime || 'Unknown'}`
        )
      } catch {
        // curated fallback so the command never simply fails
        const q = pick([
          { quote: 'People\'s lives don\'t end when they die. It ends when they lose faith.', character: 'Itachi Uchiha', anime: 'Naruto' },
          { quote: 'The world is not beautiful, therefore it is.', character: 'Kino', anime: "Kino's Journey" },
          { quote: 'A lesson without pain is meaningless.', character: 'Edward Elric', anime: 'Fullmetal Alchemist' },
          { quote: 'Power comes in response to a need, not a desire.', character: 'Goku', anime: 'Dragon Ball Z' }
        ])
        await m.reply(`🎌 _"${q.quote}"_\n\n— *${q.character}*\n📺 ${q.anime}`)
      }
    }
  },
  {
    name: 'animegif',
    alias: ['anigif'],
    category: 'ANIME',
    desc: 'Random anime reaction GIF',
    usage: '.animegif [reaction]',
    cooldown: 6,
    async run({ m, text }) {
      try {
        const all = await getJson('https://api.otakugifs.xyz/gif/allreactions')
        const reactions = all.reactions || []
        const want = text?.trim().toLowerCase()
        const chosen = want && reactions.includes(want) ? want : pick(reactions)
        const d = await getJson(`https://api.otakugifs.xyz/gif?reaction=${chosen}`)
        await m.reply({
          video: await getBuffer(d.url),
          caption: `🎌 *${chosen}*` + (want && !reactions.includes(want) ? `\n\n_"${want}" is not available, sent a random one._` : ''),
          gifPlayback: true
        })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'reactions',
    alias: ['gifllist', 'animelist'],
    category: 'ANIME',
    desc: 'List every anime reaction available',
    usage: '.reactions',
    cooldown: 10,
    async run({ m, prefix }) {
      try {
        const d = await getJson('https://api.otakugifs.xyz/gif/allreactions')
        const r = d.reactions || []
        await m.reply(
          `🎌 *ANIME REACTIONS* (${r.length})\n\n${r.join(', ')}\n\n` +
            `💡 Use *${prefix}animegif <name>* or the direct commands like *${prefix}hug @user*`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'waifu',
    alias: ['randomwaifu'],
    category: 'ANIME',
    desc: 'Random waifu image',
    usage: '.waifu',
    cooldown: 6,
    async run({ m }) {
      try {
        const url = await race([
          async () => (await getJson('https://api.otakugifs.xyz/gif?reaction=happy')).url,
          async () => (await getJson('https://nekos.best/api/v2/waifu')).results?.[0]?.url
        ])
        const buffer = await getBuffer(url)
        const isGif = /\.gif$/i.test(url)
        await m.reply({ [isGif ? 'video' : 'image']: buffer, caption: '💮 Waifu', gifPlayback: isGif })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'animenews',
    alias: ['aninews'],
    category: 'ANIME',
    desc: 'Latest anime news headlines',
    usage: '.animenews',
    cooldown: 20,
    async run({ m }) {
      await m.react('📰')
      try {
        const { http } = await import('../../src/lib/api.js')

        /** pull headlines out of any RSS feed */
        const parse = (xml) =>
          [...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/g)]
            .slice(0, 8)
            .map((x) => {
              const block = x[0]
              const title = block
                .match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]
                ?.replace(/&amp;/g, '&')
                .replace(/&#039;|&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .trim()
              const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim()
              return { title, link }
            })
            .filter((i) => i.title)

        // ANN blocks datacenter IPs (403), so try several feeds in order.
        // All of these were verified reachable from a server.
        const FEEDS = [
          'https://myanimelist.net/rss/news.xml',
          'https://animecorner.me/feed/',
          'https://www.livechart.me/feeds/headlines',
          'https://animeuknews.net/feed/'
        ]

        let items = []
        for (const url of FEEDS) {
          try {
            const { data } = await http.get(url, { timeout: 20_000, responseType: 'text' })
            items = parse(data)
            if (items.length) break
          } catch {}
        }
        if (!items.length) throw new Error('every news feed is unreachable right now')

        await m.reply(
          `📰 *ANIME NEWS*\n\n` +
            items.map((i, n) => `*${n + 1}.* ${i.title}${i.link ? `\n   🔗 ${i.link}` : ''}`).join('\n\n')
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
