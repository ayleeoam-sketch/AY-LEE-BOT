/**
 * Offline test for the football prediction engine + .pred command.
 *
 *   node test/prediction-test.mjs
 *
 * A local mock server emulates TheSportsDB (keyless path) and API-Football
 * (keyed path), so the suite never touches the internet. Env overrides for
 * the API base URLs are set BEFORE the lib is imported (dynamic import).
 */
import './_isolate.js' // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB, collection } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'
import http from 'http'
import { URL } from 'url'

const OWNER = '2340000000001'
const BOT = '2348000000000'

/* --------------------------- mock API server --------------------------- */

const hits = []
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  hits.push(`${u.pathname}${u.search}`)
  const json = (o) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(o))
  }

  // ---- TheSportsDB (keyless) ----
  if (u.pathname.includes('eventsday.php')) {
    const d = u.searchParams.get('d')
    if (!d || d.startsWith('2020')) return json({ events: null })
    if (d === today) {
      return json({
        events: [
          tsdbEvent('e1', 4328, 'English Premier League', '2026-2027', 'Man City', 'Luton', hoursAhead(6)),
          tsdbEvent('e2', 4328, 'English Premier League', '2026-2027', 'Arsenal', 'Everton', hoursAhead(8)),
          tsdbEvent('e3', 4406, 'Argentinian Primera Division', '2026', 'Boca Juniors', 'River Plate', hoursAhead(9))
        ]
      })
    }
    return json({
      events: [tsdbEvent('e9', 4328, 'English Premier League', '2026-2027', 'Chelsea', 'Fulham', `${d}T12:00:00Z`)]
    })
  }
  if (u.pathname.includes('lookuptable.php')) {
    const l = u.searchParams.get('l')
    if (l === '4328') {
      return json({
        table: [
          tsdbRow('Man City', 8, 20, 4, 'WWWWW'),
          tsdbRow('Luton', 8, 5, 22, 'LLLDL'),
          tsdbRow('Arsenal', 8, 18, 6, 'WWDWW'),
          tsdbRow('Everton', 8, 7, 19, 'LDLLL'),
          tsdbRow('Chelsea', 8, 16, 8, 'WWLWW'),
          tsdbRow('Fulham', 8, 9, 15, 'DLWDL')
        ]
      })
    }
    if (l === '4406') {
      return json({
        table: [tsdbRow('Boca Juniors', 16, 30, 14, 'DDWDL'), tsdbRow('River Plate', 16, 30, 24, 'WLLLL')]
      })
    }
    return json({ table: [] })
  }

  // ---- API-Football (keyed) ----
  if (u.pathname.endsWith('/fixtures')) {
    if (!req.headers['x-apisports-key']) {
      res.writeHead(403)
      return res.end()
    }
    return json({
      response: [
        {
          fixture: { id: 1, date: hoursAhead(6) },
          league: { id: 39, name: 'English Premier League', country: 'England', season: '2026' },
          teams: { home: { name: 'Arsenal' }, away: { name: 'Everton' } }
        }
      ]
    })
  }
  if (u.pathname.endsWith('/odds')) {
    return json({
      response: [
        {
          fixture: { id: 1 },
          bookmakers: [
            {
              bets: [
                {
                  name: 'Match Winner',
                  values: [
                    { value: 'Home', odd: '1.45' },
                    { value: 'Draw', odd: '4.20' },
                    { value: 'Away', odd: '7.00' }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  }
  if (u.pathname.endsWith('/standings')) {
    return json({
      response: [
        {
          league: {
            standings: [
              [
                { rank: 1, form: 'WWWDW', all: { played: 20, goals: { for: 45, against: 12 } }, team: { name: 'Arsenal' } },
                { rank: 18, form: 'LDLDL', all: { played: 20, goals: { for: 15, against: 40 } }, team: { name: 'Everton' } }
              ]
            ]
          }
        }
      ]
    })
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${mock.address().port}`

const hoursAhead = (h) => new Date(Date.now() + h * 3600_000).toISOString()
const tsdbEvent = (id, leagueId, league, season, home, away, kickoff) => ({
  idEvent: id,
  strHomeTeam: home,
  strAwayTeam: away,
  strLeague: league,
  idLeague: leagueId,
  strCountry: '',
  strSeason: season,
  strTimestamp: kickoff,
  intHomeScore: null,
  intAwayScore: null,
  strPostponed: 'no',
  strStatus: 'NS'
})
const tsdbRow = (team, played, gf, ga, form) => ({
  strTeam: team,
  intPlayed: played,
  intGoalsFor: gf,
  intGoalsAgainst: ga,
  strForm: form,
  strGroup: ''
})

/* point the engine at the mock BEFORE importing it */
process.env.PRED_THE_SPORTS_DB = `${base}/api/v1/json/3`
process.env.PRED_API_SPORTS = `${base}/af`
delete process.env.FOOTBALL_API_KEY

const {
  getBestPicks,
  matchProbabilities,
  poissonPmf,
  dayString
} = await import('../src/lib/football.js')

const today = dayString(0)
const tomorrow = dayString(1)

/* ------------------------------ bot mock ------------------------------ */

const sent = []
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, name: 'VENOM MD BOT' },
  sendMessage: async (jid, content) => {
    sent.push(content)
    return { key: { id: 'X' + Math.random(), remoteJid: jid, fromMe: true } }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  groupMetadata: async () => ({ participants: [] }),
  profilePictureUrl: async () => {
    throw new Error('none')
  },
  updateMediaMessage: async () => {}
}

const build = (body) => ({
  key: { remoteJid: `${OWNER}@s.whatsapp.net`, fromMe: false, id: 'M' + Math.random().toString(36).slice(2) },
  pushName: 'Micheal',
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: body }
})
const run = async (body) => {
  sent.length = 0
  await handleMessage(sock, build(body))
  return [...sent]
}
const txt = (out) => out.map((s) => s.text || s.caption || Object.keys(s).join(',')).join('\n')

let pass = 0, fail = 0
const t = (label, cond, extra = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label} → ${String(extra).slice(0, 90)}`); fail++ }
}

/* ------------------------------ boot ------------------------------ */
await connectDB()
await loadVars()
await loadPlugins()
config.ownerNumbers = [OWNER]
const cache = collection('predcache')
await cache.delete({})

console.log(`\n═══ FOOTBALL PREDICTION — offline test ═══\n`)

console.log('── MODEL (pure) ──')
let sum = 0
for (let k = 0; k <= 25; k++) sum += poissonPmf(k, 2)
t('poisson pmf sums to ~1', Math.abs(sum - 1) < 1e-6, sum)
const strong = { played: 8, gf: 20, ga: 4, form: 'WWWWW' }
const weak = { played: 8, gf: 5, ga: 22, form: 'LLLDL' }
const p = matchProbabilities(strong, weak, { leagueAvg: 1.5625 })
t('strong home team is heavy favourite', p.pHome > 0.9, p.pHome.toFixed(2))
t('goals model expects overs', p.pOver25 > 0.7, p.pOver25.toFixed(2))
const mid = { played: 10, gf: 14, ga: 13, form: 'WDLWD' }
const p2 = matchProbabilities(mid, { ...mid }, { leagueAvg: 1.4 })
t('even teams, home has realistic edge (~45/26/29)', p2.pHome > p2.pAway && p2.pHome < 0.55 && p2.pDraw > 0.2, `${p2.pHome.toFixed(2)}/${p2.pDraw.toFixed(2)}/${p2.pAway.toFixed(2)}`)
t('even teams flagged as healthy data', !p2.lowData)

console.log('── .pred (keyless TheSportsDB) ──')
hits.length = 0
let o = await run('.pred')
t('renders BEST PICKS header', /BEST PICKS/.test(txt(o)), txt(o))
t('top pick is Man City vs Luton', /Man City vs Luton/.test(txt(o)), txt(o))
t('pick shows a market line with %', /Man City Win.*\d+%/.test(txt(o)), txt(o))
t('stars awarded to strong picks', /⭐/.test(txt(o)), txt(o))
t('source line says TheSportsDB', /TheSportsDB/.test(txt(o)), txt(o))
t('disclaimer present', /18\+/.test(txt(o)), txt(o))
t('scans 3 matches', /3 match/.test(txt(o)), txt(o))
const todayFixturesHits = hits.filter((h) => h.includes('eventsday') && h.includes(today)).length
const tableHits = hits.filter((h) => h.includes('lookuptable')).length
t('fixtures fetched once for today', todayFixturesHits === 1, hits.join(','))
t('standings fetched for both leagues', tableHits === 2, hits.join(','))
o = await run('.pred')
t('second run served from cache', hits.filter((h) => h.includes('eventsday') && h.includes(today)).length === 1)
o = await run('.pred premier league')
t('league filter keeps EPL only', /Man City/.test(txt(o)) && !/Boca Juniors/.test(txt(o)), txt(o))
o = await run('.pred mars league')
t('unknown league -> no fixtures message', /No fixtures/.test(txt(o)), txt(o))
o = await run('.pred tomorrow')
t('tomorrow shows tomorrow fixtures', /Chelsea vs Fulham/.test(txt(o)), txt(o))
o = await run('.predkey')
t('predkey reports keyless default', /TheSportsDB/.test(txt(o)), txt(o))

console.log('── keyed path (API-Football) ──')
process.env.FOOTBALL_API_KEY = 'test-key'
o = await run('.pred')
t('keyed run renders picks', /BEST PICKS/.test(txt(o)), txt(o))
t('keyed run uses API-Football source', /API-Football/.test(txt(o)), txt(o))
t('keyed run blends bookmaker odds', /Arsenal Win.*\d+%/.test(txt(o)), txt(o))
delete process.env.FOOTBALL_API_KEY

console.log('── empty day ──')
const empty = await getBestPicks({ day: '2020-01-01' })
t('empty day returns zero total', empty.total === 0, empty.total)
t('empty day returns no picks', empty.picks.length === 0)

await mock.close()
console.log(`\n${fail ? `❌ ${fail} failed` : '🎉 all passed'} (${pass} checks)`)
process.exit(fail ? 1 : 0)
