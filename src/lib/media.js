import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileTypeFromBuffer } from 'file-type'
import webp from 'node-webpmux'
import config from '../config.js'

/** Bundled ffmpeg binary - works on Pterodactyl with no system install. */
export const FFMPEG = ffmpegPath

const tmp = (ext) => {
  if (!fs.existsSync(config.tmpDir)) fs.mkdirSync(config.tmpDir, { recursive: true })
  return path.join(config.tmpDir, `${crypto.randomBytes(8).toString('hex')}.${ext}`)
}

/** Run ffmpeg with args, resolving when it exits cleanly. */
export function ffmpeg(args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args)
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffmpeg timed out'))
    }, timeout)
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(err.split('\n').slice(-6).join('\n') || `ffmpeg exited ${code}`))
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/** Convert a buffer through ffmpeg. */
export async function convert(buffer, inExt, outExt, args = []) {
  const input = tmp(inExt)
  const output = tmp(outExt)
  fs.writeFileSync(input, buffer)
  try {
    await ffmpeg(['-y', '-i', input, ...args, output])
    return fs.readFileSync(output)
  } finally {
    for (const f of [input, output]) fs.existsSync(f) && fs.unlinkSync(f)
  }
}

/** Detect extension from buffer contents. */
export async function extOf(buffer, fallback = 'bin') {
  const t = await fileTypeFromBuffer(buffer).catch(() => null)
  return t?.ext || fallback
}

/* ------------------------------ stickers ------------------------------ */

/**
 * Image/video -> WhatsApp sticker (512x512 webp, transparent padding).
 * @param {Buffer} buffer source media
 * @param {boolean} animated true for video/gif sources
 * @param {boolean} crop fill the square instead of letterboxing
 */
export async function toSticker(buffer, { animated = false, crop = false } = {}) {
  const inExt = await extOf(buffer, animated ? 'mp4' : 'jpg')
  const scale = crop
    ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
    : 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:-1:-1:color=#00000000'

  const args = animated
    ? ['-vcodec', 'libwebp', '-vf', `${scale},fps=15`, '-loop', '0', '-ss', '0', '-t', '8',
       '-preset', 'default', '-an', '-vsync', '0', '-s', '512:512']
    : ['-vcodec', 'libwebp', '-vf', scale, '-lossless', '1', '-preset', 'default', '-an', '-vsync', '0']

  return convert(buffer, inExt, 'webp', args)
}

/** Embed pack/author metadata (EXIF) into a webp sticker. */
export async function addExif(webpBuffer, packname = '', author = '') {
  const img = new webp.Image()
  await img.load(webpBuffer)

  const json = {
    'sticker-pack-id': 'com.venom.md.bot',
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    emojis: ['🔥']
  }
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
                            0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00])
  const payload = Buffer.from(JSON.stringify(json), 'utf-8')
  const exif = Buffer.concat([head, payload])
  exif.writeUIntLE(payload.length, 14, 4)

  img.exif = exif
  return img.save(null)
}

/** Sticker (webp) -> PNG image. */
export const stickerToImage = (buffer) => convert(buffer, 'webp', 'png')

/** Animated sticker -> mp4 video. */
export const stickerToVideo = (buffer) =>
  convert(buffer, 'webp', 'mp4', [
    '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  ])

/* ------------------------------- audio ------------------------------- */

/** Any audio/video -> WhatsApp voice note (opus/ogg). */
export const toPTT = (buffer, inExt = 'mp4') =>
  convert(buffer, inExt, 'ogg', ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '1'])

/** Any audio/video -> mp3. */
export const toMp3 = (buffer, inExt = 'mp4') =>
  convert(buffer, inExt, 'mp3', ['-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k'])

/** Named audio filter presets used by the CONVERTER menu. */
export const AUDIO_FX = {
  bass: ['-af', 'equalizer=f=54:width_type=o:width=2:g=20'],
  blown: ['-af', 'acrusher=.1:1:64:0:log'],
  deep: ['-af', 'atempo=4/4,asetrate=44100*0.8'],
  earrape: ['-af', 'volume=12'],
  fast: ['-filter:a', 'atempo=1.63,asetrate=44100'],
  fat: ['-filter:a', 'atempo=1.6,asetrate=22100'],
  nightcore: ['-filter:a', 'atempo=1.06,asetrate=44100*1.25'],
  reverse: ['-filter_complex', 'areverse'],
  robot: ['-filter_complex', 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75'],
  slow: ['-filter:a', 'atempo=0.7,asetrate=44100'],
  smooth: ['-filter:v', 'minterpolate=\'mi_mode=mci\''],
  squirrel: ['-filter:a', 'atempo=0.57,asetrate=65100'],
  chipmunk: ['-filter:a', 'atempo=0.5,asetrate=65100'],
  tremolo: ['-af', 'tremolo=f=8:d=0.8'],
  vibrato: ['-af', 'vibrato=f=8:d=0.8'],
  '8d': ['-af', 'apulsator=hz=0.09'],
  echo: ['-af', 'aecho=0.8:0.9:1000:0.3'],
  flanger: ['-af', 'flanger']
}

export const applyAudioFx = (buffer, fx, inExt = 'mp3') => {
  const args = AUDIO_FX[fx]
  if (!args) throw new Error(`Unknown audio effect: ${fx}`)
  return convert(buffer, inExt, 'mp3', args)
}

/* ------------------------------- video ------------------------------- */

/** Video -> WhatsApp "PTV" round video note. */
export const toPTV = (buffer) =>
  convert(buffer, 'mp4', 'mp4', [
    '-vf', 'scale=480:480:force_original_aspect_ratio=increase,crop=480:480',
    '-c:v', 'libx264', '-preset', 'fast', '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-t', '60'
  ])

/** Grab a still frame from a video. */
export const videoThumb = (buffer) =>
  convert(buffer, 'mp4', 'jpg', ['-ss', '00:00:01', '-vframes', '1'])

export default {
  ffmpeg, convert, toSticker, addExif, stickerToImage, stickerToVideo,
  toPTT, toMp3, applyAudioFx, AUDIO_FX, toPTV, videoThumb, extOf, FFMPEG
}
