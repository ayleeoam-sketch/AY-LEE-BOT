/**
 * Football predictions - data-driven daily top picks.
 *
 *   .pred                today's best picks across every league
 *   .pred tomorrow       tomorrow's
 *   .pred premier league filter by league name
 *
 * Sources (auto failover):
 *   1. API-Football  (https://dashboard.api-football.com) when a key is set
 *      via .predkey / FOOTBALL_API_KEY - adds real bookmaker odds to the model.
 *   2. TheSportsDB    keyless test key - works out of the box, no setup.
 *
 * Model: expected goals from each team's attack/defence stats (goals for &
 * against per game), recent form tilt, home advantage, then a Poisson matrix
 * over the scoreline to get honest probabilities for 1X2, over/under 2.5 and
 * BTTS. Bookmaker odds, when available, are blended in at 65% weight.
 *
 * Nothing is guaranteed - the footer of every reply says so.
 */
import { collection } from './database.js'
import { http } from './api.js'
import { sleep } from './utils.js'
import { builtinKey } from '../builtin-keys.js'

/** Bot timezone - same convention as the school module. */
export const TZ = process.env.TZ || 'Africa/Lagos'

const cache = collection('predcache')
/* Overridable in tests so suites never touch the real internet. */
const TSDB_BASE = process.env.PRED_THE_SPORTS_DB || 'https://www.thesportsdb.com/api/v1/json/3'
const AF_BASE = process.env.PRED_API_SPORTS || 'https://v3.football.api-sports.io'

const FIXTURES_TTL = 2 * 60 * 60 * 1000 // a day's fixture list barely changes
const TABLE_TTL = 6 * 60 * 60 * 1000   // standings move slowly
const MAX_TABLES = 8                   // standings calls per prediction (rate safety)

/* ------------------------------ keys ------------------------------ */

/** env > database (.predkey) > built-in key, like the AI providers. */
export async function resolveFootKey() {
  if (String(process.env.FOOTBALL_API_KEY || '').trim()) return process.env.FOOTBALL_API_KEY.trim()
  try {
    const row = await cache.findOne({ id: '__footkey__' })
    if (row?.key) return String(row.key).trim()
  } catch {
    /* no key stored */
  }
  return builtinKey('FOOTBALL_API_KEY')
}

/** '' clears the key and drops back to the keyless source. */
export async function setFootKey(value) {
  const key = String(value || '').trim()
  if (!key) {
    await cache.delete({ id: '__footkey__' })
    return ''
  }
  await cache.set({ id: '__footkey__' }, { key, at: Date.now() })
  return key
}

/* --------------------------- date helpers --------------------------- */

/** YYYY-MM-DD in the bot's timezone, offsetDays from today. */
export function dayString(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** "Mon, 17 Aug" */
export function prettyDay(day) {
  const [y, m, dd] = String(day).split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, dd))
  )
}

/** "16:00" for a kickoff in the bot's timezone. */
export function kickoffTime(iso) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

/* --------------------------- model (pure) --------------------------- */

const FACT = [1]
const fact = (n) => {
  while (FACT.length <= n) FACT.push(FACT[FACT.length - 1] * FACT.length)
  return FACT[n]
}

/** Poisson probability of exactly k goals at rate lambda. */
export function poissonPmf(k, lam) {
  return (Math.exp(-lam) * Math.pow(lam, k)) / fact(k)
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Average of last-5 form letters: W=1, D=0.5, L=0. Neutral when unknown. */
const formAvg = (t) => {
  const letters = [...String(t?.form || '')].slice(0, 5)
  if (!letters.length) return 0.5
  const pts = letters.reduce((s, c) => s + (c === 'W' ? 1 : c === 'D' ? 0.5 : 0), 0)
  return pts / letters.length
}

/**
 * Poisson scoreline model.
 * home/away: { played, gf, ga, form } or null when the team is unknown.
 * Returns win/draw/win probabilities plus over-2.5 and BTTS chances.
 */
export function matchProbabilities(home, away, { leagueAvg = 1.35 } = {}) {
  const HOME_ADV = 1.35
  const norm = Math.max(0.6, leagueAvg)
  const atk = (t) => (t && t.played >= 3 ? t.gf / t.played : leagueAvg)
  const def = (t) => (t && t.played >= 3 ? t.ga / t.played : leagueAvg)

  let xgH = (atk(home) * def(away) * HOME_ADV) / norm
  let xgA = (atk(away) * def(home)) / norm

  const tilt = 0.15 * (formAvg(home) - formAvg(away))
  xgH = clamp(xgH * (1 + tilt), 0.25, 4.5)
  xgA = clamp(xgA * (1 - tilt), 0.2, 4)

  let pH = 0, pD = 0, pA = 0, over = 0, btts = 0, total = 0
  const MAX = 10
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPmf(i, xgH) * poissonPmf(j, xgA)
      total += p
      if (i > j) pH += p
      else if (i === j) pD += p
      else pA += p
      if (i + j >= 3) over += p
      if (i >= 1 && j >= 1) btts += p
    }
  }
  const lowData = !(home?.played >= 3) || !(away?.played >= 3)
  return {
    xgH: +xgH.toFixed(2),
    xgA: +xgA.toFixed(2),
    pHome: pH / total,
    pDraw: pD / total,
    pAway: pA / total,
    pOver25: over / total,
    pBtts: btts / total,
    lowData,
    confidence: Math.max(pH / total, pD / total, pA / total)
  }
}

/** Implied probabilities from decimal odds, overround removed. */
const oddsProbs = (o) => {
  const inv = { h: 1 / o.home, d: 1 / o.draw, a: 1 / o.away }
  const s = inv.h + inv.d + inv.a
  return { pHome: inv.h / s, pDraw: inv.d / s, pAway: inv.a / s }
}

const stars = (p) => (p >= 0.7 ? '⭐⭐⭐' : p >= 0.62 ? '⭐⭐' : p >= 0.55 ? '⭐' : '')

/**
 * Turn raw probabilities into bettable market lines.
 * Only confident markets make the cut - a match with nothing to say gets
 * an empty markets array and never appears in "best picks".
 */
export function evaluateMatch(fx, { home, away, leagueAvg, odds }) {
  let probs = matchProbabilities(home, away, { leagueAvg: leagueAvg || 1.35 })
  let usedOdds = false
  if (odds?.home && odds?.draw && odds?.away) {
    const o = oddsProbs(odds)
    probs = {
      ...probs,
      pHome: 0.65 * o.pHome + 0.35 * probs.pHome,
      pDraw: 0.65 * o.pDraw + 0.35 * probs.pDraw,
      pAway: 0.65 * o.pAway + 0.35 * probs.pAway
    }
    probs.confidence = Math.max(probs.pHome, probs.pDraw, probs.pAway)
    usedOdds = true
  }

  const markets = []
  const best12 = [
    { label: `${fx.home} Win`, prob: probs.pHome },
    { label: 'Draw', prob: probs.pDraw },
    { label: `${fx.away} Win`, prob: probs.pAway }
  ].sort((a, b) => b.prob - a.prob)[0]
  if (best12.prob >= 0.52) markets.push({ label: best12.label, prob: best12.prob })
  if (probs.pOver25 >= 0.6) markets.push({ label: 'Over 2.5 Goals', prob: probs.pOver25 })
  else if (probs.pOver25 <= 0.4) markets.push({ label: 'Under 2.5 Goals', prob: 1 - probs.pOver25 })
  if (probs.pBtts >= 0.6) markets.push({ label: 'BTTS Yes', prob: probs.pBtts })
  else if (probs.pBtts <= 0.4) markets.push({ label: 'BTTS No', prob: 1 - probs.pBtts })
  markets.sort((a, b) => b.prob - a.prob)

  return {
    probs,
    usedOdds,
    markets: markets.map((mk) => ({ ...mk, stars: stars(mk.prob), prob: Math.round(mk.prob * 100) })),
    best: markets[0] ? { ...markets[0], stars: stars(markets[0].prob), prob: Math.round(markets[0].prob * 100) } : null
  }
}

/* ------------------------- TheSportsDB source ------------------------- */

const tsdbEvent = (e) => ({
  id: `tsdb:${e.idEvent}`,
  home: e.strHomeTeam,
  away: e.strAwayTeam,
  league: e.strLeague || 'Unknown League',
  leagueId: String(e.idLeague || ''),
  country: e.strCountry || '',
  season: e.strSeason || '',
  kickoff: e.strTimestamp, // UTC ISO
  scored: e.intHomeScore !== null && e.intHomeScore !== undefined,
  postponed: e.strPostponed === 'yes',
  status: e.strStatus || 'NS'
})

async function tsdbEvents(day) {
  const { data } = await http.get(`${TSDB_BASE}/eventsday.php`, { params: { d: day, s: 'Soccer' } })
  return (data?.events || []).map(tsdbEvent)
}

/** Season strings to try until a league table comes back non-empty. */
const seasonCandidates = (sample, day) =>
  [...new Set([sample?.season, day.slice(0, 4), `${day.slice(0, 4)}-${+day.slice(0, 4) + 1}`])].filter(Boolean)

async function tsdbTable(leagueId, sample, day) {
  for (const s of seasonCandidates(sample, day)) {
    try {
      const { data } = await http.get(`${TSDB_BASE}/lookuptable.php`, { params: { l: leagueId, s } })
      if (Array.isArray(data?.table) && data.table.length) {
        return data.table.map((r) => ({
          team: String(r.strTeam || ''),
          played: +r.intPlayed || 0,
          gf: +r.intGoalsFor || 0,
          ga: +r.intGoalsAgainst || 0,
          form: r.strForm || '',
          group: r.strGroup || ''
        }))
      }
    } catch {
      /* try next season string */
    }
    await sleep(350) // TheSportsDB free key is rate limited - be polite
  }
  return null
}

/** standings rows (any source) -> by-name map + league goal average. */
function statsFromRows(rows) {
  const norm = rows.map((r) => ({
    team: String(r.team || ''),
    played: +r.played || 0,
    gf: +r.gf || 0,
    ga: +r.ga || 0,
    form: String(r.form || '').toUpperCase(),
    group: String(r.group || '')
  }))
  const withData = norm.filter((r) => r.played >= 3)
  const leagueAvg =
    withData.length > 0 ? withData.reduce((s, r) => s + r.gf / r.played, 0) / withData.length : 0
  const byName = new Map(norm.map((r) => [r.team, r]))
  return { byName, leagueAvg }
}

/* ------------------------ API-Football source ------------------------ */

async function afGet(key, path, params) {
  const { data } = await http.get(`${AF_BASE}${path}`, {
    params,
    headers: { 'x-apisports-key': key }
  })
  if (data?.errors && Object.keys(data.errors).length) {
    throw new Error(`API-Football rejected the key: ${Object.values(data.errors).flat().join(', ')}`)
  }
  return data
}

async function afFixtures(key, day) {
  const data = await afGet(key, '/fixtures', { date: day, timezone: TZ, status: 'NS' })
  const list = (data?.response || []).map((f) => ({
    id: `af:${f.fixture?.id}`,
    afId: f.fixture?.id,
    home: f.teams?.home?.name || '',
    away: f.teams?.away?.name || '',
    league: f.league?.name || '',
    leagueId: String(f.league?.id || ''),
    country: f.league?.country || '',
    season: String(f.league?.season || ''),
    kickoff: f.fixture?.date, // already in TZ (timezone param)
    scored: false,
    postponed: false,
    status: 'NS',
    odds: null
  }))
  // Bookmaker odds (free tier often includes them) - fail soft if not.
  try {
    const oddsData = await afGet(key, '/odds', { date: day, timezone: TZ })
    for (const o of oddsData?.response || []) {
      const fx = list.find((f) => f.afId === o.fixture?.id)
      if (!fx) continue
      for (const book of o.bookmakers || []) {
        const bet = (book.bets || []).find((b) => b.name === 'Match Winner')
        const v = (value) => +(bet?.values?.find((x) => x.value === value)?.odd || 0)
        const odds = { home: v('Home'), draw: v('Draw'), away: v('Away') }
        if (odds.home && odds.draw && odds.away) {
          fx.odds = odds
          break
        }
      }
    }
  } catch {
    /* odds unavailable - model-only predictions */
  }
  return list
}

async function afStandings(key, sample) {
  const season = sample?.season || String(new Date().getFullYear())
  const data = await afGet(key, '/standings', { league: sample.leagueId, season })
  const rows = []
  for (const group of data?.response || []) {
    for (const tier of group?.league?.standings || []) {
      for (const r of tier || []) {
        rows.push({
          team: r.team?.name || '',
          played: +r.all?.played || 0,
          gf: +r.all?.goals?.for || 0,
          ga: +r.all?.goals?.against || 0,
          form: r.form || '',
          group: ''
        })
      }
    }
  }
  return rows.length ? rows : null
}

/* ---------------------------- the pipeline ---------------------------- */

async function cachedGet(id, ttl, fetcher) {
  const hit = await cache.findOne({ id })
  if (hit?.at && Date.now() - hit.at < ttl) return hit.data
  const data = await fetcher()
  await cache.set({ id }, { at: Date.now(), data })
  return data
}

/**
 * The whole pipeline: fixtures -> standings -> model -> ranked picks.
 * @param {object} opts { dayOffset=0, league='' } league is a name filter;
 *                 opts.day overrides the date entirely (used by tests).
 */
export async function getBestPicks({ dayOffset = 0, league = '', day = '' } = {}) {
  const key = await resolveFootKey()
  const dayStr = day || dayString(dayOffset)
  const source = key ? 'API-Football' : 'TheSportsDB (keyless)'

  const fixtures = await cachedGet(`fixtures:${dayStr}:${key ? 'af' : 'tsdb'}`, FIXTURES_TTL, () =>
    key ? afFixtures(key, dayStr) : tsdbEvents(dayStr)
  )

  // playable: not postponed, not finished, not kicked off >6h ago
  const now = Date.now()
  let playable = fixtures.filter(
    (f) => !f.postponed && !f.scored && new Date(f.kickoff).getTime() > now - 6 * 3600_000
  )

  const lc = String(league || '').toLowerCase()
  if (lc) {
    playable = playable.filter(
      (f) => String(f.league).toLowerCase().includes(lc) || String(f.country).toLowerCase().includes(lc)
    )
  }

  // standings only for the leagues with the most fixtures (bounded calls)
  const byLeague = new Map()
  for (const f of playable) {
    const k = `${f.leagueId}|${f.league}`
    if (!byLeague.has(k)) byLeague.set(k, [])
    byLeague.get(k).push(f)
  }
  const leagueOrder = [...byLeague.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_TABLES)

  const tables = new Map()
  for (const [k, fixturesInLeague] of leagueOrder) {
    const sample = fixturesInLeague[0]
    tables.set(
      k,
      await cachedGet(`table:${k}`, TABLE_TTL, async () => {
        if (key) {
          const rows = await afStandings(key, sample)
          return rows ? { source: 'af', rows } : null
        }
        const rows = await tsdbTable(sample.leagueId, sample, dayStr)
        return rows ? { source: 'tsdb', rows } : null
      })
    )
  }

  const evaluated = playable.map((f) => {
    const tbl = tables.get(`${f.leagueId}|${f.league}`)
    let home = null, away = null, leagueAvg = 1.35
    if (tbl?.rows) {
      const s = statsFromRows(tbl.rows)
      home = s.byName.get(f.home) || null
      away = s.byName.get(f.away) || null
      if (s.leagueAvg > 0) leagueAvg = s.leagueAvg
    }
    const ev = evaluateMatch(f, { home, away, leagueAvg, odds: f.odds || null })
    return { fixture: f, ...ev }
  })

  const picks = evaluated
    .filter((e) => e.best && e.best.prob >= 55)
    .sort(
      (a, b) =>
        b.best.prob - a.best.prob ||
        new Date(a.fixture.kickoff) - new Date(b.fixture.kickoff)
    )
    .slice(0, 8)

  const matches = [...evaluated].sort((a, b) => new Date(a.fixture.kickoff) - new Date(b.fixture.kickoff))

  return { day: dayStr, tz: TZ, source, keyed: !!key, matches, picks, total: playable.length }
}
