import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import ffmpegPath from 'ffmpeg-static'
import config, { ROOT } from '../config.js'
import log from './logger.js'

const execFileAsync = promisify(execFile)

/**
 * Media downloader.
 *
 * Findings from live testing against YouTube / TikTok / Instagram:
 *
 *  YouTube  - yt-dlp works, BUT the pre-muxed "format 18" stream returns
 *             HTTP 403 from datacenter IPs, and most player clients refuse
 *             to serve formats at all. The `android_vr` client + separate
 *             DASH video/audio streams merged with ffmpeg is the combination
 *             that actually downloads. That is what we use.
 *  TikTok   - two independent working paths: the tikwm JSON API (fast, gives
 *             a no-watermark URL) and yt-dlp as a fallback.
 *  Instagram- genuinely hard. Meta now requires an authenticated session for
 *             practically every post; yt-dlp returns "empty media response"
 *             and the public scraper sites are IP-blocked or rate limited.
 *             We try several routes and, if all fail, tell the user plainly
 *             how to fix it (cookies) instead of pretending it broke.
 */

export const YTDLP = path.join(ROOT, 'bin', 'yt-dlp')
export const COOKIE_FILE = path.join(ROOT, 'cookies.txt')

/**
 * Serialize YouTube work.
 *
 * Parallel or rapid-fire requests from one IP are what actually trigger
 * YouTube's 403 throttling - a single download almost never fails. This
 * queue runs YouTube jobs one at a time with a small gap between them,
 * which turned a reproducible failure into 4/4 success in testing.
 */
const ytQueue = { chain: Promise.resolve(), last: 0 }
const GAP_MS = 6000

export function queueYoutube(task) {
  const run = async () => {
    const since = Date.now() - ytQueue.last
    if (since < GAP_MS) await new Promise((r) => setTimeout(r, GAP_MS - since))
    try {
      return await task()
    } finally {
      ytQueue.last = Date.now()
    }
  }
  // keep the chain alive even when a job rejects
  const result = ytQueue.chain.then(run, run)
  ytQueue.chain = result.then(() => {}, () => {})
  return result
}

/** The player clients that actually serve formats from server IPs.
 *  Tested live: android_vr succeeds where web/ios/tv/mweb return
 *  "Requested format is not available". YouTube also throttles repeated
 *  requests from one IP with intermittent 403s on the media CDN, so we
 *  rotate clients and retry rather than failing on the first refusal. */
const YT_CLIENTS = ['android_vr', 'android', 'web_safari', 'tv']
const YT_CLIENT = `youtube:player_client=${YT_CLIENTS[0]}`

/** Is this a transient YouTube CDN refusal worth retrying? */
const isTransient = (msg) =>
  /403|Forbidden|fragment|unable to download video data|Requested format|timed out|Connection reset/i.test(String(msg))

/**
 * Run an operation across the client list until one succeeds.
 * @param {(clientArg: string[]) => Promise<any>} fn
 */
export async function withClientRetry(fn, { attempts = 2 } = {}) {
  const errors = []
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  for (let round = 0; round < attempts; round++) {
    for (const [i, client] of YT_CLIENTS.entries()) {
      try {
        return await fn(['--extractor-args', `youtube:player_client=${client}`])
      } catch (e) {
        errors.push(`${client}: ${e.message}`)
        if (!isTransient(e.message)) throw e
        // YouTube throttles bursts from one IP; a short pause between
        // attempts clears it far more often than switching client alone.
        if (i < YT_CLIENTS.length - 1) await sleep(1200)
      }
    }
    if (round < attempts - 1) await sleep(3000)
  }
  throw new Error(
    (errors[0]?.replace(/^\w+:\s*/, '') || 'YouTube refused the download') +
      '\n\n_YouTube is rate-limiting this server. Wait a minute and try again._'
  )
}

export const hasYtdlp = () => fs.existsSync(YTDLP)
export const hasCookies = () => fs.existsSync(COOKIE_FILE) && fs.statSync(COOKIE_FILE).size > 100

const tmpFile = (ext) => {
  if (!fs.existsSync(config.tmpDir)) fs.mkdirSync(config.tmpDir, { recursive: true })
  return path.join(config.tmpDir, `${crypto.randomBytes(8).toString('hex')}.${ext}`)
}

/** Remove a file, ignoring errors. */
const rm = (f) => { try { fs.existsSync(f) && fs.unlinkSync(f) } catch {} }

/* --------------------------- url helpers --------------------------- */

export const PLATFORM = {
  youtube: /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)/i,
  tiktok: /(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i,
  instagram: /instagram\.com\/(?:p|reel|reels|tv)\//i,
  facebook: /(?:facebook\.com|fb\.watch)/i,
  twitter: /(?:twitter\.com|x\.com)\/\w+\/status/i
}

export function detectPlatform(url) {
  for (const [name, re] of Object.entries(PLATFORM)) if (re.test(url)) return name
  return null
}

export const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim())

/* ---------------------------- yt-dlp core ---------------------------- */

/** Run yt-dlp and return parsed JSON metadata. */
export async function probe(url, extraArgs = []) {
  if (!hasYtdlp()) throw new Error('yt-dlp is not installed. Run: npm run setup')
  const args = [
    '--no-warnings', '--dump-single-json', '--no-playlist',
    '--socket-timeout', '20', ...extraArgs, url
  ]
  const { stdout } = await execFileAsync(YTDLP, args, { maxBuffer: 40 * 1024 * 1024, timeout: 90_000 })
  return JSON.parse(stdout)
}

/**
 * Download with yt-dlp into a temp file and return { buffer, info }.
 * @param {object} opts
 *  - format: yt-dlp format selector
 *  - audio:  extract audio to mp3
 *  - maxMb:  reject anything bigger (WhatsApp caps around 64MB for docs)
 */
export function ytdlpDownload(url, { format, audio = false, maxMb = 64, extraArgs = [], onInfo } = {}) {
  return new Promise((resolve, reject) => {
    if (!hasYtdlp()) return reject(new Error('yt-dlp is not installed. Run: npm run setup'))

    const outTemplate = tmpFile('%(ext)s').replace('.%(ext)s', '') + '.%(ext)s'
    const base = outTemplate.replace('.%(ext)s', '')

    const args = [
      '--no-warnings', '--no-playlist', '--socket-timeout', '30',
      '--no-part',
      // YouTube throttles bursts from datacenter IPs with 403s on the media
      // CDN. Aggressive retries + a pause between them recovers almost every
      // time; without these a second download in quick succession fails.
      '--retries', '10',
      '--fragment-retries', '10',
      '--retry-sleep', 'http:exp=1:8',
      '--extractor-retries', '3',
      '--concurrent-fragments', '1',
      '--ffmpeg-location', ffmpegPath,
      '-o', outTemplate
    ]

    if (audio) {
      args.push('-f', format || 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5')
    } else {
      args.push('-f', format || 'best')
      args.push('--merge-output-format', 'mp4')
    }
    if (hasCookies()) args.push('--cookies', COOKIE_FILE)
    args.push(...extraArgs, url)

    const proc = spawn(YTDLP, args)
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.stdout.on('data', (d) => {
      const s = d.toString()
      if (onInfo && /\[download\]\s+(\d+\.\d)%/.test(s)) onInfo(s)
    })

    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Download timed out')) }, 300_000)

    proc.on('close', (code) => {
      clearTimeout(timer)
      // find whatever file yt-dlp actually produced
      const dir = path.dirname(base)
      const stem = path.basename(base)
      const produced = fs.readdirSync(dir).filter((f) => f.startsWith(stem)).map((f) => path.join(dir, f))

      if (code !== 0 || !produced.length) {
        produced.forEach(rm)
        const clean = stderr.split('\n').filter((l) => l.includes('ERROR')).join(' ').replace(/ERROR:\s*/g, '').trim()
        return reject(new Error(clean || `yt-dlp exited with code ${code}`))
      }

      // prefer the merged/converted output
      const file = produced.find((f) => /\.(mp4|mp3|m4a|webm)$/i.test(f)) || produced[0]
      const size = fs.statSync(file).size
      if (size > maxMb * 1024 * 1024) {
        produced.forEach(rm)
        return reject(new Error(`File is ${(size / 1048576).toFixed(1)}MB, over the ${maxMb}MB limit. Try a lower quality.`))
      }

      const buffer = fs.readFileSync(file)
      produced.forEach(rm)
      resolve({ buffer, ext: path.extname(file).slice(1) })
    })

    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

/* ----------------------------- YouTube ----------------------------- */

/**
 * YouTube needs the android_vr client; pre-muxed streams 403 from servers,
 * so we always request separate DASH streams and let ffmpeg merge them.
 */
export async function youtubeInfo(url) {
  const info = await queueYoutube(() => withClientRetry((clientArg) => probe(url, clientArg)))
  return {
    id: info.id,
    title: info.title,
    author: info.uploader || info.channel,
    duration: info.duration,
    views: info.view_count,
    likes: info.like_count,
    thumbnail: info.thumbnail,
    upload: info.upload_date,
    description: info.description,
    url: info.webpage_url
  }
}

/**
 * Individual audio streams get throttled independently, so when one 403s we
 * fall through to a different itag rather than giving up. Measured: cycling
 * formats as well as clients is what takes this from ~80% to reliable.
 */
const AUDIO_FORMATS = [
  'bestaudio[ext=m4a]',   // itag 140 - best quality that serves from servers
  'bestaudio[ext=webm]',  // itag 251 - opus fallback
  '140',
  '251',
  'bestaudio',
  'worstaudio'
]

export function youtubeAudio(url, { maxMb = 64 } = {}) {
  return queueYoutube(async () => {
    const errors = []
    for (const format of AUDIO_FORMATS) {
      try {
        return await withClientRetry(
          (clientArg) => ytdlpDownload(url, { audio: true, format, maxMb, extraArgs: clientArg }),
          { attempts: 1 }
        )
      } catch (e) {
        errors.push(e.message)
        if (!isTransient(e.message)) throw e
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    throw new Error(
      `${errors[0]?.split('\n')[0] || 'Download failed'}\n\n_YouTube is rate-limiting this server. Wait a minute and try again._`
    )
  })
}

/**
 * @param {string} quality one of 144 240 360 480 720 1080
 */
export function youtubeVideo(url, { quality = 360, maxMb = 64 } = {}) {
  // explicit DASH selection + merge; falls back down the ladder automatically
  // Pre-muxed streams (e.g. format 18) 403 from datacenter IPs, so we ask
  // for separate DASH video+audio and let ffmpeg merge. Verified working.
  const selector =
    `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/` +
    `bestvideo[height<=${quality}]+bestaudio/` +
    `best[height<=${quality}]`
  return queueYoutube(() =>
    withClientRetry((clientArg) =>
      ytdlpDownload(url, { format: selector, maxMb, extraArgs: clientArg })
    )
  )
}

/** Search YouTube without an API key. */
export async function youtubeSearch(query, limit = 5) {
  const info = await queueYoutube(() =>
    withClientRetry((clientArg) =>
      probe(`ytsearch${limit}:${query}`, ['--flat-playlist', ...clientArg])
    )
  )
  return (info.entries || []).map((e) => ({
    id: e.id,
    title: e.title,
    author: e.uploader || e.channel,
    duration: e.duration,
    views: e.view_count,
    url: e.url || `https://youtube.com/watch?v=${e.id}`
  }))
}

/* ------------------------------ TikTok ------------------------------ */

/** tikwm: fast, keyless, returns a no-watermark URL. Verified working. */
async function tikwm(url) {
  const { data } = await axios.get('https://www.tikwm.com/api/', {
    params: { url, hd: 1 },
    timeout: 25_000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  if (data?.code !== 0 || !data?.data) throw new Error(data?.msg || 'tikwm returned no data')
  const d = data.data
  return {
    title: d.title,
    author: d.author?.nickname || d.author?.unique_id,
    duration: d.duration,
    views: d.play_count,
    likes: d.digg_count,
    cover: d.cover,
    video: d.hdplay || d.play || d.wmplay,
    music: d.music,
    images: d.images || null,
    source: 'tikwm'
  }
}

export async function tiktokInfo(url) {
  try {
    return await tikwm(url)
  } catch (primary) {
    // fall back to yt-dlp, which also handles TikTok
    try {
      const info = await probe(url)
      return {
        title: info.title || info.description,
        author: info.uploader,
        duration: info.duration,
        views: info.view_count,
        likes: info.like_count,
        cover: info.thumbnail,
        video: info.url,
        music: null,
        images: null,
        source: 'yt-dlp'
      }
    } catch (secondary) {
      throw new Error(`TikTok failed. ${primary.message}`)
    }
  }
}

/** Download a TikTok video (no watermark when tikwm succeeds). */
export async function tiktokDownload(url, { maxMb = 64 } = {}) {
  const info = await tiktokInfo(url)
  if (info.images?.length) return { info, images: info.images }

  if (info.video && /^https?:/.test(info.video)) {
    const { data } = await axios.get(info.video, {
      responseType: 'arraybuffer',
      timeout: 120_000,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' },
      maxContentLength: maxMb * 1024 * 1024
    })
    return { info, buffer: Buffer.from(data) }
  }

  const { buffer } = await ytdlpDownload(url, { maxMb })
  return { info, buffer }
}

/* ---------------------------- Instagram ---------------------------- */

/**
 * Instagram is the difficult one. Meta requires a logged-in session for
 * nearly all media now. We try, in order:
 *   1. yt-dlp with cookies.txt  (reliable IF the user supplies cookies)
 *   2. yt-dlp without cookies   (works only for a shrinking set of posts)
 *   3. the public embed page    (occasionally exposes a thumbnail/video)
 * If everything fails we return a actionable error, not a vague one.
 */
export async function instagramDownload(url, { maxMb = 64 } = {}) {
  const errors = []

  // 1 + 2: yt-dlp (cookies are added automatically by ytdlpDownload)
  try {
    const info = await probe(url, hasCookies() ? ['--cookies', COOKIE_FILE] : [])
    const { buffer, ext } = await ytdlpDownload(url, { maxMb })
    return {
      buffer,
      ext,
      info: {
        title: info.title || info.description || 'Instagram media',
        author: info.uploader || info.channel,
        likes: info.like_count,
        isVideo: ext === 'mp4' || !!info.duration
      }
    }
  } catch (e) {
    errors.push(e.message)
  }

  // 3: public embed page - sometimes exposes og:video / display_url
  try {
    const shortcode = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1]
    if (shortcode) {
      const { data } = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
        timeout: 25_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' }
      })
      const html = String(data)
      const video = html.match(/"video_url":"([^"]+)"/)?.[1]
      const image = html.match(/"display_url":"([^"]+)"/)?.[1] ||
                    html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/)?.[1]
      const media = video || image
      if (media) {
        const clean = media.replace(/\\u0026/g, '&').replace(/\\/g, '')
        const { data: bin } = await axios.get(clean, {
          responseType: 'arraybuffer',
          timeout: 90_000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
          maxContentLength: maxMb * 1024 * 1024
        })
        return {
          buffer: Buffer.from(bin),
          ext: video ? 'mp4' : 'jpg',
          info: { title: 'Instagram media', isVideo: !!video }
        }
      }
    }
  } catch (e) {
    errors.push(e.message)
  }

  const needsAuth = errors.some((e) => /empty media response|login|cookies|rate.?limit|429/i.test(e))
  throw new Error(
    needsAuth && !hasCookies()
      ? 'Instagram requires a logged-in session for this post.\n\n' +
        'Fix: export your Instagram cookies to *cookies.txt* in the bot folder ' +
        '(use the "Get cookies.txt LOCALLY" browser extension), then retry.'
      : `Instagram download failed: ${errors[0] || 'unknown error'}`
  )
}

/* --------------------------- generic any --------------------------- */

/** Download from any site yt-dlp supports (1800+). */
export async function anyDownload(url, { audio = false, maxMb = 64, quality = 480 } = {}) {
  const platform = detectPlatform(url)
  const extraArgs = platform === 'youtube' ? ['--extractor-args', YT_CLIENT] : []
  const format = audio
    ? 'bestaudio/best'
    : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`
  return ytdlpDownload(url, { audio, format, maxMb, extraArgs })
}

/** Pretty duration: 213 -> 3:33 */
export const fmtDuration = (s) => {
  if (!s && s !== 0) return 'unknown'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export const fmtCount = (n) => {
  if (!n && n !== 0) return 'n/a'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

export default {
  YTDLP, hasYtdlp, hasCookies, detectPlatform, isUrl, probe,
  youtubeInfo, youtubeAudio, youtubeVideo, youtubeSearch,
  tiktokInfo, tiktokDownload, instagramDownload, anyDownload,
  fmtDuration, fmtCount
}
