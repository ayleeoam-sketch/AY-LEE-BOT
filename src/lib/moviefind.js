import { getJson, getBuffer, http } from './api.js'

/**
 * moviefind - "find that video anywhere, then hand me a download URL".
 *
 * Powers `.movie`. The user types what they remember and the bot works out
 * the rest:
 *
 *   .movie naruto epi 1
 *   .movie external fragrance epi 1
 *   .movie interstellar
 *   .movie the office s02e05
 *
 * Design notes
 * ------------
 * Two pure layers (parser + ranking) so the guesswork is fully testable
 * offline, and a provider layer where every source is a small object with
 * search()/resolve(). Providers are injected, which keeps the tests free
 * of network calls and makes adding a new source a 10-line change.
 *
 * Legality: this only searches sources that host their own public-domain or
 * freely-licensed catalogues (Archive.org is the keyless default). It does
 * NOT scrape piracy streaming sites. If a title is not on a legal free
 * source, the bot says so instead of pretending.
 */

/* ------------------------------------------------------------------ *
 * Part 1 - query parser (pure)
 * ------------------------------------------------------------------ */

/**
 * Request filler, stripped only from the edges of the query.
 *
 * Edge-anchored on purpose: "download naruto" is a request, but "The Film
 * Star" and "Free Willy" are titles. Stripping these anywhere used to eat
 * real words out of the middle of a name.
 */
const NOISE = [
  'download', 'watch', 'stream', 'full', 'movie', 'film', 'video', 'online',
  'free', 'hd', 'please', 'pls', 'abeg', 'for me', 'get me', 'find', 'send',
  'bring', 'give me', 'i want', 'complete', 'latest', 'me', 'the movie',
  'full movie', 'i need', 'can you get', 'show me'
]

/**
 * Words that only ever appear as a request verb, never as the first word of
 * a real title. "free"/"full" are excluded here because "Free Willy" and
 * "Full Metal Jacket" exist.
 */
const SAFE_LEAD = new Set([
  'download', 'watch', 'stream', 'please', 'pls', 'abeg', 'find', 'send',
  'bring', 'get me', 'give me', 'i want', 'i need', 'can you get', 'show me',
  'for me', 'me'
])

/**
 * Strip request filler from the edges only, and never strip so much that
 * nothing meaningful is left ("free willy" keeps both words).
 */
function stripNoise(text) {
  /*
   * "the movie interstellar" is a request. "The Film Star" is a title, so
   * only "the movie" is treated as filler - it never opens a real title,
   * whereas "the film ..." plausibly does.
   */
  let s = text.trim().replace(/^the\s+movie\s+(?=\S)/i, '')
  let changed = true
  while (changed) {
    changed = false
    for (const w of NOISE) {
      const pattern = w.replace(/\s+/g, '\\s+')
      const lead = new RegExp(`^${pattern}\\s+`, 'i')
      const trail = new RegExp(`\\s+${pattern}$`, 'i')

      /*
       * Only ever drop a LEADING word when it is unambiguous request-speak.
       * "full metal jacket" and "free willy" start with words that are
       * filler elsewhere but are part of the title here.
       */
      if (lead.test(s) && SAFE_LEAD.has(w)) {
        const rest = s.replace(lead, '').trim()
        if (rest) { s = rest; changed = true }
      }
      if (trail.test(s)) {
        const rest = s.replace(trail, '').trim()
        if (rest) { s = rest; changed = true }
      }
    }
  }
  return s.trim()
}

/** Quality hints the user may tack on. */
const QUALITY = /\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd|cam|ts)\b/i

/**
 * Pull structure out of a plain-English request.
 *
 * Understands, in roughly this priority:
 *   s02e05 · season 2 episode 5 · 2x05 · epi 1 · ep 1 · episode 1 · part 3
 *   a trailing/parenthesised year (1968, (2014))
 *   a quality hint (720p, 1080p)
 *
 * @returns {{title:string, season:number|null, episode:number|null,
 *            year:number|null, quality:string|null, isEpisodic:boolean, raw:string}}
 */
export function parseMovieQuery(input) {
  const raw = String(input || '').trim()
  let s = raw

  let season = null
  let episode = null
  let year = null
  let quality = null

  // quality first - it is unambiguous
  const q = s.match(QUALITY)
  if (q) {
    quality = q[1].toLowerCase()
    s = s.replace(q[0], ' ')
  }

  // s02e05 / s2 e5 / s02 ep05
  let mt = s.match(/\bs(?:eason)?\s*(\d{1,2})\s*[\s._-]*(?:e|ep|epi|episode)\s*(\d{1,3})\b/i)
  if (mt) {
    season = +mt[1]
    episode = +mt[2]
    s = s.replace(mt[0], ' ')
  }

  // 2x05
  if (episode === null) {
    mt = s.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/i)
    if (mt) {
      season = +mt[1]
      episode = +mt[2]
      s = s.replace(mt[0], ' ')
    }
  }

  // "episode 1" / "epi 1" / "ep 1" / "part 3" on its own
  if (episode === null) {
    mt = s.match(/\b(?:episode|epis|epi|ep|part|pt)\s*\.?\s*(\d{1,3})\b/i)
    if (mt) {
      episode = +mt[1]
      s = s.replace(mt[0], ' ')
    }
  }

  // a standalone season with no episode ("naruto season 2")
  if (season === null) {
    mt = s.match(/\bs(?:eason)?\s*\.?\s*(\d{1,2})\b/i)
    if (mt && !/^\s*s\s*$/i.test(mt[0])) {
      season = +mt[1]
      s = s.replace(mt[0], ' ')
    }
  }

  // year: (1968) or a bare 4-digit year
  mt = s.match(/\((\d{4})\)/) || s.match(/\b(19\d{2}|20\d{2})\b/)
  if (mt) {
    const y = +mt[1]
    if (y >= 1900 && y <= new Date().getFullYear() + 2) {
      year = y
      s = s.replace(mt[0], ' ')
    }
  }

  const title = stripNoise(
    s
      .replace(/[_.]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s'&:-]/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s:-]+|[\s:-]+$/g, '')
      .trim()
  )

  return {
    title,
    season,
    episode,
    year,
    quality,
    isEpisodic: episode !== null || season !== null,
    raw
  }
}

/* ------------------------------------------------------------------ *
 * Part 2 - result ranking (pure)
 * ------------------------------------------------------------------ */

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Score how well a candidate matches what the user asked for.
 * Higher is better; anything <= 0 is discarded by pickBest().
 */
export function scoreCandidate(query, candidate) {
  const want = norm(query.title)
  const got = norm(candidate.title)
  if (!want || !got) return 0

  const wantWords = want.split(' ').filter(Boolean)
  const gotWords = new Set(got.split(' ').filter(Boolean))

  let score = 0
  if (got === want) score += 100
  else if (got.startsWith(want) || got.includes(want)) score += 60

  // word overlap - the bulk of the signal for fuzzy titles
  const hits = wantWords.filter((w) => gotWords.has(w)).length
  score += (hits / Math.max(1, wantWords.length)) * 50
  // every asked-for word present is a strong signal
  if (hits === wantWords.length) score += 20

  // an episode request should match an item that mentions that episode
  if (query.episode !== null) {
    const ep = String(query.episode)
    const padded = ep.padStart(2, '0')
    const epRe = new RegExp(`(?:^|[^\\d])(?:e|ep|epi|episode|part|pt)\\s*\\.?\\s*0*${ep}(?![\\d])`, 'i')
    if (epRe.test(candidate.title)) score += 45
    else if (new RegExp(`(?:^|[^\\d])0*${padded}(?![\\d])`).test(candidate.title)) score += 15
  }
  if (query.season !== null) {
    const se = String(query.season)
    if (new RegExp(`s(?:eason)?\\s*0*${se}(?![\\d])`, 'i').test(candidate.title)) score += 25
  }
  if (query.year && candidate.year) {
    if (+candidate.year === query.year) score += 30
    else if (Math.abs(+candidate.year - query.year) <= 1) score += 8
    else score -= 10
  }

  // prefer things that actually look playable
  if (candidate.hasVideo) score += 10
  if (candidate.downloads) score += Math.min(10, Math.log10(candidate.downloads + 1) * 2)

  // penalise obvious non-features
  if (/\b(trailer|teaser|preview|clip|sample|behind the scenes|interview|review|reaction)\b/i.test(candidate.title)) {
    score -= 55
  }
  if (/\b(soundtrack|ost|audiobook|commentary|subtitle)\b/i.test(candidate.title)) score -= 35

  return score
}

/** Rank candidates and return the best, or null when nothing is close. */
export function pickBest(query, candidates, { minScore = 35 } = {}) {
  const ranked = rank(query, candidates)
  return ranked.length && ranked[0].score >= minScore ? ranked[0] : null
}

/** All candidates, best first, with their scores attached. */
export function rank(query, candidates = []) {
  return candidates
    .filter((c) => c && c.title)
    .map((c) => ({ ...c, score: Math.round(scoreCandidate(query, c) * 10) / 10 }))
    .sort((a, b) => b.score - a.score)
}

/* ------------------------------------------------------------------ *
 * Part 3 - providers
 * ------------------------------------------------------------------ */

const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ogv|mpg|mpeg)$/i

/** Build the Archive.org advanced-search URL (exported for tests). */
export const archiveSearchUrl = (title, rows = 12) =>
  'https://archive.org/advancedsearch.php?q=' +
  encodeURIComponent(`title:(${title}) AND mediatype:(movies)`) +
  '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=downloads' +
  `&rows=${rows}&page=1&output=json`

export const archiveMetadataUrl = (id) => `https://archive.org/metadata/${encodeURIComponent(id)}`

/** Pick the best playable file from an Archive.org metadata payload. */
export function pickArchiveFile(meta, { maxMb = 64, quality = null } = {}) {
  const files = (meta?.files || []).filter((f) => VIDEO_EXT.test(f.name || ''))
  if (!files.length) return null

  const scored = files
    .map((f) => {
      const size = Number(f.size || 0)
      let s = 0
      // mp4 plays everywhere; mkv/avi often will not preview on WhatsApp
      if (/\.mp4$/i.test(f.name)) s += 30
      else if (/\.(m4v|webm|mov)$/i.test(f.name)) s += 10
      if (quality && new RegExp(quality, 'i').test(f.name)) s += 20
      // prefer the largest file that still fits the cap
      const mb = size / 1048576
      if (mb > 0 && mb <= maxMb) s += 20 + Math.min(15, mb / 10)
      else if (mb > maxMb) s -= 40
      return { name: f.name, size, mb, score: s }
    })
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best) return null
  return {
    name: best.name,
    size: best.size,
    mb: Math.round(best.mb * 10) / 10,
    tooBig: best.mb > maxMb,
    url: `https://archive.org/download/${encodeURIComponent(meta.metadata?.identifier || '')}/${encodeURIComponent(best.name)}`
  }
}

/**
 * Archive.org - the keyless default. A large, legal, public-domain catalogue
 * (classic films, cartoons, TV, lots of anime episodes).
 */
export const archiveProvider = {
  name: 'Archive.org',
  async search(query, { fetchJson = getJson } = {}) {
    // an episode request searches for the episode text too
    const terms = [query.title]
    if (query.episode !== null) terms.push(`episode ${query.episode}`)
    const data = await fetchJson(archiveSearchUrl(terms.join(' ')))
    const docs = data?.response?.docs || []
    return docs.map((d) => ({
      id: d.identifier,
      title: Array.isArray(d.title) ? d.title[0] : d.title,
      year: Array.isArray(d.year) ? d.year[0] : d.year,
      downloads: Number(d.downloads || 0),
      hasVideo: true,
      provider: 'Archive.org',
      page: `https://archive.org/details/${d.identifier}`
    }))
  },
  async resolve(candidate, { fetchJson = getJson, maxMb = 64, quality = null } = {}) {
    const meta = await fetchJson(archiveMetadataUrl(candidate.id))
    const file = pickArchiveFile(meta, { maxMb, quality })
    if (!file) throw new Error('That item has no downloadable video file.')
    return { ...file, provider: 'Archive.org', page: candidate.page, title: candidate.title }
  }
}

/**
 * yt-dlp catch-all. yt-dlp supports 1800+ sites, so if the user pastes a
 * link from anywhere this handles it. Also used to search YouTube for
 * legitimately free full-length uploads when Archive.org has nothing.
 */
export const ytdlpProvider = {
  name: 'yt-dlp',
  async search(query, deps = {}) {
    const { youtubeSearch } = deps
    if (!youtubeSearch) return []
    const terms = [query.title]
    if (query.season !== null) terms.push(`season ${query.season}`)
    if (query.episode !== null) terms.push(`episode ${query.episode}`)
    terms.push('full')
    const results = await youtubeSearch(terms.join(' '), 8)
    return (results || []).map((r) => ({
      id: r.id,
      title: r.title,
      year: r.upload ? +String(r.upload).slice(0, 4) : null,
      duration: r.duration,
      downloads: r.views || 0,
      hasVideo: true,
      provider: 'YouTube',
      url: r.url,
      page: r.url
    }))
  },
  async resolve(candidate) {
    return { url: candidate.url, provider: 'YouTube', page: candidate.page, title: candidate.title, direct: false }
  }
}

/** Default provider chain: keyless legal sources first. */
export const PROVIDERS = [archiveProvider, ytdlpProvider]

/**
 * Find one downloadable video for a plain-English request.
 *
 * Every provider is tried in order; the first one that yields a good enough
 * match wins. Providers and their fetchers are injected so this runs offline
 * in tests.
 *
 * @returns {Promise<{query, candidate, file, alternatives}>}
 */
export async function findVideo(input, deps = {}) {
  const { providers = PROVIDERS, maxMb = 64, minScore = 35, onProgress = () => {} } = deps
  const query = parseMovieQuery(input)
  if (!query.title) throw new Error('Tell me what to look for - *.movie naruto epi 1*')

  const errors = []
  const seen = []

  for (const provider of providers) {
    try {
      onProgress({ stage: 'search', provider: provider.name })
      const candidates = await provider.search(query, deps)
      const ranked = rank(query, candidates)
      seen.push(...ranked)
      const best = ranked.length && ranked[0].score >= minScore ? ranked[0] : null
      if (!best) continue

      onProgress({ stage: 'resolve', provider: provider.name, title: best.title })
      const file = await provider.resolve(best, { ...deps, maxMb, quality: query.quality })
      return {
        query,
        candidate: best,
        file,
        alternatives: rank(query, seen).slice(1, 4)
      }
    } catch (e) {
      errors.push(`${provider.name}: ${String(e.message || e).split('\n')[0].slice(0, 90)}`)
    }
  }

  const close = rank(query, seen).slice(0, 3)
  const err = new Error(
    close.length
      ? `Nothing matched *${query.title}* closely enough.\n\nClosest I saw:\n` +
        close.map((c) => `• ${c.title}`).join('\n')
      : `No free, legal source has *${query.title}*${query.episode !== null ? ` episode ${query.episode}` : ''}.`
  )
  err.providerErrors = errors
  err.close = close
  throw err
}

export default {
  parseMovieQuery,
  scoreCandidate,
  pickBest,
  rank,
  findVideo,
  archiveProvider,
  ytdlpProvider,
  archiveSearchUrl,
  archiveMetadataUrl,
  pickArchiveFile,
  PROVIDERS
}
