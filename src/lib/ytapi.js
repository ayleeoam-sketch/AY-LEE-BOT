import axios from 'axios'
import { getVar } from './vars.js'

/**
 * YouTube via public download APIs.
 *
 * Why this exists: yt-dlp runs *on your host*, so YouTube sees a datacenter
 * IP and answers "Sign in to confirm you're not a bot". That is why .play and
 * .video die on Render/Koyeb/Heroku while working fine on a home PC.
 *
 * Bots that stay up (SubZero MD and friends) do not download from YouTube at
 * all - they ask a third-party service to do it and hand back a direct file
 * URL, then just fetch that URL. The service eats the bot check. This module
 * is that path, with several providers because free ones die constantly.
 *
 * No keys. Providers are tried in order until one returns a usable link.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

/** Per-provider budget. Slow providers are worse than dead ones. */
const PROVIDER_TIMEOUT = 30_000

/**
 * Each provider gets a URL builder per kind. Response shapes differ wildly
 * and change without notice, so nothing here parses a fixed path - findMedia()
 * walks whatever JSON comes back and picks out the media link.
 */
export const PROVIDERS = [
  {
    name: 'gifted',
    audio: (u) => `https://api.gifted.co.ke/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(u)}`,
    video: (u, q) => `https://api.gifted.co.ke/api/download/ytmp4?apikey=gifted&url=${encodeURIComponent(u)}&quality=${q}`
  },
  {
    name: 'davidcyril',
    audio: (u) => `https://apis.davidcyriltech.my.id/youtube/mp3?url=${encodeURIComponent(u)}`,
    video: (u) => `https://apis.davidcyriltech.my.id/youtube/mp4?url=${encodeURIComponent(u)}`
  },
  {
    name: 'siputzx',
    audio: (u) => `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(u)}`,
    video: (u) => `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(u)}`
  },
  {
    name: 'vreden',
    audio: (u) => `https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(u)}`,
    video: (u, q) => `https://api.vreden.my.id/api/ytmp4?url=${encodeURIComponent(u)}&quality=${q}`
  },
  {
    name: 'izumi',
    audio: (u) => `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(u)}&format=mp3`,
    video: (u) => `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(u)}&format=720`
  },
  {
    name: 'ryzendesu',
    audio: (u) => `https://api.ryzendesu.vip/api/downloader/ytmp3?url=${encodeURIComponent(u)}`,
    video: (u) => `https://api.ryzendesu.vip/api/downloader/ytmp4?url=${encodeURIComponent(u)}`
  }
]

/* ------------------------- response parsing ------------------------- */

const MEDIA_EXT = /\.(mp4|m4a|mp3|webm|opus)(\?|$)/i
const MEDIA_HINT = /(googlevideo|cdn|download|dl\.|\/media\/|stream)/i
const KEY_HINT = /^(url|link|download|downloadurl|download_url|dl|dl_link|result|media|file|audio|video|src)$/i

/**
 * Walk any JSON and return the most likely direct media URL.
 *
 * Deliberately shape-agnostic: these APIs rename fields between versions,
 * and a parser tied to `data.result.download_url` breaks the day they ship
 * `data.data.dl`. Scoring beats guessing.
 */
export function findMedia(payload) {
  const found = []

  const walk = (node, key = '', depth = 0) => {
    if (depth > 8 || node == null) return
    if (typeof node === 'string') {
      const s = node.trim()
      if (!/^https?:\/\//i.test(s)) return
      let score = 0
      if (MEDIA_EXT.test(s)) score += 5
      if (MEDIA_HINT.test(s)) score += 2
      if (KEY_HINT.test(key)) score += 3
      if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(s)) score -= 10 // thumbnails
      if (/youtube\.com|youtu\.be/i.test(s)) score -= 8           // the input URL
      if (score > 0) found.push({ url: s, score })
      return
    }
    if (Array.isArray(node)) return node.forEach((v) => walk(v, key, depth + 1))
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1)
    }
  }

  walk(payload)
  found.sort((a, b) => b.score - a.score)
  return found[0]?.url || ''
}

/** Pull a title out of whatever the provider returned, if it gave one. */
export function findTitle(payload) {
  let title = ''
  const walk = (node, key = '', depth = 0) => {
    if (depth > 6 || node == null || title) return
    if (typeof node === 'string') {
      if (/^(title|name|filename)$/i.test(key) && node.trim().length > 1) title = node.trim()
      return
    }
    if (Array.isArray(node)) return node.forEach((v) => walk(v, key, depth + 1))
    if (typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k, depth + 1)
  }
  walk(payload)
  return title.replace(/\.(mp4|mp3|m4a|webm)$/i, '')
}

/* ---------------------------- downloading ---------------------------- */

/**
 * Ask one provider for a link.
 * @returns {Promise<{url:string, title:string, provider:string}>}
 */
export async function askProvider(provider, youtubeUrl, { audio = false, quality = 360 } = {}) {
  const build = audio ? provider.audio : provider.video
  if (!build) throw new Error(`${provider.name}: no ${audio ? 'audio' : 'video'} endpoint`)

  const { data } = await axios.get(build(youtubeUrl, quality), {
    timeout: PROVIDER_TIMEOUT,
    headers: { 'User-Agent': UA, Accept: 'application/json,*/*' },
    validateStatus: (s) => s >= 200 && s < 400
  })

  const url = findMedia(data)
  if (!url) throw new Error(`${provider.name}: no download link in the response`)
  return { url, title: findTitle(data), provider: provider.name }
}

/**
 * Fetch a direct link into memory, refusing anything too big for WhatsApp
 * before it is downloaded, not after.
 */
export async function fetchMedia(url, { maxMb = 64 } = {}) {
  const res = await axios.get(url, {
    timeout: 180_000,
    responseType: 'arraybuffer',
    maxContentLength: maxMb * 1024 * 1024,
    maxBodyLength: maxMb * 1024 * 1024,
    headers: { 'User-Agent': UA, Referer: 'https://www.youtube.com/' }
  })

  const buffer = Buffer.from(res.data)
  if (!buffer.length) throw new Error('the download came back empty')

  // an HTML error page dressed up as a media file
  const head = buffer.subarray(0, 200).toString('utf8').toLowerCase()
  if (head.includes('<!doctype html') || head.includes('<html')) {
    throw new Error('the link returned a web page, not media')
  }

  const type = String(res.headers['content-type'] || '')
  const ext = /audio|mpeg|mp3/i.test(type) ? 'mp3' : /mp4|video/i.test(type) ? 'mp4' : ''
  return { buffer, ext, bytes: buffer.length }
}

/**
 * Try every provider until one delivers actual bytes.
 *
 * @param {string} youtubeUrl
 * @param {{audio?:boolean, quality?:number, maxMb?:number}} opts
 * @returns {Promise<{buffer:Buffer, ext:string, title:string, provider:string}>}
 */
export async function apiDownload(youtubeUrl, { audio = false, quality = 360, maxMb = 64 } = {}) {
  const order = providerOrder()
  const errors = []

  for (const provider of order) {
    try {
      const { url, title, provider: name } = await askProvider(provider, youtubeUrl, { audio, quality })
      const { buffer, ext } = await fetchMedia(url, { maxMb })
      return { buffer, ext: ext || (audio ? 'mp3' : 'mp4'), title, provider: name }
    } catch (e) {
      errors.push(`${provider.name}: ${short(e)}`)
    }
  }

  const err = new Error(
    `Every download service refused.\n\n${errors.slice(0, 4).join('\n')}\n\n` +
      `_These are free public services - they go down often. Try again in a few minutes._`
  )
  err.providerErrors = errors
  throw err
}

/** Respect a preferred provider set at runtime with .setvar DL_PROVIDER. */
function providerOrder() {
  const preferred = String(getVar('DL_PROVIDER') || '').trim().toLowerCase()
  if (!preferred || preferred === 'auto') return PROVIDERS
  const first = PROVIDERS.filter((p) => p.name === preferred)
  return first.length ? [...first, ...PROVIDERS.filter((p) => p.name !== preferred)] : PROVIDERS
}

const short = (e) => String(e.response?.status || e.message || e).slice(0, 90)

/* ------------------------------ search ------------------------------ */

/**
 * Keyless search that does not need yt-dlp.
 * Piped and Invidious are community YouTube front-ends with open JSON APIs;
 * several instances are listed because individual ones rate-limit or vanish.
 */
const SEARCH_ENDPOINTS = [
  (q) => ({
    url: `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=videos`,
    pick: (d) => d.items || []
  }),
  (q) => ({
    url: `https://pipedapi.adminforge.de/search?q=${encodeURIComponent(q)}&filter=videos`,
    pick: (d) => d.items || []
  }),
  (q) => ({
    url: `https://inv.nadeko.net/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
    pick: (d) => (Array.isArray(d) ? d : [])
  }),
  (q) => ({
    url: `https://api.gifted.co.ke/api/search/yts?apikey=gifted&query=${encodeURIComponent(q)}`,
    pick: (d) => d?.result?.videos || d?.result || []
  })
]

/** Normalise the different search shapes into one. */
const normalise = (v) => {
  const id = v.videoId || v.id || String(v.url || '').split('v=')[1] || ''
  if (!id) return null
  return {
    id,
    title: v.title || v.name || 'Unknown',
    author: v.uploaderName || v.author?.name || v.author || v.channel || '',
    duration: v.duration || v.lengthSeconds || v.seconds || 0,
    views: v.views || v.viewCount || 0,
    url: `https://www.youtube.com/watch?v=${id}`
  }
}

/** @returns {Promise<Array<{id,title,author,duration,views,url}>>} */
export async function apiSearch(query, limit = 5) {
  const errors = []
  for (const build of SEARCH_ENDPOINTS) {
    const { url, pick } = build(query)
    try {
      const { data } = await axios.get(url, {
        timeout: 20_000,
        headers: { 'User-Agent': UA, Accept: 'application/json' }
      })
      const items = pick(data).map(normalise).filter(Boolean)
      if (items.length) return items.slice(0, limit)
    } catch (e) {
      errors.push(short(e))
    }
  }
  throw new Error(`Search failed on every source. ${errors[0] || ''}`.trim())
}

/**
 * Ping every provider so the owner can see what actually works on THEIR host.
 * Used by .ytstatus - the fastest way to tell a dead provider from a dead box.
 */
export async function probeProviders(testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
  return Promise.all(
    PROVIDERS.map(async (p) => {
      const started = Date.now()
      try {
        const { url } = await askProvider(p, testUrl, { audio: true })
        return { name: p.name, ok: true, ms: Date.now() - started, link: url.slice(0, 60) }
      } catch (e) {
        return { name: p.name, ok: false, ms: Date.now() - started, error: short(e) }
      }
    })
  )
}

export default { apiDownload, apiSearch, probeProviders, findMedia, PROVIDERS }
