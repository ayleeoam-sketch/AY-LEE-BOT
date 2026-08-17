/**
 * Football predictions - the daily top picks command.
 *
 *   .pred                  today's best picks, every league
 *   .pred tomorrow         tomorrow's
 *   .pred premier league   only that league (any league/country name works)
 *   .predkey <key>         (owner) optional API-Football key for bookmaker odds
 *
 * The engine lives in src/lib/football.js - standings, form and goal stats
 * feed a Poisson scoreline model, ranked by confidence. No key needed.
 */
import { getBestPicks, resolveFootKey, setFootKey, prettyDay, kickoffTime } from '../../src/lib/football.js'

const MEDALS = ['🥇', '🥈', '🥉']
const medal = (i) => MEDALS[i] || `${i + 1}️⃣`

const render = (res) => {
  if (!res.total) {
    return `⚽ *No fixtures* for ${prettyDay(res.day)} yet, or the source is unreachable.\n\nTry *.pred tomorrow*.`
  }
  if (!res.picks.length) {
    return (
      `⚽ *BEST PICKS* — ${prettyDay(res.day)}\n\n` +
      `📅 ${res.total} match${res.total > 1 ? 'es' : ''} today, but none clear the confidence bar - the data is too thin to call anything with conviction.\n\n` +
      `Try *.pred tomorrow* or *.pred <league>*.\n` +
      `⚠️ No pick is guaranteed - bet responsibly · 18+.`
    )
  }
  const lines = res.picks.map((p, i) => {
    const fx = p.fixture
    const extra = p.usedOdds ? ' · bookies in' : p.probs.lowData ? ' · thin data' : ''
    const marketLines = p.markets
      .map((mk) => `   🎯 *${mk.label}* · ${mk.prob}% ${mk.stars}`)
      .join('\n')
    return (
      `${medal(i)} *${fx.home} vs ${fx.away}* — ${fx.league} · ${kickoffTime(fx.kickoff)}\n` +
      marketLines +
      (extra ? `\n   _model confidence${extra}_` : '')
    )
  })
  return (
    `⚽ *BEST PICKS* — ${prettyDay(res.day)} (${res.tz})\n` +
    `📅 ${res.total} match${res.total > 1 ? 'es' : ''} scanned · top ${res.picks.length} ranked\n` +
    `━━━━━━━━━━━━━━━━\n` +
    lines.join('\n\n') +
    `\n━━━━━━━━━━━━━━━━\n` +
    `🔎 Source: ${res.source}\n` +
    `📊 Model: standings + form + goals (Poisson)\n` +
    `⚠️ Stats, not guarantees - bet only what you can lose · 18+.`
  )
}

export default [
  {
    name: 'pred',
    alias: ['prediction', 'predictions', 'picks', 'bet', 'football'],
    category: 'SPORTS',
    desc: "Today's best football picks - every league, ranked by confidence",
    usage: '.pred | .pred tomorrow | .pred premier league',
    async run({ m, args, text }) {
      const dayWords = new Set(['tomorrow', 'tmr', 'tmrw', 'tom', 'today'])
      let dayOffset = 0
      let league = ''
      const first = (args[0] || '').toLowerCase()
      if (dayWords.has(first)) {
        dayOffset = first === 'today' ? 0 : 1
        league = args.slice(1).join(' ')
      } else if (text) {
        league = text
      }
      await m.react('⚽').catch(() => {})
      try {
        const res = await getBestPicks({ dayOffset, league })
        await m.reply(render(res))
      } catch (e) {
        await m.reply(`⚽ ${e.message}`)
      }
    }
  },
  {
    name: 'predkey',
    category: 'SPORTS',
    desc: 'Optional API-Football key - adds real bookmaker odds to predictions',
    usage: '.predkey <api-sports key> | .predkey off',
    owner: true,
    async run({ m, args }) {
      const val = args.join(' ').trim()
      if (!val) {
        const key = await resolveFootKey()
        return m.reply(
          `⚽ *PREDICTION SOURCE*\n\n` +
            `Current: ${key ? 'API-Football (key set - bookmaker odds blended in)' : 'TheSportsDB - keyless, works out of the box'}\n\n` +
            `Want bookmaker odds in the model? Get a free key (100 req/day):\nhttps://dashboard.api-football.com\n\n` +
            `Set: *.predkey <key>*\nRemove: *.predkey off*`
        )
      }
      if (val.toLowerCase() === 'off') {
        await setFootKey('')
        return m.reply('🗑️ API-Football key removed - back to the keyless source.')
      }
      await setFootKey(val)
      await m.reply('🔑 API-Football key saved. Future predictions blend real bookmaker odds into the model.')
    }
  }
]
