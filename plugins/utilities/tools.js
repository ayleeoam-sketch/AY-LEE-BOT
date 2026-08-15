import { getJson, getBuffer, race } from '../../src/lib/api.js'
import { comma } from '../../src/lib/utils.js'

export default [
  {
    name: 'weather',
    alias: ['cuaca'],
    category: 'UTILITIES',
    desc: 'Current weather for any city',
    usage: '.weather Lagos',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .weather Lagos')
      try {
        const geo = await getJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(text)}&count=1&language=en&format=json`
        )
        if (!geo.results?.length) return m.reply(`❌ No place called "${text}".`)
        const g = geo.results[0]

        const w = await getJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
            `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`
        )
        const c = w.current
        const codes = {
          0: '☀️ Clear sky', 1: '🌤️ Mainly clear', 2: '⛅ Partly cloudy', 3: '☁️ Overcast',
          45: '🌫️ Fog', 48: '🌫️ Rime fog', 51: '🌦️ Light drizzle', 53: '🌦️ Drizzle',
          55: '🌦️ Dense drizzle', 61: '🌧️ Light rain', 63: '🌧️ Rain', 65: '🌧️ Heavy rain',
          71: '🌨️ Light snow', 73: '🌨️ Snow', 75: '🌨️ Heavy snow', 80: '🌦️ Rain showers',
          81: '🌧️ Heavy showers', 82: '⛈️ Violent showers', 95: '⛈️ Thunderstorm',
          96: '⛈️ Thunderstorm + hail', 99: '⛈️ Severe thunderstorm'
        }
        await m.reply(
          `╭━━━〔 *WEATHER* 〕━━━╮\n` +
            `┃ 📍 ${g.name}, ${g.country}\n` +
            `┃ ${codes[c.weather_code] || '🌡️ Unknown'}\n` +
            `┃ 🌡️ Temp: ${c.temperature_2m}°C\n` +
            `┃ 🤔 Feels like: ${c.apparent_temperature}°C\n` +
            `┃ 💧 Humidity: ${c.relative_humidity_2m}%\n` +
            `┃ 💨 Wind: ${c.wind_speed_10m} km/h\n` +
            `┃ 🌧️ Precipitation: ${c.precipitation} mm\n` +
            `┃ 📈 High: ${w.daily.temperature_2m_max[0]}°C\n` +
            `┃ 📉 Low: ${w.daily.temperature_2m_min[0]}°C\n` +
            `╰━━━━━━━━━━━━━━━╯`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'wiki',
    alias: ['wikipedia'],
    category: 'UTILITIES',
    desc: 'Wikipedia summary',
    usage: '.wiki Nigeria',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .wiki Nigeria')
      try {
        const d = await getJson(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text.replace(/\s+/g, '_'))}`
        )
        if (!d.extract) return m.reply(`❌ Nothing found for "${text}".`)
        const caption = `📚 *${d.title}*\n\n${d.extract}\n\n🔗 ${d.content_urls?.desktop?.page || ''}`
        if (d.thumbnail?.source) {
          await m.reply({ image: await getBuffer(d.thumbnail.source), caption })
        } else {
          await m.reply(caption)
        }
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'define',
    alias: ['dictionary', 'dict'],
    category: 'UTILITIES',
    desc: 'English dictionary definition',
    usage: '.define serendipity',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .define serendipity')
      try {
        const d = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`)
        const entry = d[0]
        let out = `📖 *${entry.word.toUpperCase()}*\n`
        if (entry.phonetic) out += `🔊 ${entry.phonetic}\n`
        for (const meaning of entry.meanings.slice(0, 3)) {
          out += `\n*${meaning.partOfSpeech}*\n`
          meaning.definitions.slice(0, 2).forEach((def, i) => {
            out += `${i + 1}. ${def.definition}\n`
            if (def.example) out += `   _"${def.example}"_\n`
          })
        }
        await m.reply(out)
      } catch {
        await m.reply(`❌ No dictionary entry for "${text}".`)
      }
    }
  },
  {
    name: 'bible',
    category: 'UTILITIES',
    desc: 'Look up a Bible verse',
    usage: '.bible John 3:16',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .bible John 3:16')
      try {
        const d = await getJson(`https://bible-api.com/${encodeURIComponent(text)}`)
        if (!d.text) return m.reply('❌ Verse not found.')
        await m.reply(`📖 *${d.reference}*\n\n${d.text.trim()}\n\n_${d.translation_name}_`)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'tinyurl',
    alias: ['short', 'shorten'],
    category: 'UTILITIES',
    desc: 'Shorten a long URL',
    usage: '.tinyurl https://example.com/very/long',
    cooldown: 5,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !/^https?:\/\//.test(url)) return m.reply('📝 Usage: .tinyurl https://example.com')
      try {
        const short = await getJson(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`)
        await m.reply(`🔗 *Shortened*\n\n📥 Original:\n${url}\n\n📤 Short:\n${short}`)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'calc',
    alias: ['calculate', 'math'],
    category: 'UTILITIES',
    desc: 'Evaluate a maths expression',
    usage: '.calc 5 * (3 + 2)',
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .calc 5 * (3 + 2)')
      // whitelist characters, then evaluate in an isolated Function
      const expr = text
        .replace(/x/gi, '*')
        .replace(/÷/g, '/')
        .replace(/,/g, '')
        .trim()
      if (!/^[0-9+\-*/().%\s^]+$/.test(expr)) {
        return m.reply('❌ Only numbers and + - * / ( ) % ^ are allowed.')
      }
      try {
        const js = expr.replace(/\^/g, '**')
        const result = Function(`"use strict";return (${js})`)()
        if (!Number.isFinite(result)) return m.reply('❌ That does not produce a finite number.')
        await m.reply(`🧮 *Calculator*\n\n📥 ${expr}\n📤 *${comma(Number(result.toFixed(8)))}*`)
      } catch {
        await m.reply('❌ Invalid expression.')
      }
    }
  },
  {
    name: 'ip',
    category: 'UTILITIES',
    desc: 'Look up an IP address',
    usage: '.ip 8.8.8.8',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .ip 8.8.8.8')
      try {
        const d = await race([
          async () => {
            const r = await getJson(`https://ipwho.is/${encodeURIComponent(text)}`)
            if (!r.success) throw new Error('lookup failed')
            return { ip: r.ip, city: r.city, region: r.region, country: r.country, isp: r.connection?.isp, org: r.connection?.org, tz: r.timezone?.id }
          },
          async () => {
            const r = await getJson(`http://ip-api.com/json/${encodeURIComponent(text)}`)
            if (r.status !== 'success') throw new Error('lookup failed')
            return { ip: r.query, city: r.city, region: r.regionName, country: r.country, isp: r.isp, org: r.org, tz: r.timezone }
          }
        ])
        await m.reply(
          `🌐 *IP LOOKUP*\n\n` +
            `📍 IP: ${d.ip}\n` +
            `🏙️ City: ${d.city || 'unknown'}\n` +
            `🗺️ Region: ${d.region || 'unknown'}\n` +
            `🏳️ Country: ${d.country || 'unknown'}\n` +
            `🏢 ISP: ${d.isp || d.org || 'unknown'}\n` +
            `🕐 Timezone: ${d.tz || 'unknown'}`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'lyrics',
    category: 'SEARCH',
    desc: 'Find song lyrics',
    usage: '.lyrics adele - hello',
    cooldown: 8,
    async run({ m, text }) {
      if (!text.includes('-')) return m.reply('📝 Usage: *.lyrics artist - song*\nExample: .lyrics adele - hello')
      const [artist, song] = text.split('-').map((s) => s.trim())
      try {
        const d = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`)
        if (!d.lyrics) return m.reply('❌ Lyrics not found.')
        const body = d.lyrics.trim().slice(0, 3500)
        await m.reply(`🎵 *${song}* — ${artist}\n\n${body}${d.lyrics.length > 3500 ? '\n\n_(truncated)_' : ''}`)
      } catch {
        await m.reply(`❌ No lyrics found for "${song}" by ${artist}.`)
      }
    }
  },
  {
    name: 'crypto',
    alias: ['btc', 'coinprice'],
    category: 'UTILITIES',
    desc: 'Cryptocurrency prices',
    usage: '.crypto bitcoin',
    cooldown: 10,
    async run({ m, text }) {
      const coin = (text || 'bitcoin,ethereum,binancecoin,solana').toLowerCase().replace(/\s+/g, '')
      try {
        const d = await getJson(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,ngn&include_24hr_change=true`
        )
        const keys = Object.keys(d)
        if (!keys.length) return m.reply(`❌ Unknown coin "${text}". Try: bitcoin, ethereum, solana`)
        let out = '💹 *CRYPTO PRICES*\n'
        for (const k of keys) {
          const c = d[k]
          const change = c.usd_24h_change || 0
          out += `\n${change >= 0 ? '📈' : '📉'} *${k.toUpperCase()}*\n` +
                 `   $${comma(Number(c.usd?.toFixed(2)))}  |  ₦${comma(Number(c.ngn?.toFixed(0)))}\n` +
                 `   24h: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n`
        }
        await m.reply(out)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'currency',
    alias: ['exchange', 'fx', 'convert'],
    category: 'UTILITIES',
    desc: 'Convert between currencies',
    usage: '.currency 100 USD NGN',
    cooldown: 5,
    async run({ m, args }) {
      const amount = parseFloat(args[0])
      const from = (args[1] || 'USD').toUpperCase()
      const to = (args[2] || 'NGN').toUpperCase()
      if (!amount) return m.reply('📝 Usage: .currency 100 USD NGN')
      try {
        const d = await getJson(`https://open.er-api.com/v6/latest/${from}`)
        if (d.result !== 'success' || !d.rates?.[to]) return m.reply(`❌ Cannot convert ${from} to ${to}.`)
        const converted = amount * d.rates[to]
        await m.reply(
          `💱 *CURRENCY CONVERTER*\n\n` +
            `📥 ${comma(amount)} ${from}\n` +
            `📤 *${comma(Number(converted.toFixed(2)))} ${to}*\n\n` +
            `📊 Rate: 1 ${from} = ${d.rates[to].toFixed(4)} ${to}\n` +
            `🕐 Updated: ${d.time_last_update_utc?.slice(0, 16) || 'recently'}`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'github',
    alias: ['gh'],
    category: 'SEARCH',
    desc: 'Look up a GitHub user',
    usage: '.github torvalds',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .github torvalds')
      try {
        const d = await getJson(`https://api.github.com/users/${encodeURIComponent(text)}`)
        const caption =
          `╭━━━〔 *GITHUB* 〕━━━╮\n` +
          `┃ 👤 ${d.name || d.login}\n` +
          `┃ 🔗 @${d.login}\n` +
          `┃ 📝 ${d.bio || 'no bio'}\n` +
          `┃ 📦 Repos: ${d.public_repos}\n` +
          `┃ 👥 Followers: ${comma(d.followers)}\n` +
          `┃ 👣 Following: ${comma(d.following)}\n` +
          `┃ 📍 ${d.location || 'unknown'}\n` +
          `┃ 🔗 ${d.html_url}\n` +
          `╰━━━━━━━━━━━━━━━╯`
        await m.reply({ image: await getBuffer(d.avatar_url), caption })
      } catch {
        await m.reply(`❌ No GitHub user called "${text}".`)
      }
    }
  },
  {
    name: 'npm',
    category: 'SEARCH',
    desc: 'Look up an npm package',
    usage: '.npm express',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .npm express')
      try {
        const d = await getJson(`https://registry.npmjs.org/${encodeURIComponent(text)}`)
        const latest = d['dist-tags']?.latest
        const v = d.versions?.[latest] || {}
        await m.reply(
          `📦 *${d.name}*\n\n` +
            `📝 ${d.description || 'no description'}\n` +
            `🏷️ Latest: ${latest}\n` +
            `👤 Author: ${v.author?.name || d.author?.name || 'unknown'}\n` +
            `📜 License: ${v.license || 'unknown'}\n` +
            `🏠 ${d.homepage || `https://npmjs.com/package/${d.name}`}\n\n` +
            `⬇️ npm i ${d.name}`
        )
      } catch {
        await m.reply(`❌ No npm package called "${text}".`)
      }
    }
  },
  {
    name: 'country',
    category: 'SEARCH',
    desc: 'Information about a country',
    usage: '.country Nigeria',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .country Nigeria')
      try {
        // restcountries deprecated its public API, so resolve via countriesnow
        // for the ISO code, then World Bank for the detail.
        const basic = await getJson(
          `https://countriesnow.space/api/v0.1/countries/capital/q?country=${encodeURIComponent(text)}`
        )
        const info = basic?.data
        if (!info?.iso3) return m.reply(`❌ No country called "${text}".`)

        let extra = {}
        try {
          const wb = await getJson(`https://api.worldbank.org/v2/country/${info.iso3}?format=json`)
          extra = wb?.[1]?.[0] || {}
        } catch {}

        let population = null
        try {
          const pop = await getJson(
            `https://api.worldbank.org/v2/country/${info.iso3}/indicator/SP.POP.TOTL?format=json&per_page=1&mrnev=1`
          )
          population = pop?.[1]?.[0]?.value
        } catch {}

        const caption =
          `╭━━━〔 *${info.name.toUpperCase()}* 〕━━━╮\n` +
          `┃ 🏛️ Capital: ${info.capital || extra.capitalCity || 'n/a'}\n` +
          `┃ 🌍 Region: ${extra.region?.value || 'n/a'}\n` +
          `┃ 💵 Income: ${extra.incomeLevel?.value || 'n/a'}\n` +
          (population ? `┃ 👥 Population: ${comma(population)}\n` : '') +
          `┃ 🏳️ ISO: ${info.iso2} / ${info.iso3}\n` +
          `╰━━━━━━━━━━━━━━━╯`

        // flagcdn serves flags by ISO2 with no API key
        try {
          const flag = await getBuffer(`https://flagcdn.com/w640/${info.iso2.toLowerCase()}.png`)
          await m.reply({ image: flag, caption })
        } catch {
          await m.reply(caption)
        }
      } catch {
        await m.reply(`❌ No country called "${text}".`)
      }
    }
  },
  {
    name: 'anime',
    alias: ['animesearch'],
    category: 'ANIME',
    desc: 'Search for an anime',
    usage: '.anime naruto',
    cooldown: 8,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .anime naruto')
      try {
        const d = await race([
          async () => {
            const r = await getJson(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(text)}&page[limit]=1`)
            const a = r.data?.[0]?.attributes
            if (!a) throw new Error('none')
            return {
              title: a.canonicalTitle, synopsis: a.synopsis, episodes: a.episodeCount,
              status: a.status, rating: a.averageRating ? `${a.averageRating}/100` : 'n/a',
              started: a.startDate, image: a.posterImage?.original
            }
          },
          async () => {
            const r = await getJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(text)}&limit=1`)
            const a = r.data?.[0]
            if (!a) throw new Error('none')
            return {
              title: a.title, synopsis: a.synopsis, episodes: a.episodes,
              status: a.status, rating: a.score ? `${a.score}/10` : 'n/a',
              started: a.aired?.from?.slice(0, 10), image: a.images?.jpg?.large_image_url
            }
          }
        ])
        const caption =
          `╭━━━〔 *ANIME* 〕━━━╮\n` +
          `┃ 📺 ${d.title}\n` +
          `┃ 🎬 Episodes: ${d.episodes || 'n/a'}\n` +
          `┃ 📊 Status: ${d.status || 'n/a'}\n` +
          `┃ ⭐ Rating: ${d.rating}\n` +
          `┃ 📅 Started: ${d.started || 'n/a'}\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n` +
          `📝 ${(d.synopsis || 'No synopsis.').slice(0, 700)}`
        if (d.image) await m.reply({ image: await getBuffer(d.image), caption })
        else await m.reply(caption)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'book',
    category: 'SEARCH',
    desc: 'Search for a book',
    usage: '.book dune',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .book dune')
      try {
        const d = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(text)}&limit=3`)
        if (!d.docs?.length) return m.reply(`❌ No books found for "${text}".`)
        let out = '📚 *BOOK SEARCH*\n'
        for (const b of d.docs.slice(0, 3)) {
          out += `\n📖 *${b.title}*\n` +
                 `   ✍️ ${b.author_name?.slice(0, 2).join(', ') || 'unknown'}\n` +
                 `   📅 ${b.first_publish_year || 'unknown'}\n`
        }
        await m.reply(out)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
