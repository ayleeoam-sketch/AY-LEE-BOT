/**
 * Image restyling / re-posing - turn a photo into different styles & poses.
 *
 *   .restyle anime     -> same photo, anime style
 *   .restyle peace     -> same person, peace-sign pose
 *   .restyle make me a medieval knight  -> free-form edit instruction
 *
 * Engines (auto failover):
 *   1. Gemini image editing (gemini-2.5-flash-image) when GEMINI_API_KEY is
 *      set - the image goes straight to Google, nothing is uploaded anywhere
 *      else, and the edit quality is the best available.
 *   2. Pollinations kontext (keyless) - the image is temporarily uploaded to
 *      catbox.moe because their free tier needs a public URL.
 *
 * Safety: nudity / undressing / sexual edits are refused outright, before
 * any request is made. Gemini's own filters are a second layer.
 */
import { http } from './api.js'
import { getKey } from './ai.js'
import { extOf, convert } from './media.js'
import FormData from 'form-data'

/* Base URLs overridable so tests never touch the real internet. */
const GEMINI_BASE = process.env.RESTYLE_GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MODEL = 'gemini-2.5-flash-image'
const POLLINATIONS_BASE = process.env.RESTYLE_POLLINATIONS_BASE || 'https://image.pollinations.ai'
const CATBOX_BASE = process.env.RESTYLE_CATBOX_BASE || 'https://catbox.moe/user/api.php'

/** Largest image we send upstream - bigger ones are downscaled first. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024

/* ------------------------------ presets ------------------------------ */

export const STYLES = {
  anime: 'Recreate this image in high-quality anime style. Same person, same scene, same composition, expressive anime eyes and clean cel shading.',
  cartoon: 'Recreate this image as a colorful 3D cartoon. Same person and scene, rounded Pixar-like shapes, bright cheerful lighting.',
  sketch: 'Recreate this image as a detailed pencil sketch drawing on white paper. Same subject and composition.',
  painting: 'Recreate this image as a classical oil painting with visible brush strokes. Same subject and composition.',
  watercolor: 'Recreate this image as a soft watercolor painting with gentle color washes. Same subject and composition.',
  pixel: 'Recreate this image as retro 16-bit pixel art. Same subject and composition, crisp pixels.',
  cyber: 'Recreate this image in a dark cyberpunk style with neon lights and rain-slick streets. Same subject.',
  ghibli: 'Recreate this image in the gentle hand-drawn style of a Studio Ghibli animation. Same subject and scene.',
  neon: 'Recreate this image with glowing neon light effects on a dark background. Same subject and composition.',
  vintage: 'Recreate this image as a faded 1970s vintage film photograph with grain and warm tones.',
  lego: 'Recreate this image as if everything is built from LEGO bricks. Same scene and colors.',
  clay: 'Recreate this image in claymation style, like a stop-motion Wallace-and-Gromit scene. Same subject.',
  graffiti: 'Recreate this image as bold street-art graffiti with spray-paint texture. Same subject.',
  vector: 'Recreate this image as clean flat vector art with smooth shapes and simple gradients. Same subject.',
  disney: 'Recreate this image in the style of a modern Disney 3D animated movie. Same person and scene.',
  joker: 'Recreate this image in the style of a dramatic comic-book illustration with heavy inks and halftone dots. Same subject.'
}

export const POSES = {
  peace: 'Edit this image so the person is smiling and making a peace sign with one hand. Keep the same person, clothing, lighting and background.',
  thumbsup: 'Edit this image so the person gives a confident thumbs up to the camera. Keep the same person, clothing and background.',
  wave: 'Edit this image so the person is happily waving at the camera. Keep the same person, clothing and background.',
  superhero: 'Edit this image so the person strikes a heroic superhero landing pose, cape flowing. Same face, playful heroic style.',
  boxing: 'Edit this image so the person is in a boxing stance with fists up, wearing boxing gloves. Playful sports pose, same face.',
  dance: 'Edit this image so the person is mid-dance move with one arm up. Keep the same person, clothing and background.',
  think: 'Edit this image so the person is thinking deeply, hand on chin, looking up. Keep the same person and scene.',
  fly: 'Edit this image so the person is flying through the sky like a superhero, arms forward. Same person, playful style.',
  flex: 'Edit this image so the person is playfully flexing both biceps. Keep the same person, clothing and background.',
  king: 'Edit this image so the person is a royal king or queen wearing a crown and elegant royal robes, sitting on a throne.',
  rockstar: 'Edit this image so the person is performing as a rockstar with a guitar on stage, dramatic lights.',
  chef: 'Edit this image so the person is a chef in a white uniform holding a delicious dish. Same face, playful style.',
  astronaut: 'Edit this image so the person is an astronaut in a white space suit, floating in space with stars behind.',
  cowboy: 'Edit this image so the person is a cowboy with a hat in a western desert scene. Same face.'
}

/** Free-form preset resolution: "style:anime", "pose:peace" or plain name. */
export function resolveInstruction(text) {
  const t = String(text || '').trim()
  if (!t) return null
  const m = t.match(/^(style|pose):(.+)$/i)
  if (m) {
    const kind = m[1].toLowerCase()
    const name = m[2].trim().toLowerCase()
    const pool = kind === 'style' ? STYLES : POSES
    if (pool[name]) return { kind: kind === 'style' ? 'style' : 'pose', name, instruction: pool[name] }
  }
  const single = t.toLowerCase()
  if (STYLES[single]) return { kind: 'style', name: single, instruction: STYLES[single] }
  if (POSES[single]) return { kind: 'pose', name: single, instruction: POSES[single] }
  return { kind: 'custom', name: t.slice(0, 40), instruction: t }
}

/** Nudity / undressing / sexual edits are never sent anywhere. */
const BANNED =
  /nude|nudity|naked|undress|uncloth|topless|bikini.*off|remove\s+(the\s+|her\s+|his\s+|their\s+)?(clothes|clothing|shirt|dress|bra|pant|skirt|trouser|outfit)|strip\s*(her|him|them|down)?|lingerie|explicit|porn|sex(y|ual)?\b/i

export function isBanned(text) {
  return BANNED.test(String(text || ''))
}

/* --------------------------- image handling --------------------------- */

/** WhatsApp buffer -> jpeg under MAX_INPUT_BYTES via the bundled ffmpeg. */
async function normalize(buffer) {
  const ext = await extOf(buffer, 'jpg')
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  if (buffer.length <= MAX_INPUT_BYTES) return { buffer, mime }
  const smaller = await convert(buffer, ext, 'jpg', ['-vf', 'scale=1024:-2', '-q:v', '4'])
  return { buffer: smaller, mime: 'image/jpeg' }
}

/* ------------------------------ engines ------------------------------ */

/** Gemini image editing (nano banana). Returns { buffer, engine }. */
async function geminiEdit(buffer, mime, instruction) {
  const key = getKey('gemini')
  if (!key) throw new Error('no gemini key')

  const { data } = await http.post(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`,
    {
      contents: [
        {
          parts: [
            { text: instruction },
            { inline_data: { mime_type: mime, data: buffer.toString('base64') } }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { personGeneration: 'allow_all' }
      }
    },
    { headers: { 'x-goog-api-key': key }, timeout: 180_000 }
  )

  const blocked = data?.promptFeedback?.blockReason
  if (blocked) throw new Error(`Gemini blocked this edit (${blocked})`)

  const parts = data?.candidates?.[0]?.content?.parts || []
  const img = parts.find((p) => p?.inlineData?.data)
  if (!img) throw new Error('Gemini returned no image')
  return { buffer: Buffer.from(img.inlineData.data, 'base64'), engine: 'Gemini' }
}

/** Keyless path: upload to catbox, edit via pollinations kontext. */
async function pollinationsEdit(buffer, mime, instruction) {
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', buffer, { filename: 'venom-restyle.' + (mime.split('/')[1] || 'jpg'), contentType: mime })
  const upload = await http.post(CATBOX_BASE, form, {
    headers: form.getHeaders(),
    timeout: 60_000,
    validateStatus: (s) => s === 200
  })
  const url = String(upload.data || '').trim()
  if (!/^https?:\/\//.test(url)) throw new Error('image upload failed')

  const out = await http.get(`${POLLINATIONS_BASE}/prompt/${encodeURIComponent(instruction)}`, {
    params: {
      image: url,
      model: 'kontext',
      width: 1024,
      height: 1024,
      nologo: true,
      seed: Math.floor(Math.random() * 1e6)
    },
    responseType: 'arraybuffer',
    timeout: 300_000
  })
  const bytes = Buffer.from(out.data)
  if (bytes.length < 5000) throw new Error('the image service returned nothing')
  return { buffer: bytes, engine: 'Pollinations' }
}

/* ----------------------------- main entry ----------------------------- */

/**
 * Transform a photo.
 * @returns {Promise<{buffer:Buffer, engine:string}>}
 */
export async function transformImage(buffer, instruction) {
  if (isBanned(instruction)) throw new Error('I do not make nude or sexual edits.')
  const { buffer: img, mime } = await normalize(buffer)

  // Gemini first when a key exists; silently fall through to the keyless engine.
  if (getKey('gemini')) {
    try {
      return await geminiEdit(img, mime, instruction)
    } catch (e) {
      if (/blocked|nude|sexual/i.test(e.message)) throw e
      /* network/key problems - try pollinations instead */
    }
  }
  return pollinationsEdit(img, mime, instruction)
}
