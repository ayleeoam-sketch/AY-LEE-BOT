import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import sharp from 'sharp'
import config from '../config.js'
import { FFMPEG } from './media.js'

/**
 * clipstitch - the engine behind .capcut
 *
 * Three layers, deliberately separated so the hard parts stay testable:
 *
 *   1. parseCapcutIntent(text)          pure  - plain English -> ordered ops
 *   2. buildCapcutPipeline(ops, opts)   pure  - ops -> exact ffmpeg filters
 *   3. renderEdit() / renderCreate()    impure - runs ffmpeg, cleans tmp
 *
 * Layers 1 and 2 never touch the disk or the network, so test/capcut-test.mjs
 * can snapshot them offline. Everything network-facing (TTS, stock media) is
 * injected as a dependency so the same tests can drive the real assembler
 * with stubs.
 *
 * Keyless first: Google Translate TTS needs no key, loremflickr needs no key.
 * PEXELS_KEY / PIXABAY_KEY are optional upgrades for real motion clips.
 */

/* ------------------------------------------------------------------ *
 * House output format - identical everywhere so clips concat cleanly
 * ------------------------------------------------------------------ */

export const OUT_W = 1280
export const OUT_H = 720
export const OUT_FPS = 30

/** h264 / CRF 28 / faststart - the format every .capcut job encodes to. */
export const H264 = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
  '-pix_fmt', 'yuv420p', '-movflags', 'faststart'
]

/** AAC 128k stereo 44.1k. */
export const AAC = ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2']

export const MAX_INPUT_MB = 40
export const JOB_TIMEOUT_MS = 5 * 60_000
/** hard ceiling on any single edited clip */
export const MAX_EDIT_SECONDS = 180
/** hard ceiling on a generated (create mode) video */
export const MAX_CREATE_SECONDS = 300
/** Google Translate TTS refuses anything longer per request */
export const TTS_CHUNK = 200

/* ------------------------------------------------------------------ *
 * Part 1 - natural language intent parser (pure)
 * ------------------------------------------------------------------ */

/** Canonical execution order. Lower runs first, ties keep parse order. */
export const OP_ORDER = {
  trim: 10,
  crop: 20,
  speed: 30,
  reverse: 31,
  boomerang: 32,
  fps: 33,
  speedramp: 34,
  style: 40,
  zoom: 50,
  shake: 51,
  caption: 60,
  mute: 70,
  voiceover: 71
}

/** Every style the parser understands, with the words that trigger it. */
export const STYLES = {
  cinematic: ['cinematic', 'movie look', 'film look', 'filmic', 'letterbox', 'widescreen'],
  vintage: ['vintage', 'sepia', 'retro film', 'old school', 'oldschool', '90s', 'nostalgic'],
  vaporwave: ['vaporwave', 'retro', 'synthwave', 'aesthetic'],
  bw: ['black and white', 'black & white', 'blackandwhite', 'b&w', 'bw', 'grayscale', 'greyscale', 'monochrome', 'noir'],
  glitch: ['glitch', 'glitchy', 'broken tv', 'datamosh', 'vhs'],
  viral: ['viral', 'trending', 'tiktok style', 'punchy', 'go viral', 'trend'],
  warm: ['warm', 'golden hour', 'sunset tone', 'cozy'],
  cold: ['cold', 'cool tone', 'blue tone', 'icy', 'moody blue'],
  bright: ['bright', 'brighten', 'brighter', 'lighten'],
  dark: ['dark', 'darken', 'darker', 'moody']
}

const QUOTES = '["“”\'‘’«»`]'

/** Pull a quoted phrase, or everything after the keyword, out of a match. */
const takePhrase = (raw) => {
  if (!raw) return ''
  let s = String(raw).trim()
  const q = s.match(new RegExp(`^${QUOTES}([\\s\\S]*?)${QUOTES}\\s*$`))
  if (q) return q[1].trim()
  // unterminated opening quote - take the rest
  const open = s.match(new RegExp(`^${QUOTES}([\\s\\S]*)$`))
  if (open) s = open[1]
  // stop at a chained instruction ("... and make it cinematic")
  s = s.split(/\s+(?:then|,\s*and|,)\s+/i)[0]
  return s.replace(new RegExp(`${QUOTES}+\\s*$`), '').trim()
}

/** "1:05" | "65" | "1m5s" -> seconds */
export const toSeconds = (v) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim().toLowerCase()
  if (!s) return null
  if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(s)) {
    const p = s.split(':').map(Number)
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
  }
  const hms = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return (+(hms[1] || 0)) * 3600 + (+(hms[2] || 0)) * 60 + (+(hms[3] || 0))
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** Words that carry no instruction - leftovers made only of these are fine. */
const FILLER = new Set([
  'i', 'want', 'a', 'an', 'the', 'to', 'it', 'this', 'that', 'my', 'me', 'please', 'pls', 'plz',
  'and', 'then', 'also', 'with', 'of', 'for', 'on', 'in', 'at', 'by', 'from', 'up', 'down',
  'make', 'makes', 'making', 'made', 'do', 'does', 'can', 'you', 'u', 'bot', 'now', 'just',
  'video', 'vid', 'clip', 'movie', 'edit', 'editing', 'effect', 'effects', 'style', 'look',
  'be', 'is', 'its', 'go', 'goes', 'more', 'very', 'so', 'some', 'little', 'bit', 'abeg', 'sha',
  'nice', 'good', 'cool', 'fine', 'ok', 'okay', 'thanks', 'thank', 'sir', 'boss', 'fam', 'bro',
  // vocabulary the parser already acted on - a partial regex match can leave
  // one of these behind, and it must not trigger the "unknown verb" card
  'voice', 'voiceover', 'vo', 'narrate', 'narration', 'narrator', 'read', 'reading', 'reads',
  'say', 'says', 'saying', 'aloud', 'speak', 'speaking', 'talk', 'quoted', 'replied', 'reply',
  'message', 'msg', 'caption', 'captions', 'subtitle', 'subtitles', 'title', 'put', 'add',
  'apply', 'give', 'set', 'turn', 'sound', 'audio', 'music', 'track', 'aspect', 'ratio',
  'seconds', 'second', 'secs', 'sec', 'minutes', 'minute', 'mins', 'min', 'start', 'beginning',
  'end', 'ending', 'motion', 'speed', 'colour', 'color', 'tone', 'filter', 'vibe', 'mood',
  // vague descriptors and connectors that ride along with a real instruction
  'vibes', 'small', 'into', 'like', 'status', 'reels', 'moodier', 'brighter', 'darker',
  'looking', 'looks', 'feel', 'feels', 'style', 'styled', 'version', 'please', 'still',
  'really', 'quite', 'much', 'well', 'again', 'too', 'also', 'plus', 'while', 'keep', 'keeping'
])

/**
 * Parse plain English into an ordered, de-duplicated op list.
 *
 * @param {string} input what the user typed after ".capcut"
 * @returns {{mode:'edit'|'create'|'help', ops:Array, unknown:string[], topic?:string,
 *            duration?:number, stock?:'clips'|'images', raw:string}}
 */
export function parseCapcutIntent(input) {
  const raw = String(input || '').trim()
  if (!raw) return { mode: 'help', ops: [], unknown: [], raw }

  // ---- create mode: no source video, the bot builds one from scratch ----
  const create = raw.match(
    /^(?:create|make|generate|build|produce)\b(?![^]*\b(?:it|this|that)\b\s*$)([\s\S]*)$/i
  )
  if (create && /\b(?:about|on|for)\b|\bstock\b|\bfrom scratch\b/i.test(raw)) {
    return parseCreate(raw)
  }

  const ops = []
  // consumed[i] = true once a character belongs to a recognised instruction
  const consumed = new Array(raw.length).fill(false)
  const eat = (match) => {
    if (!match || match.index === undefined) return
    for (let i = match.index; i < match.index + match[0].length; i++) consumed[i] = true
  }

  const add = (op) => {
    if (op.type === 'style' && ops.some((o) => o.type === 'style' && o.name === op.name)) return
    if (['reverse', 'boomerang', 'mute', 'shake', 'speedramp', 'fps'].includes(op.type) &&
        ops.some((o) => o.type === op.type)) return
    ops.push(op)
  }

  /** run a regex over the text, feeding every match to fn and marking it consumed */
  const scan = (re, fn) => {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    let mt
    while ((mt = rx.exec(raw)) !== null) {
      if (consumed[mt.index]) continue
      const keep = fn(mt)
      if (keep !== false) eat(mt)
      if (mt[0] === '') rx.lastIndex++
    }
  }

  /* ---------------------------- voiceover ---------------------------- */

  // "read the quoted message" / "voiceover read from the quoted message"
  scan(
    /\b(?:(?:add|with|use|do)\s+)?(?:a\s+|an\s+|my\s+|the\s+)?(?:voice\s?over|voiceover|voice|narration|narrator|vo)?\s*(?:that\s+)?(?:read(?:s|ing)?|say(?:s|ing)?|use|using|from|of|off)?\s*(?:the\s+|that\s+|this\s+)?(?:quoted|replied|reply|above|previous)\s+(?:message|text|msg|line)\b/i,
    () => add({ type: 'voiceover', source: 'quoted', text: '' })
  )

  // "voiceover saying X" / "add voice saying X" / "narrate X" / "say X"
  scan(
    new RegExp(
      '\\b(?:add\\s+|put\\s+|with\\s+|do\\s+|give\\s+(?:me\\s+)?)?' +
      '(?:a\\s+|an\\s+|my\\s+)?' +
      '(?:voice\\s?over|voiceover|voice|narration|narrator|vo)\\s*' +
      '(?:that\\s+)?(?:say(?:s|ing)?|read(?:s|ing)?|tell(?:s|ing)?|with|of|:)?\\s*' +
      `(${QUOTES}[\\s\\S]*?${QUOTES}|${QUOTES}[\\s\\S]*$|[^,.]*)`,
      'i'
    ),
    (mt) => {
      if (ops.some((o) => o.type === 'voiceover')) return false
      const text = takePhrase(mt[1])
      add({ type: 'voiceover', source: text ? 'text' : 'auto', text })
    }
  )

  // "narrate X" / "say X out loud"
  scan(
    new RegExp(`\\b(?:narrate|say)\\s+(${QUOTES}[\\s\\S]*?${QUOTES}|${QUOTES}[\\s\\S]*$|[^,.]*)`, 'i'),
    (mt) => {
      if (ops.some((o) => o.type === 'voiceover')) return false
      const text = takePhrase(mt[1])
      if (!text) return false
      add({ type: 'voiceover', source: 'text', text })
    }
  )

  /* ---------------------------- captions ----------------------------- */

  scan(
    new RegExp(
      '\\b(?:add\\s+|put\\s+|with\\s+|write\\s+|overlay\\s+)?' +
      '(?:a\\s+|the\\s+)?(?:caption|subtitle|subtitles|sub|text|words|title)\\s*' +
      '(?:that\\s+)?(?:say(?:s|ing)?|read(?:s|ing)?|on\\s+it|:)?\\s*' +
      `(${QUOTES}[\\s\\S]*?${QUOTES}|${QUOTES}[\\s\\S]*$|[^,.]*)`,
      'i'
    ),
    (mt) => {
      if (ops.some((o) => o.type === 'caption')) return false
      const text = takePhrase(mt[1])
      if (!text) return false
      add({ type: 'caption', text })
    }
  )

  /* ------------------------------ trim ------------------------------- */

  scan(
    /\b(?:trim|cut|clip|crop)\s+(?:it\s+)?from\s+([0-9:.smhin]+)\s*(?:to|-|until|till|→)\s*([0-9:.smhin]+)/i,
    (mt) => {
      const start = toSeconds(mt[1])
      const end = toSeconds(mt[2])
      if (start === null || end === null || end <= start) return false
      add({ type: 'trim', start, end })
    }
  )
  scan(
    /\b(?:first|only\s+the\s+first|keep\s+the\s+first|take\s+the\s+first)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/i,
    (mt) => {
      const n = parseFloat(mt[1])
      const mins = /m/i.test(mt[0].slice(mt[0].lastIndexOf(mt[1]) + mt[1].length))
      if (!Number.isFinite(n)) return false
      add({ type: 'trim', start: 0, end: mins ? n * 60 : n })
    }
  )

  /* ------------------------------ crop ------------------------------- */

  scan(
    /\b(?:crop|resize|reframe|format|make\s+it|convert\s+to|to)\s*(?:it\s+)?(?:to\s+)?(9\s*[:x/]\s*16|16\s*[:x/]\s*9|1\s*[:x/]\s*1|4\s*[:x/]\s*5)\b/i,
    (mt) => add({ type: 'crop', ratio: mt[1].replace(/\s|[x/]/g, (c) => (c === 'x' || c === '/' ? ':' : '')) })
  )
  scan(/\b(?:vertical|portrait|reels?|shorts?|status\s+size)\b/i, () => {
    if (ops.some((o) => o.type === 'crop')) return false
    add({ type: 'crop', ratio: '9:16' })
  })
  scan(/\b(?:square|instagram\s+post)\b/i, () => {
    if (ops.some((o) => o.type === 'crop')) return false
    add({ type: 'crop', ratio: '1:1' })
  })
  scan(/\b(?:landscape|horizontal|youtube\s+size)\b/i, () => {
    if (ops.some((o) => o.type === 'crop')) return false
    add({ type: 'crop', ratio: '16:9' })
  })

  /* --------------------------- motion / speed ------------------------ */

  scan(/\b(?:speed\s*ramp|ramp\s+the\s+speed|slow\s+start\s*(?:then|to|→|-)?\s*fast|speed[- ]?up\s+at\s+the\s+end)\b/i,
    () => add({ type: 'speedramp' }))

  scan(/\b(?:reverse|backwards?|rewind|play\s+it\s+back(?:wards)?)\b/i, () => add({ type: 'reverse' }))

  scan(/\b(?:boomerang|boomer|ping\s?pong|loop\s+it|make\s+it\s+loop|looping)\b/i, () => add({ type: 'boomerang' }))

  scan(/\b(?:smooth(?:er)?|60\s*fps|30\s*fps|fps\s*boost|buttery)\b/i, (mt) => {
    const fps = /60/.test(mt[0]) ? 60 : 30
    add({ type: 'fps', value: fps })
  })

  scan(/\b(?:slow(?:\s*(?:it|things)?\s*down)?|slo-?mo|slow\s*motion|half\s+speed)\b/i, () => {
    if (ops.some((o) => o.type === 'speed')) return false
    add({ type: 'speed', factor: 0.5 })
  })

  scan(/\b(?:speed\s*(?:it)?\s*up|fast(?:er)?|2x|double\s+speed|hyperlapse|quick(?:er)?)\b/i, () => {
    if (ops.some((o) => o.type === 'speed')) return false
    add({ type: 'speed', factor: 2 })
  })

  scan(/\b(?:zoom(?:\s*in)?)\s*(?:at\s+the\s+|at\s+|on\s+the\s+)?(start|beginning|intro|end|finish|outro)?\b/i, (mt) => {
    if (ops.some((o) => o.type === 'zoom')) return false
    const where = /end|finish|outro/i.test(mt[1] || '') ? 'end' : 'start'
    add({ type: 'zoom', where })
  })
  scan(/\bken\s*burns\b/i, () => {
    if (ops.some((o) => o.type === 'zoom')) return false
    add({ type: 'zoom', where: 'start' })
  })

  scan(/\b(?:shake|shaky|earthquake|handheld|wobble)\b/i, () => add({ type: 'shake', intensity: 1 }))

  /* ------------------------------ audio ------------------------------ */

  scan(/\b(?:mute|no\s+(?:sound|audio)|remove\s+(?:the\s+)?(?:sound|audio)|silence|silent)\b/i,
    () => add({ type: 'mute' }))

  scan(/\b(?:keep|retain|leave|don'?t\s+remove)\s+(?:my|the|original|its)?\s*(?:audio|sound|music)\b/i,
    () => add({ type: 'keepaudio' }))

  /* -------------------------- viral presets -------------------------- */

  let viralPreset = false
  scan(/\b(?:viral|trending|trend|tiktok\s+style|make\s+it\s+pop|banger|fire|lit)\b/i, () => {
    viralPreset = true
  })

  /*
   * Vague enthusiasm ("make this insane", "do something cool", "edit it
   * nicely") is still a real request. Rather than bounce the user to the
   * help card, give them the viral punch-up - that is what they meant.
   */
  scan(
    /\b(?:insane|crazy|mad|wild|amazing|awesome|dope|sweet|beautiful|professional|pro|clean|sharp|best|better|great|perfect|nicely|properly|something|anything|magic|whatever\s+you\s+(?:think|want|like))\b/i,
    () => { viralPreset = true }
  )

  // "make it look like a movie" is cinematic, not viral
  scan(/\b(?:look\s+like\s+a\s+movie|like\s+a\s+film|movie\s+vibe|film\s+vibe|hollywood)\b/i,
    () => add({ type: 'style', name: 'cinematic' }))

  /* ---------------------------- styles ------------------------------- */

  for (const [name, words] of Object.entries(STYLES)) {
    for (const w of words) {
      scan(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i'),
        () => add({ type: 'style', name }))
    }
  }

  if (viralPreset) {
    add({ type: 'style', name: 'viral' })
    add({ type: 'zoom', where: 'start' })
    add({ type: 'fps', value: 30 })
  }

  /* --------------------------- leftovers ----------------------------- */

  const unknown = []
  let buf = ''
  for (let i = 0; i <= raw.length; i++) {
    const c = i < raw.length && !consumed[i] ? raw[i] : ' '
    if (/\s/.test(c) || i === raw.length) {
      const w = buf.replace(/[^a-z0-9'&-]/gi, '').toLowerCase()
      if (w && !FILLER.has(w) && !/^\d+$/.test(w)) unknown.push(w)
      buf = ''
    } else buf += c
  }

  const sorted = ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => (OP_ORDER[a.op.type] ?? 99) - (OP_ORDER[b.op.type] ?? 99) || a.i - b.i)
    .map((x) => x.op)

  return {
    mode: sorted.length ? 'edit' : 'help',
    ops: sorted,
    unknown: [...new Set(unknown)],
    raw
  }
}

/** ".capcut create a 2 minute video about Lagos nightlife from stock clips with voiceover" */
function parseCreate(raw) {
  const durMatch = raw.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i)
  let duration = 60
  if (durMatch) {
    const n = parseFloat(durMatch[1])
    duration = /^m/i.test(durMatch[2]) ? n * 60 : n
  }
  duration = Math.max(10, Math.min(MAX_CREATE_SECONDS, Math.round(duration)))

  let topic = ''
  const about = raw.match(/\b(?:about|on the topic of|on|for|showing|of)\s+([\s\S]+)$/i)
  if (about) topic = about[1]
  else topic = raw.replace(/^(?:create|make|generate|build|produce)\s+/i, '')

  topic = topic
    .replace(/\b(?:from|using|with)\s+(?:some\s+)?stock\s*(?:clips?|videos?|footage|images?|photos?|pics?)?/gi, ' ')
    .replace(/\b(?:with|and|plus|add)\s+(?:a\s+|my\s+)?(?:voice\s?over|voiceover|narration|narrator|voice)\b/gi, ' ')
    .replace(/\b(?:with|and|plus|add)\s+(?:captions?|subtitles?|text)\b/gi, ' ')
    .replace(/\b(?:no|without)\s+(?:captions?|subtitles?|voice\s?over|voiceover|narration)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:seconds?|secs?|minutes?|mins?)\b/gi, ' ')
    .replace(/\b(?:a|an|the|video|clip|reel|short|montage|please|pls)\b/gi, ' ')
    .replace(/[,.]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const stock = /\b(?:images?|photos?|pics?|pictures?|stills?)\b/i.test(raw) ? 'images' : 'clips'
  const wantsVoice = !/\b(?:no|without)\s+(?:voice\s?over|voiceover|narration)\b/i.test(raw)
  const wantsCaptions = /\b(?:captions?|subtitles?|text)\b/i.test(raw) &&
    !/\b(?:no|without)\s+(?:captions?|subtitles?)\b/i.test(raw)

  const ops = []
  if (wantsVoice) ops.push({ type: 'voiceover', source: 'script', text: '' })
  if (wantsCaptions) ops.push({ type: 'caption', text: '', perScene: true })
  for (const [name, words] of Object.entries(STYLES)) {
    if (words.some((w) => new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'i').test(raw))) {
      ops.push({ type: 'style', name })
      break
    }
  }

  return { mode: 'create', ops, unknown: [], topic, duration, stock, raw }
}

/* ------------------------------------------------------------------ *
 * Part 2 - pipeline builder (pure)
 * ------------------------------------------------------------------ */

const CROP_EXPR = {
  '9:16': "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'",
  '16:9': "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'",
  '1:1': "crop='min(iw,ih)':'min(iw,ih)'",
  '4:5': "crop='min(iw,ih*4/5)':'min(ih,iw*5/4)'"
}

/** Colour/look presets. Pure filter strings - no drawtext (static build). */
export const STYLE_FILTERS = {
  cinematic: "crop='min(iw,ih*2.35)':'min(ih,iw/2.35)',pad=iw:ceil(iw*9/16/2)*2:(ow-iw)/2:(oh-ih)/2:black,eq=contrast=1.12",
  vintage: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.05:saturation=0.9',
  vaporwave: 'hue=h=280:s=1.3,eq=contrast=1.05',
  bw: 'hue=s=0,eq=contrast=1.08',
  glitch: 'noise=alls=18:allf=t,rgbashift=rh=6:bh=-6',
  viral: 'eq=saturation=1.25:brightness=0.05:contrast=1.08,unsharp=5:5:0.8:5:5:0',
  warm: 'colorbalance=rs=0.12:gs=0.02:bs=-0.12,eq=saturation=1.08',
  cold: 'colorbalance=rs=-0.12:gs=0:bs=0.14,eq=saturation=1.02',
  bright: 'eq=brightness=0.12:contrast=1.05',
  dark: 'eq=brightness=-0.12:contrast=1.12'
}

/** cinematic also drops to 24fps for the film cadence. */
const STYLE_FPS = { cinematic: 24 }

/** atempo only accepts 0.5-2.0, so chain it for anything outside that. */
export function atempoChain(factor) {
  const out = []
  let f = factor
  while (f < 0.5) { out.push('atempo=0.5'); f /= 0.5 }
  while (f > 2) { out.push('atempo=2'); f /= 2 }
  if (Math.abs(f - 1) > 0.001) out.push(`atempo=${round(f)}`)
  return out
}

const round = (n) => String(Math.round(n * 1000) / 1000)

/**
 * Turn an ops list into the exact ffmpeg filter chain.
 *
 * @param {Array} ops from parseCapcutIntent
 * @param {object} opts
 * @param {number} opts.duration  source duration in seconds (for ramps/zoom)
 * @param {boolean} opts.hasAudio source has an audio stream
 * @param {number} opts.voiceDuration length of the synthesized voiceover, if any
 *   (a voice longer than the clip holds the last frame instead of being cut off)
 * @returns {{vf:string, af:string, filterComplex:string|null, pre:string[],
 *            post:string[], maps:string[], caption:object|null, voice:object|null,
 *            mute:boolean, durationWanted:number|null, inputs:string[]}}
 */
export function buildCapcutPipeline(ops = [], opts = {}) {
  const {
    duration = 10,
    hasAudio = true,
    durationWanted = null,
    voiceDuration = 0,
    width = OUT_W,
    height = OUT_H
  } = opts

  const ordered = [...ops]
    .map((op, i) => ({ op, i }))
    .sort((a, b) => (OP_ORDER[a.op.type] ?? 99) - (OP_ORDER[b.op.type] ?? 99) || a.i - b.i)
    .map((x) => x.op)

  const vf = []
  const af = []
  const pre = []
  let fps = OUT_FPS
  let speed = 1
  let reverse = false
  let boomerang = false
  let mute = false
  let keepAudio = false
  let caption = null
  let voice = null
  let workDuration = duration

  // always normalise the frame first: <=720p, even dimensions
  vf.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`)

  for (const op of ordered) {
    switch (op.type) {
      case 'trim': {
        const start = Math.max(0, op.start || 0)
        const end = Math.min(op.end ?? duration, start + MAX_EDIT_SECONDS)
        pre.push('-ss', round(start), '-to', round(end))
        workDuration = Math.max(0.1, end - start)
        break
      }
      case 'crop':
        vf.push(CROP_EXPR[op.ratio] || CROP_EXPR['9:16'])
        break
      case 'speed':
        speed = op.factor || 1
        break
      case 'reverse':
        reverse = true
        break
      case 'boomerang':
        boomerang = true
        break
      case 'fps':
        fps = op.value || OUT_FPS
        break
      case 'speedramp': {
        // out_t = in_t * (1.6 - 0.8*in_t/D): starts 1.6x slow, accelerates to fast
        const d = round(Math.max(1, workDuration))
        vf.push(`setpts='(1.6-0.8*T/${d})*PTS'`)
        af.push(`atempo=1.25`)
        workDuration *= 1.2
        break
      }
      case 'style': {
        const f = STYLE_FILTERS[op.name]
        if (f) vf.push(f)
        if (STYLE_FPS[op.name]) fps = STYLE_FPS[op.name]
        break
      }
      case 'zoom': {
        const frames = Math.max(15, Math.round(Math.min(workDuration, 3) * fps))
        vf.push(
          op.where === 'end'
            ? `zoompan=z='if(gte(on,${frames}),min(1.0+0.006*(on-${frames}),1.25),1.0)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`
            : `zoompan=z='if(lte(on,${frames}),1.25-0.25*on/${frames},1.0)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`
        )
        break
      }
      case 'shake': {
        const a = 6 * (op.intensity || 1)
        vf.push(
          `crop=iw-${a * 2}:ih-${a * 2}:x='${a}+${a}*sin(n*0.7)':y='${a}+${a}*cos(n*1.1)'`
        )
        break
      }
      case 'caption':
        caption = { text: op.text || '', perScene: !!op.perScene }
        break
      case 'mute':
        mute = true
        break
      case 'keepaudio':
        keepAudio = true
        break
      case 'voiceover':
        voice = { source: op.source || 'text', text: op.text || '' }
        break
      default:
        break
    }
  }

  // speed / reverse / boomerang are applied after the look so filters see
  // the final frame rate
  if (reverse) {
    vf.push('reverse')
    af.push('areverse')
  }
  if (speed !== 1) {
    vf.push(`setpts=${round(1 / speed)}*PTS`)
    af.push(...atempoChain(speed))
    workDuration /= speed
  }
  if (boomerang) {
    workDuration *= 2
    mute = mute || !voice
  }

  vf.push(`fps=${fps}`)
  // even dimensions again - crop/pad expressions can land on odd numbers
  vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2')

  // voiceover replaces the original track unless the user asked to keep it
  const keepOriginal = voice ? (keepAudio || !mute) : !mute

  /*
   * A voiceover longer than the clip would simply be chopped off by
   * -shortest, which sounds broken ("Welcome back to the ch-"). Hold the
   * last frame instead so every word is heard.
   */
  const holdFrames = voice && voiceDuration > workDuration + 0.15
  if (holdFrames) vf.push(`tpad=stop_mode=clone:stop_duration=${round(voiceDuration - workDuration + 0.3)}`)
  const playDuration = holdFrames ? voiceDuration + 0.3 : workDuration
  const cap = durationWanted || Math.min(playDuration, MAX_EDIT_SECONDS)

  return {
    vf: vf.join(','),
    af: af.join(','),
    pre,
    post: [...H264, ...(mute && !voice ? ['-an'] : AAC)],
    fps,
    speed,
    reverse,
    boomerang,
    mute,
    keepAudio,
    keepOriginal: !!(voice && keepOriginal && hasAudio && !mute),
    caption,
    voice,
    hasAudio,
    holdFrames,
    duration: Math.round(playDuration * 1000) / 1000,
    sourceDuration: Math.round(workDuration * 1000) / 1000,
    durationCap: Math.round(cap * 1000) / 1000,
    ops: ordered
  }
}

/**
 * Assemble the full ffmpeg argument list for an edit job.
 * Input order is fixed and therefore snapshot-testable:
 *   0 = source video, 1 = caption PNG (if any), 2 = voiceover audio (if any)
 */
export function pipelineToArgs(pipeline, { input, captionPng = null, voiceAudio = null, output }) {
  const args = ['-y']
  args.push(...pipeline.pre, '-i', input)
  let idx = 0
  const vIn = `${idx}:v`
  let captionIdx = null
  let voiceIdx = null
  if (captionPng) { captionIdx = ++idx; args.push('-i', captionPng) }
  if (voiceAudio) { voiceIdx = ++idx; args.push('-i', voiceAudio) }

  const chains = []
  const boom = pipeline.boomerang

  if (boom) {
    chains.push(`[${vIn}]${pipeline.vf},split[bf][bb]`)
    chains.push('[bb]reverse[br]')
    chains.push('[bf][br]concat=n=2:v=1:a=0[vbase]')
  } else {
    chains.push(`[${vIn}]${pipeline.vf}[vbase]`)
  }

  let vLabel = '[vbase]'
  if (captionIdx !== null) {
    chains.push(`${vLabel}[${captionIdx}:v]overlay=(W-w)/2:H-h-40:format=auto[vout]`)
    vLabel = '[vout]'
  }

  const maps = ['-map', vLabel]
  const useOriginalAudio = pipeline.hasAudio && !pipeline.mute && !boom

  if (voiceIdx !== null) {
    const voiceChain = `[${voiceIdx}:a]aresample=44100,volume=1.0[vo]`
    if (pipeline.keepOriginal && useOriginalAudio) {
      const bg = pipeline.af ? `[0:a]${pipeline.af},volume=0.2[bg]` : '[0:a]volume=0.2[bg]'
      chains.push(bg, voiceChain, '[bg][vo]amix=inputs=2:duration=longest:dropout_transition=0,dynaudnorm=p=0.9[aout]')
    } else {
      chains.push(voiceChain, '[vo]anull[aout]')
    }
    maps.push('-map', '[aout]')
  } else if (useOriginalAudio) {
    if (pipeline.af) {
      chains.push(`[0:a]${pipeline.af}[aout]`)
      maps.push('-map', '[aout]')
    } else {
      maps.push('-map', '0:a?')
    }
  }

  args.push('-filter_complex', chains.join(';'), ...maps)
  if (voiceIdx !== null || boom) args.push('-shortest')
  args.push('-t', String(Math.min(pipeline.durationCap || MAX_EDIT_SECONDS, MAX_EDIT_SECONDS)))
  args.push(...pipeline.post, output)
  return args
}

/* ------------------------------------------------------------------ *
 * Caption strips - sharp/SVG, because this ffmpeg has no drawtext
 * ------------------------------------------------------------------ */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** Greedy word wrap sized for the SVG font metrics. */
export function wrapCaption(text, maxChars = 28) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if ([...next].length > maxChars && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}

/** Build the caption SVG (exported so tests can assert escaping offline). */
export function captionSvg(text, { width = OUT_W, fontSize = 46, theme = 'dark' } = {}) {
  const maxChars = Math.max(12, Math.floor((width * 0.92) / (fontSize * 0.55)))
  const lines = wrapCaption(text, maxChars)
  const lh = Math.round(fontSize * 1.32)
  const padY = Math.round(fontSize * 0.55)
  const height = lines.length * lh + padY * 2
  const bg = theme === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(8,10,14,0.72)'
  const fg = theme === 'light' ? '#0b0d12' : '#ffffff'
  const body = lines
    .map(
      (l, i) =>
        `<text x="${width / 2}" y="${padY + lh * (i + 1) - Math.round(lh * 0.28)}" ` +
        `font-family="'DejaVu Sans','Noto Color Emoji','Liberation Sans',sans-serif" ` +
        `font-size="${fontSize}" font-weight="bold" fill="${fg}" text-anchor="middle" ` +
        `stroke="rgba(0,0,0,0.55)" stroke-width="2" paint-order="stroke">${esc(l)}</text>`
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(fontSize * 0.4)}" fill="${bg}"/>` +
    `${body}</svg>`
}

/** Render a caption strip to a PNG buffer. */
export async function renderCaptionStrip(text, options = {}) {
  const svg = captionSvg(text, options)
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/* ------------------------------------------------------------------ *
 * TTS - keyless Google Translate, chunked and concatenated
 * ------------------------------------------------------------------ */

/**
 * Split narration into <=200 char requests without cutting words.
 * Sentence boundaries first, then words for anything still too long.
 */
export function ttsChunks(text, limit = TTS_CHUNK) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean]
  const out = []
  let buf = ''
  const push = () => { if (buf.trim()) out.push(buf.trim()); buf = '' }

  for (const raw of sentences) {
    const s = raw.trim()
    if (!s) continue
    if (s.length > limit) {
      push()
      let line = ''
      for (const w of s.split(' ')) {
        if ((line + ' ' + w).trim().length > limit) {
          if (line) out.push(line.trim())
          line = ''
          // a single word longer than the cap still has to be spoken in full
          let rest = w
          while (rest.length > limit) {
            out.push(rest.slice(0, limit))
            rest = rest.slice(limit)
          }
          line = rest
        } else line = (line ? line + ' ' : '') + w
      }
      if (line) out.push(line.trim())
      continue
    }
    if ((buf + ' ' + s).trim().length > limit) push()
    buf = (buf ? buf + ' ' : '') + s
  }
  push()
  return out
}

/** Google Translate TTS endpoint for one chunk (no key required). */
export const ttsUrl = (chunk, lang = 'en') =>
  `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}`

/* ------------------------------------------------------------------ *
 * Scene planning for create mode (pure)
 * ------------------------------------------------------------------ */

/** Ken Burns move used for scene i - cycles so nothing feels static. */
export const kenBurns = (i, { width = OUT_W, height = OUT_H, fps = OUT_FPS, seconds = 6 } = {}) => {
  const frames = Math.max(2, Math.round(seconds * fps))
  const s = `s=${width}x${height}:fps=${fps}:d=${frames}`
  switch (i % 4) {
    case 0: // slow zoom in
      return `zoompan=z='min(1.0+0.0016*on,1.28)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${s}`
    case 1: // zoom out
      return `zoompan=z='max(1.28-0.0016*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${s}`
    case 2: // pan right
      return `zoompan=z=1.18:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':${s}`
    default: // pan left
      return `zoompan=z=1.18:x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':${s}`
  }
}

/**
 * Turn narration lines (+ measured audio lengths) into a scene plan.
 * Scene duration follows the voice so picture and narration stay locked.
 */
export function planScenes(lines, { durations = [], fallback = 6, keywordOf } = {}) {
  return lines
    .map((line, i) => String(line || '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const d = Number.isFinite(durations[i]) && durations[i] > 0.4 ? durations[i] : fallback
      return {
        index: i,
        line,
        keyword: (keywordOf ? keywordOf(line, i) : sceneKeyword(line)),
        duration: Math.round(Math.min(20, Math.max(2, d + 0.35)) * 1000) / 1000,
        motion: kenBurns(i, { seconds: Math.max(2, d + 0.35) })
      }
    })
}

const STOP_KEYWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it',
  'its', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'his', 'her', 'as', 'by',
  'not', 'no', 'so', 'if', 'when', 'where', 'how', 'what', 'why', 'who', 'all', 'more', 'most',
  'every', 'each', 'here', 'there', 'then', 'than', 'into', 'over', 'under', 'about', 'after',
  'before', 'just', 'like', 'can', 'will', 'one', 'two', 'now', 'out', 'up', 'down', 'has', 'have'
])

/** Pick 2 meaty words from a narration line to drive the stock search. */
export function sceneKeyword(line, topic = '') {
  const words = String(line || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_KEYWORDS.has(w))
  const pick = words.slice(0, 2).join(' ')
  return (pick || topic || 'city').trim()
}

/* ------------------------------------------------------------------ *
 * tmp workspace - nothing is ever left behind
 * ------------------------------------------------------------------ */

export class Workspace {
  constructor(dir = config.tmpDir) {
    this.dir = path.join(dir, `capcut-${crypto.randomBytes(6).toString('hex')}`)
    fs.mkdirSync(this.dir, { recursive: true })
    this.files = []
  }

  /** Reserve a path inside the workspace. */
  file(ext, name) {
    const p = path.join(this.dir, `${name || crypto.randomBytes(6).toString('hex')}.${ext}`)
    this.files.push(p)
    return p
  }

  write(ext, buffer, name) {
    const p = this.file(ext, name)
    fs.writeFileSync(p, buffer)
    return p
  }

  /** Remove every tmp file this job created. Never throws. */
  cleanup() {
    try {
      fs.rmSync(this.dir, { recursive: true, force: true })
    } catch {}
  }
}

/* ------------------------------------------------------------------ *
 * ffmpeg execution helpers
 * ------------------------------------------------------------------ */

/** Run ffmpeg, resolving with its stderr (needed for probing). */
export function runFfmpeg(args, timeout = JOB_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args)
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('That edit took too long - try a shorter clip.'))
    }, timeout)
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(err)
      else reject(new Error(err.split('\n').filter(Boolean).slice(-4).join('\n') || `ffmpeg exited ${code}`))
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/** Duration + audio presence of a media file (ffprobe is not bundled). */
export async function probe(file) {
  let out = ''
  try {
    out = await runFfmpeg(['-hide_banner', '-i', file, '-f', 'null', '-'], 60_000)
  } catch (e) {
    out = e.message || ''
  }
  const d = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0
  return {
    duration,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(out),
    hasVideo: /Stream #\d+:\d+.*: Video:/.test(out)
  }
}

/** Concatenate media files of identical format with the concat demuxer. */
export async function concatFiles(files, output, ws, { reencode = false } = {}) {
  const list = ws.file('txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', list]
  if (reencode) args.push(...H264, ...AAC)
  else args.push('-c', 'copy')
  args.push(output)
  await runFfmpeg(args)
  return output
}

/* ------------------------------------------------------------------ *
 * Speech synthesis (injectable fetcher keeps tests offline)
 * ------------------------------------------------------------------ */

/**
 * Speak `text` into one mp3 file.
 *
 * @param {string} text
 * @param {object} deps
 * @param {(url:string)=>Promise<Buffer>} deps.fetchAudio  network fetcher (stubbed in tests)
 * @param {Workspace} deps.ws
 * @param {string} [deps.lang]
 * @returns {Promise<{file:string, duration:number}>}
 */
export async function synthesizeSpeech(text, { fetchAudio, ws, lang = 'en' }) {
  const chunks = ttsChunks(text)
  if (!chunks.length) throw new Error('Nothing to say in that voiceover.')

  const parts = []
  for (const chunk of chunks) {
    let raw
    try {
      raw = await fetchAudio(ttsUrl(chunk, lang))
    } catch (e) {
      // never surface a raw socket/DNS error to a WhatsApp user
      throw new Error('The voice service is unreachable right now - try again in a minute.')
    }
    if (!raw || raw.length < 512) throw new Error('The voice service returned nothing usable.')
    // normalise every chunk so the concat demuxer accepts them
    const src = ws.write('mp3', raw)
    const norm = ws.file('mp3')
    await runFfmpeg(['-y', '-i', src, '-ar', '44100', '-ac', '2', '-b:a', '128k', norm], 120_000)
    parts.push(norm)
  }

  const out = ws.file('mp3')
  if (parts.length === 1) fs.copyFileSync(parts[0], out)
  else await concatFiles(parts, out, ws)
  const { duration } = await probe(out)
  return { file: out, duration }
}

/* ------------------------------------------------------------------ *
 * Part 3 - create mode assembler
 * ------------------------------------------------------------------ */

/** How many scenes fit a requested runtime (about 7s of narration each). */
export const sceneCount = (seconds) => Math.max(3, Math.min(24, Math.round(seconds / 7)))

/** Keyless stock image URL (same source as .img). */
export const stockImageUrl = (keyword, i = 0) =>
  `https://loremflickr.com/1280/720/${encodeURIComponent(String(keyword).trim().replace(/\s+/g, ','))}?lock=${1000 + i}`

/**
 * Build one scene segment: still (or clip) + Ken Burns + optional caption,
 * muxed against its narration audio so the cut lands on the voice.
 */
export async function renderScene(scene, { ws, imageFile, videoFile, audioFile, caption = false, style = null }) {
  const out = ws.file('mp4')
  const args = ['-y']
  const chains = []

  if (videoFile) {
    args.push('-stream_loop', '-1', '-i', videoFile)
    chains.push(
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},fps=${OUT_FPS}` +
      `${style ? ',' + style : ''}[vbase]`
    )
  } else {
    args.push('-loop', '1', '-i', imageFile)
    chains.push(
      `[0:v]scale=${OUT_W * 2}:${OUT_H * 2}:force_original_aspect_ratio=increase,crop=${OUT_W * 2}:${OUT_H * 2},` +
      `${scene.motion}${style ? ',' + style : ''},format=yuv420p[vbase]`
    )
  }

  let vLabel = '[vbase]'
  let idx = 0
  if (caption) {
    idx++
    args.push('-i', caption)
    chains.push(`${vLabel}[${idx}:v]overlay=(W-w)/2:H-h-48:format=auto[vcap]`)
    vLabel = '[vcap]'
  }

  if (audioFile) {
    idx++
    args.push('-i', audioFile)
    chains.push(`[${idx}:a]aresample=44100,apad[aout]`)
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    idx++
    chains.push(`[${idx}:a]anull[aout]`)
  }

  args.push(
    '-filter_complex', chains.join(';'),
    '-map', vLabel, '-map', '[aout]',
    '-t', String(scene.duration),
    ...H264, ...AAC,
    out
  )
  await runFfmpeg(args)
  return out
}

/** Last-resort scene background when every stock source is unreachable. */
async function solidCard(ws, i) {
  const hues = [
    ['#141e30', '#243b55'], ['#0f2027', '#2c5364'], ['#42275a', '#734b6d'],
    ['#232526', '#414345'], ['#1f1c2c', '#928dab'], ['#16222a', '#3a6073']
  ]
  const [a, b] = hues[i % hues.length]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>` +
    `</linearGradient></defs><rect width="${OUT_W}" height="${OUT_H}" fill="url(#g)"/></svg>`
  return ws.write('jpg', await sharp(Buffer.from(svg)).jpeg().toBuffer())
}

/**
 * Full create-mode assembly.
 *
 * Every side effect is injected, so test/capcut-test.mjs runs it end to end
 * offline with stub fetchers and still produces a real playable MP4.
 *
 * @param {object} spec  { topic, duration, stock, wantsVoice, wantsCaptions, style }
 * @param {object} deps  { writeScript, fetchImage, fetchVideo, speak, ws, onProgress }
 */
export async function renderCreate(spec, deps) {
  const {
    topic = 'a short film',
    duration = 60,
    wantsVoice = true,
    wantsCaptions = false,
    style = null
  } = spec
  const { writeScript, fetchImage, fetchVideo = null, speak, ws, onProgress = () => {} } = deps

  const wanted = sceneCount(duration)
  const lines = (await writeScript(topic, wanted)).filter(Boolean).slice(0, wanted)
  if (!lines.length) throw new Error('The script writer came back empty - try a clearer topic.')

  onProgress({ stage: 'script', scenes: lines.length })

  // 1. voice first: the narration length defines each scene's duration
  const voices = []
  for (const line of lines) {
    if (!wantsVoice) { voices.push(null); continue }
    try {
      voices.push(await speak(line))
    } catch {
      voices.push(null)
    }
  }
  onProgress({ stage: 'voice', scenes: lines.length })

  const scenes = planScenes(lines, {
    durations: voices.map((v) => v?.duration || 0),
    fallback: Math.max(3, Math.min(9, duration / lines.length)),
    keywordOf: (line) => sceneKeyword(line, topic)
  })

  // 2. media + render per scene
  const segments = []
  for (const scene of scenes) {
    let videoFile = null
    let imageFile = null
    if (fetchVideo) {
      try { videoFile = await fetchVideo(scene.keyword, scene.index) } catch {}
    }
    if (!videoFile) {
      try {
        imageFile = await fetchImage(scene.keyword, scene.index)
      } catch {
        // one dead stock request must not kill a 20-scene render - retry on
        // the broader topic, then fall back to a plain gradient card
        try {
          imageFile = await fetchImage(topic, scene.index)
        } catch {
          imageFile = await solidCard(ws, scene.index)
        }
      }
    }
    const capPng = wantsCaptions
      ? ws.write('png', await renderCaptionStrip(scene.line, { width: OUT_W, fontSize: 40 }))
      : null
    segments.push(
      await renderScene(scene, {
        ws,
        imageFile,
        videoFile,
        audioFile: voices[scene.index]?.file || null,
        caption: capPng,
        style
      })
    )
    onProgress({ stage: 'scene', index: scene.index + 1, total: scenes.length })
  }

  // 3. stitch
  const out = ws.file('mp4')
  if (segments.length === 1) fs.copyFileSync(segments[0], out)
  else await concatFiles(segments, out, ws, { reencode: true })
  onProgress({ stage: 'done', scenes: scenes.length })

  return { file: out, scenes }
}

export default {
  parseCapcutIntent,
  buildCapcutPipeline,
  pipelineToArgs,
  renderCaptionStrip,
  captionSvg,
  wrapCaption,
  ttsChunks,
  ttsUrl,
  synthesizeSpeech,
  planScenes,
  sceneKeyword,
  kenBurns,
  sceneCount,
  stockImageUrl,
  renderScene,
  renderCreate,
  concatFiles,
  probe,
  runFfmpeg,
  Workspace,
  STYLE_FILTERS,
  STYLES,
  OP_ORDER,
  H264,
  AAC,
  MAX_INPUT_MB
}
