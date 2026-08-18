import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import config from '../config.js'
import { ffmpeg, convert, toPTT, extOf } from './media.js'

/**
 * Voice clone / voice match.
 *
 * A true neural clone (XTTS) needs a GPU or a paid key. What we ship is the
 * part that actually works on a free host:
 *   1. read the sample's pitch / brightness / loudness with ffmpeg
 *   2. speak the text with keyless Google TTS
 *   3. retune that speech so it sits in the same range as the sample
 *
 * The result is the same words, in a voice that tracks the person you
 * replied to — not a generic robot, not a stolen ElevenLabs bill.
 */

const tmp = (ext) => {
  if (!fs.existsSync(config.tmpDir)) fs.mkdirSync(config.tmpDir, { recursive: true })
  return path.join(config.tmpDir, `${crypto.randomBytes(8).toString('hex')}.${ext}`)
}

const rm = (f) => {
  try { if (f && fs.existsSync(f)) fs.unlinkSync(f) } catch { /* ignore */ }
}

const ttsUrl = (text, lang = 'en') =>
  `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`

export function detectLang(text) {
  const t = String(text || '')
  if (/[àáâãèéêìíòóôõùúçñ]/i.test(t) && /\b(el|la|que|por|una)\b/i.test(t)) return 'es'
  if (/[àâçéèêëïîôùû]/i.test(t)) return 'fr'
  if (/[\u0600-\u06FF]/.test(t)) return 'ar'
  if (/[\u0900-\u097F]/.test(t)) return 'hi'
  if (/[àèéìòù]/i.test(t) && /\b(il|che|per|non)\b/i.test(t)) return 'it'
  if (/[äöüß]/i.test(t)) return 'de'
  if (/\b(na|wan|oya|jollof|abeg|sha)\b/i.test(t)) return 'en'
  return 'en'
}

async function bandMean(file, highpass, lowpass) {
  const args = ['-hide_banner', '-i', file, '-af']
  const filters = []
  if (highpass) filters.push(`highpass=f=${highpass}`)
  if (lowpass) filters.push(`lowpass=f=${lowpass}`)
  filters.push('volumedetect')
  args.push(filters.join(',') || 'volumedetect', '-f', 'null', '-')
  const { spawn } = await import('child_process')
  const FFMPEG = (await import('./media.js')).FFMPEG
  const err = await new Promise((resolve) => {
    const proc = spawn(FFMPEG, args)
    let s = ''
    proc.stderr.on('data', (d) => (s += d.toString()))
    proc.on('close', () => resolve(s))
    proc.on('error', () => resolve(''))
    setTimeout(() => { try { proc.kill('SIGKILL') } catch {} resolve(s) }, 20_000)
  })
  const mean = err.match(/mean_volume:\s*(-?[\d.]+)/)?.[1]
  return mean != null ? Number(mean) : null
}

export async function analyzeVoice(buffer) {
  const inExt = await extOf(buffer, 'ogg')
  const file = tmp(inExt)
  fs.writeFileSync(file, buffer)
  try {
    const low = await bandMean(file, 80, 300)
    const high = await bandMean(file, 1800, 5000)
    const full = await bandMean(file, 0, 0)
    const brightness = low == null || high == null ? 1 : Math.max(0.35, Math.min(2.4, (high + 60) / Math.max(1, low + 60)))
    // deeper sample → lower speech; brighter sample → higher speech
    let pitchRatio = 1
    if (brightness < 0.7) pitchRatio = 0.84
    else if (brightness < 0.9) pitchRatio = 0.92
    else if (brightness > 1.6) pitchRatio = 1.18
    else if (brightness > 1.25) pitchRatio = 1.08
    return {
      pitchRatio,
      brightness: Number(brightness.toFixed(3)),
      rms: full,
      tempo: 1
    }
  } finally {
    rm(file)
  }
}

async function fetchAudio(url, headers = {}) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 25_000,
    headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
    validateStatus: (s) => s >= 200 && s < 400
  })
  const buf = Buffer.from(data)
  if (buf.length < 400) throw new Error('empty')
  const head = buf.subarray(0, 80).toString('utf8').toLowerCase()
  if (head.includes('<html') || head.includes('<!doctype')) throw new Error('html')
  return buf
}

/** Speak one short phrase. Google first (best quality), then StreamElements. */
async function speakChunk(part, lang = 'en') {
  const errors = []
  try {
    return await fetchAudio(ttsUrl(part, lang), { Referer: 'https://translate.google.com/' })
  } catch (e) {
    errors.push(`google:${e.message}`)
  }
  try {
    return await fetchAudio(
      `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(part)}`
    )
  } catch (e) {
    errors.push(`se:${e.message}`)
  }
  throw new Error(`voice service unreachable (${errors.join(', ')})`)
}

async function speakGoogle(text, lang = 'en') {
  const parts = String(text).match(/.{1,180}(\s|$)/g) || [text]
  const chunks = []
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    chunks.push(await speakChunk(part, lang))
  }
  if (!chunks.length) throw new Error('Nothing to say.')
  if (chunks.length === 1) return chunks[0]
  const files = chunks.map((b, i) => {
    const f = tmp(`p${i}.mp3`)
    fs.writeFileSync(f, b)
    return f
  })
  const list = tmp('list.txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
  const out = tmp('join.mp3')
  try {
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out])
    return fs.readFileSync(out)
  } finally {
    rm(list)
    rm(out)
    files.forEach(rm)
  }
}

export async function shapeSpeech(ttsBuffer, profile) {
  const ratio = Math.max(0.7, Math.min(1.35, Number(profile?.pitchRatio) || 1))
  const tempo = Math.max(0.85, Math.min(1.2, Number(profile?.tempo) || 1))
  const atempo = Math.max(0.5, Math.min(2, tempo / ratio))
  const bright = Number(profile?.brightness) || 1
  const eq = bright > 1.2 ? 'equalizer=f=3200:width_type=o:width=1.4:g=4' : bright < 0.8 ? 'equalizer=f=180:width_type=o:width=1.2:g=5' : 'anull'
  const af = `asetrate=44100*${ratio.toFixed(3)},aresample=44100,atempo=${atempo.toFixed(3)},${eq},acompressor=threshold=-18dB:ratio=3:attack=20:release=200`
  return convert(ttsBuffer, 'mp3', 'mp3', ['-af', af])
}

/**
 * @param {Buffer} sample voice note
 * @param {string} text
 * @param {{lang?:string, profile?:object}} [opts]
 */
export async function cloneSpeak(sample, text, opts = {}) {
  const body = String(text || '').trim()
  if (!body) throw new Error('Give me the words to speak.')
  if (body.length > 500) throw new Error('Keep it under 500 characters.')
  const lang = opts.lang || detectLang(body)
  const profile = opts.profile || (sample ? await analyzeVoice(sample) : { pitchRatio: 1, tempo: 1, brightness: 1 })
  const spoken = await speakGoogle(body, lang)
  const shaped = await shapeSpeech(spoken, profile)
  const ptt = await toPTT(shaped, 'mp3')
  return { audio: ptt, profile, lang }
}

export async function speakPlain(text, { lang, ptt = true } = {}) {
  const body = String(text || '').trim()
  if (!body) throw new Error('Give me the words to speak.')
  if (body.length > 500) throw new Error('Keep it under 500 characters.')
  const tl = lang || detectLang(body)
  const spoken = await speakGoogle(body, tl)
  if (!ptt) return { audio: spoken, lang: tl }
  return { audio: await toPTT(spoken, 'mp3'), lang: tl }
}

export default { analyzeVoice, cloneSpeak, speakPlain, detectLang, shapeSpeech }
