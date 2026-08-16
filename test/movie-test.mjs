/**
 * Offline tests for .movie (the find-it-anywhere downloader).
 *
 *   node test/movie-test.mjs
 *
 * No network. Providers and their fetchers are injected, so the search,
 * ranking and file-selection logic is exercised for real against fixtures.
 */
import './_isolate.js'
import { loadPlugins, commands } from '../src/lib/pluginLoader.js'
import {
  parseMovieQuery,
  scoreCandidate,
  rank,
  pickBest,
  findVideo,
  archiveProvider,
  ytdlpProvider,
  archiveSearchUrl,
  archiveMetadataUrl,
  pickArchiveFile
} from '../src/lib/moviefind.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

console.log('\n─── registration ───\n')

await loadPlugins()
for (const c of ['movie', 'film', 'episode', 'ep', 'watch', 'cinema']) {
  check(`command .${c} registered`, commands.has(c))
}
const plugin = commands.get('movie')
check('.movie is in DOWNLOADER', plugin?.category === 'DOWNLOADER')
check('.movie declares usage + cooldown', !!plugin?.usage && plugin.cooldown > 0)

/* ================================================================== *
 * query parser
 * ================================================================== */

console.log('\n─── query parser ───\n')

const P = (s) => {
  const q = parseMovieQuery(s)
  return `${q.title}|s${q.season ?? '-'}|e${q.episode ?? '-'}|y${q.year ?? '-'}|${q.quality ?? '-'}`
}

const CASES = [
  ['naruto epi 1', 'naruto|s-|e1|y-|-'],
  ['naruto ep 1', 'naruto|s-|e1|y-|-'],
  ['naruto episode 1', 'naruto|s-|e1|y-|-'],
  ['external fragrance epi 1', 'external fragrance|s-|e1|y-|-'],
  ['interstellar', 'interstellar|s-|e-|y-|-'],
  ['the office s02e05', 'the office|s2|e5|y-|-'],
  ['the office S2 E5', 'the office|s2|e5|y-|-'],
  ['breaking bad 2x05', 'breaking bad|s2|e5|y-|-'],
  ['naruto season 2 episode 7', 'naruto|s2|e7|y-|-'],
  ['naruto season 3', 'naruto|s3|e-|y-|-'],
  ['one piece part 12', 'one piece|s-|e12|y-|-'],
  ['night of the living dead 1968', 'night of the living dead|s-|e-|y1968|-'],
  ['avatar (2009)', 'avatar|s-|e-|y2009|-'],
  ['attack on titan ep 3 720p', 'attack on titan|s-|e3|y-|720p'],
  ['download interstellar full movie', 'interstellar|s-|e-|y-|-'],
  ['please send me naruto epi 1 hd', 'naruto|s-|e1|y-|hd'],
  ['the movie interstellar', 'interstellar|s-|e-|y-|-'],
  ['get me spirited away', 'spirited away|s-|e-|y-|-'],
  ['dragon ball z epi 100', 'dragon ball z|s-|e100|y-|-'],
  ['the.matrix.1999', 'the matrix|s-|e-|y1999|-'],
  ['spirited away 1080p', 'spirited away|s-|e-|y-|1080p'],
  ['tom and jerry ep.5', 'tom and jerry|s-|e5|y-|-']
]
for (const [input, expected] of CASES) {
  check(`"${input}"`, P(input) === expected, P(input))
}
check('parser covers 20+ phrasings', CASES.length >= 20, String(CASES.length))

/*
 * Filler stripping must not eat real titles. "Free Willy", "Full Metal
 * Jacket" and "The Film Star" all start with words that are request filler
 * somewhere else, so they are only stripped when unambiguous.
 */
for (const title of ['free willy', 'full metal jacket', 'the film star', 'free solo', 'the full monty']) {
  check(`title "${title}" survives filler stripping`, parseMovieQuery(title).title === title,
    parseMovieQuery(title).title)
}
check('empty input yields no title', parseMovieQuery('').title === '')
check('episodic flag set for episodes', parseMovieQuery('naruto epi 4').isEpisodic === true)
check('episodic flag clear for films', parseMovieQuery('interstellar').isEpisodic === false)

/* ================================================================== *
 * ranking
 * ================================================================== */

console.log('\n─── ranking ───\n')

const q = parseMovieQuery('naruto epi 1')
const pool = [
  { title: 'Naruto Episode 1 - Enter Naruto Uzumaki', year: '2002', downloads: 5000, hasVideo: true },
  { title: 'Naruto Episode 1 Trailer', year: '2002', downloads: 900, hasVideo: true },
  { title: 'Naruto Episode 2', year: '2002', downloads: 4000, hasVideo: true },
  { title: 'Bleach Episode 1', year: '2004', downloads: 8000, hasVideo: true }
]
const ranked = rank(q, pool)
check('the right episode ranks first', ranked[0].title.includes('Enter Naruto'), ranked[0].title)
check('a trailer never outranks the real episode',
  scoreCandidate(q, pool[0]) > scoreCandidate(q, pool[1]))
check('a different show scores lower', scoreCandidate(q, pool[0]) > scoreCandidate(q, pool[3]))
check('wrong episode scores below right episode',
  scoreCandidate(q, pool[2]) < scoreCandidate(q, pool[0]))
check('rank attaches numeric scores', typeof ranked[0].score === 'number')

const yq = parseMovieQuery('the thing 1982')
check('matching year boosts the right cut',
  scoreCandidate(yq, { title: 'The Thing', year: '1982', hasVideo: true }) >
  scoreCandidate(yq, { title: 'The Thing', year: '2011', hasVideo: true }))

check('pickBest rejects a weak field',
  pickBest(parseMovieQuery('some film nobody has'),
    [{ title: 'Totally Unrelated Documentary', hasVideo: true }]) === null)
check('pickBest accepts a strong match',
  pickBest(q, pool)?.title.includes('Enter Naruto'))
check('soundtrack entries are penalised',
  scoreCandidate(parseMovieQuery('interstellar'), { title: 'Interstellar', hasVideo: true }) >
  scoreCandidate(parseMovieQuery('interstellar'), { title: 'Interstellar Soundtrack', hasVideo: true }))

/* ================================================================== *
 * Archive.org provider
 * ================================================================== */

console.log('\n─── archive.org provider ───\n')

check('search url targets the movies collection',
  archiveSearchUrl('naruto').includes('mediatype%3A(movies)') ||
  decodeURIComponent(archiveSearchUrl('naruto')).includes('mediatype:(movies)'))
check('search url is keyless', !/api[_-]?key|token/i.test(archiveSearchUrl('naruto')))
check('metadata url is built per identifier', archiveMetadataUrl('abc') === 'https://archive.org/metadata/abc')

const meta = {
  metadata: { identifier: 'naruto_ep1' },
  files: [
    { name: 'naruto_ep1.mkv', size: String(700 * 1048576) },
    { name: 'naruto_ep1_512kb.mp4', size: String(25 * 1048576) },
    { name: 'cover.jpg', size: '20000' },
    { name: 'naruto_ep1.srt', size: '4000' }
  ]
}
const picked = pickArchiveFile(meta, { maxMb: 64 })
check('picks a playable mp4 over a huge mkv', picked.name.endsWith('.mp4'), picked.name)
check('skips images and subtitles', !/\.(jpg|srt)$/.test(picked.name))
check('reports the size in MB', picked.mb === 25, String(picked.mb))
check('builds a direct download url',
  picked.url === 'https://archive.org/download/naruto_ep1/naruto_ep1_512kb.mp4', picked.url)
check('flags nothing when everything fits', picked.tooBig === false)

const bigOnly = pickArchiveFile(
  { metadata: { identifier: 'x' }, files: [{ name: 'huge.mp4', size: String(900 * 1048576) }] },
  { maxMb: 64 }
)
check('an oversized-only item is flagged tooBig', bigOnly.tooBig === true, String(bigOnly.mb))
check('an item with no video returns null',
  pickArchiveFile({ metadata: { identifier: 'x' }, files: [{ name: 'a.txt', size: '10' }] }) === null)
check('quality hint is preferred when present',
  pickArchiveFile({
    metadata: { identifier: 'x' },
    files: [
      { name: 'film_360p.mp4', size: String(10 * 1048576) },
      { name: 'film_720p.mp4', size: String(30 * 1048576) }
    ]
  }, { maxMb: 64, quality: '720p' }).name.includes('720p'))

/* ================================================================== *
 * findVideo end to end (injected fetchers)
 * ================================================================== */

console.log('\n─── findVideo (offline, stubbed sources) ───\n')

const docs = [
  { identifier: 'naruto_ep1', title: 'Naruto Episode 1 - Enter Naruto Uzumaki', year: '2002', downloads: 5000 },
  { identifier: 'naruto_tr', title: 'Naruto Episode 1 Trailer', year: '2002', downloads: 900 },
  { identifier: 'naruto_ep2', title: 'Naruto Episode 2', year: '2002', downloads: 4000 }
]
const fetchJson = async (url) => {
  if (url.includes('advancedsearch')) return { response: { docs } }
  if (url.includes('metadata/naruto_ep1')) return meta
  throw new Error(`unexpected url ${url}`)
}

const found = await findVideo('naruto epi 1', { fetchJson, providers: [archiveProvider] })
check('finds the correct episode', found.candidate.title.includes('Enter Naruto'))
check('resolves to a direct mp4', found.file.url.endsWith('.mp4'))
check('reports the provider', found.file.provider === 'Archive.org')
check('returns alternatives', found.alternatives.length >= 1)
check('parsed query travels with the result', found.query.episode === 1)

let stages = []
await findVideo('naruto epi 1', { fetchJson, providers: [archiveProvider], onProgress: (p) => stages.push(p.stage) })
check('progress is reported for search + resolve', stages.includes('search') && stages.includes('resolve'))

/* provider fallback: the first source throws, the second delivers */
const brokenProvider = { name: 'Broken', async search() { throw new Error('service down') } }
const fallback = await findVideo('naruto epi 1', {
  fetchJson,
  providers: [brokenProvider, archiveProvider]
})
check('a dead provider falls through to the next', fallback.candidate.title.includes('Enter Naruto'))

/* nothing found -> a friendly, actionable error (never a stack trace) */
let msg = ''
try {
  await findVideo('a film that does not exist anywhere', {
    fetchJson: async () => ({ response: { docs: [] } }),
    providers: [archiveProvider]
  })
} catch (e) { msg = e.message }
check('a total miss explains itself', /No free, legal source/i.test(msg), msg.slice(0, 70))
check('the miss message names the title', /film that does not exist/i.test(msg))

/* close-but-wrong results are surfaced as suggestions */
msg = ''
try {
  await findVideo('naruto epi 1', {
    fetchJson: async (url) =>
      url.includes('advancedsearch')
        ? { response: { docs: [{ identifier: 'z', title: 'Completely Different Documentary', downloads: 1 }] } }
        : meta,
    providers: [archiveProvider]
  })
} catch (e) { msg = e.message }
check('near misses are offered back to the user', /Closest I saw/i.test(msg), msg.slice(0, 70))

/* an empty query is rejected before any network call */
msg = ''
try { await findVideo('', { providers: [archiveProvider] }) } catch (e) { msg = e.message }
check('an empty query is rejected early', /Tell me what to look for/i.test(msg))

/* yt-dlp provider maps YouTube search results */
const ytResults = await ytdlpProvider.search(parseMovieQuery('naruto epi 1'), {
  youtubeSearch: async () => [{ id: 'a', title: 'Naruto Episode 1 Full', url: 'https://youtu.be/a', views: 10, duration: 1400 }]
})
check('yt-dlp provider maps search results', ytResults[0].url === 'https://youtu.be/a')
check('yt-dlp provider marks results as page urls',
  (await ytdlpProvider.resolve(ytResults[0])).direct === false)
check('yt-dlp provider is inert without a searcher',
  (await ytdlpProvider.search(parseMovieQuery('x'), {})).length === 0)

/* ================================================================== *
 * plugin surface
 * ================================================================== */

console.log('\n─── plugin surface ───\n')

const mkM = (over = {}) => {
  const o = { replies: [], reactions: [], quoted: null, ...over }
  o.reply = async (c) => { o.replies.push(typeof c === 'string' ? c : c.caption || '[media]'); return c }
  o.react = async (e) => { o.reactions.push(e) }
  return o
}

let m = mkM()
await plugin.run({ m, text: '', prefix: '.' })
check('no args -> help card', /MOVIE/.test(m.replies[0] || ''))
check('help shows the episode syntax', /epi 1/.test(m.replies[0]) && /s02e05/.test(m.replies[0]))
check('help is honest about licensing', /licensing wall/i.test(m.replies[0]))

m = mkM()
await plugin.run({ m, text: 'zzz nonexistent title here', prefix: '.' })
check('a failed search reacts ❌ and explains', m.reactions.includes('❌') && m.replies.length >= 2)
check('failure never leaks a stack trace',
  !m.replies.join(' ').includes('at ') && !/Error:/.test(m.replies.join(' ')),
  m.replies.join(' ').slice(0, 90))

/* ================================================================== *
 * regressions found while auditing the command list
 * ================================================================== */

console.log('\n─── crash regressions ───\n')

const bare = (over = {}) => {
  const o = { replies: [], quoted: null, ...over }
  o.reply = async (c) => { o.replies.push(c); return c }
  o.react = async () => {}
  return o
}

/* .element used to throw on any message with no .message (reactions, polls):
 * JSON.stringify(undefined) is undefined, and undefined.slice() crashes. */
let em = bare({ id: 'X', message: undefined, raw: undefined, type: 'reactionMessage', sender: 's' })
await commands.get('element').run({ m: em })
check('.element survives a message with no body', /MESSAGE STRUCTURE/.test(String(em.replies[0] || '')))

/* .getdevice used to throw when no message id was resolvable. */
let gm = bare({ id: undefined, quoted: null })
await commands.get('getdevice').run({ m: gm })
check('.getdevice asks for a reply instead of crashing', /Reply to a message/.test(String(gm.replies[0] || '')))

gm = bare({ id: '3EB0ABCDEF', quoted: null })
await commands.get('getdevice').run({ m: gm })
check('.getdevice still detects a real id', /Device detection/.test(String(gm.replies[0] || '')))

console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`)
if (fail) process.exitCode = 1
