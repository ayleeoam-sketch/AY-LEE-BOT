import fs from 'fs'
import { getBuffer } from '../../src/lib/api.js'
import { chat } from '../../src/lib/ai.js'
import { extOf } from '../../src/lib/media.js'
import {
  parseCapcutIntent,
  buildCapcutPipeline,
  pipelineToArgs,
  renderCaptionStrip,
  synthesizeSpeech,
  renderCreate,
  stockImageUrl,
  probe,
  runFfmpeg,
  Workspace,
  STYLE_FILTERS,
  MAX_INPUT_MB,
  MAX_CREATE_SECONDS,
  OUT_W
} from '../../src/lib/clipstitch.js'

/**
 * .capcut - the whole editor in one command.
 *
 * You talk to it like a human and it does the edit. No flags, no chaining
 * ten commands together:
 *
 *   .capcut I want a voiceover saying "Welcome back" and make it cinematic
 *   .capcut reverse it, slow it down, put a caption "send this to her 😂"
 *   .capcut make it black and white with my voiceover read from the quoted message
 *   .capcut create a 2 minute video about Lagos nightlife from stock clips, with a voiceover
 *   .capcut make it go viral
 *
 * Everything is keyless by default: local ffmpeg for the edit, Google
 * Translate for the voice, loremflickr for stock stills. Drop PEXELS_KEY or
 * PIXABAY_KEY in .env and create mode upgrades to real motion clips.
 */

const videoSource = (m) => {
  const ok = ['videoMessage', 'documentMessage', 'imageMessage']
  if (m.isMedia && ok.includes(m.type)) return m
  if (m.quoted?.isMedia && ok.includes(m.quoted.type)) return m.quoted
  return null
}

const HELP = (prefix) => `🎬 *CAPCUT — talk, don't type flags*

Reply to a video and describe the edit in plain English.

*🗣️ Voice*
 • voiceover saying "welcome back to the channel"
 • narrate the quoted message
 • add voice saying ... + keep my audio

*💬 Text*
 • caption "send this to her 😂"  •  subtitle ...  •  put text ...

*🎨 Looks*
 • cinematic · vintage · vaporwave · black and white
 • glitch · viral · warm · cold · bright · dark

*⚡ Motion*
 • reverse · slow · fast · boomerang · smooth
 • zoom at the start/end · shake · speed ramp

*✂️ Frame*
 • trim from 0:05 to 0:20  •  crop 9:16 / 1:1 / 16:9 / 4:5

*🔇 Audio*
 • mute  •  keep my audio

*🔥 One-worders*
 • ${prefix}capcut trending style
 • ${prefix}capcut make it go viral

*🏗️ Build from nothing*
 • ${prefix}capcut create a 2 minute video about Lagos nightlife from stock clips with a voiceover

Chain as many as you like — *reverse and slow and bw with a caption "wait for it"*.

_Avatar lip-sync: coming soon. Narration voiceover is the real thing today._`

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

/** Fetch one TTS chunk. Kept separate so tests can inject a stub. */
const fetchTts = (url) => getBuffer(url, { headers: { Referer: 'https://translate.google.com/' } })

/** Pexels/Pixabay if keyed, otherwise null and the still + Ken Burns wins. */
async function stockVideo(keyword, index, ws) {
  const pexels = process.env.PEXELS_KEY
  const pixabay = process.env.PIXABAY_KEY
  try {
    if (pexels) {
      const { getJson } = await import('../../src/lib/api.js')
      const data = await getJson(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=3&size=small`,
        { headers: { Authorization: pexels } }
      )
      const pick = data?.videos?.[index % Math.max(1, data.videos.length)]
      const file = pick?.video_files?.sort((a, b) => (a.width || 0) - (b.width || 0))
        .find((f) => (f.width || 0) >= 640)
      if (file?.link) return ws.write('mp4', await getBuffer(file.link, { timeout: 60_000 }))
    }
    if (pixabay) {
      const { getJson } = await import('../../src/lib/api.js')
      const data = await getJson(
        `https://pixabay.com/api/videos/?key=${pixabay}&q=${encodeURIComponent(keyword)}&per_page=3`
      )
      const hit = data?.hits?.[index % Math.max(1, data.hits.length)]
      const link = hit?.videos?.small?.url || hit?.videos?.tiny?.url
      if (link) return ws.write('mp4', await getBuffer(link, { timeout: 60_000 }))
    }
  } catch {
    /* stock video is a bonus - never fail the job over it */
  }
  return null
}

/** Ask the AI for a narration script, one line per scene. */
export async function writeScript(topic, scenes) {
  const { text } = await chat(
    `Write a ${scenes}-line voiceover script about "${topic}".\n` +
      'Rules: exactly one sentence per line, 12-20 words each, no numbering, ' +
      'no scene headers, no emojis, no quotes. Punchy documentary tone.',
    { system: 'You write short viral video narration. Output plain lines only.' }
  )
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/^["'“]|["'”]$/g, '').trim())
    .filter((l) => l.length > 8)
    .slice(0, scenes)
}

/* ------------------------------------------------------------------ *
 * edit mode
 * ------------------------------------------------------------------ */

/** What the voiceover should say - resolved before any expensive work. */
function voiceScript(m, intent) {
  const op = intent.ops.find((o) => o.type === 'voiceover')
  if (!op) return null
  const spoken = (op.source === 'quoted' ? m.quoted?.text || '' : op.text || '').trim()
  if (!spoken) {
    throw new Error(
      op.source === 'quoted'
        ? 'Reply to the message you want read out, or type the words after *saying*.'
        : 'Tell me what the voice should say — *voiceover saying "your words here"*.'
    )
  }
  return spoken.slice(0, 900)
}

async function runEdit({ m, intent, src }) {
  // fail fast on a voiceover with nothing to say - before downloading anything
  const script = voiceScript(m, intent)

  const ws = new Workspace()
  try {
    const buffer = await src.download()
    if (buffer.length > MAX_INPUT_MB * 1024 * 1024) {
      throw new Error(`That file is ${(buffer.length / 1048576).toFixed(1)}MB — keep it under ${MAX_INPUT_MB}MB.`)
    }

    const inExt = await extOf(buffer, 'mp4')
    const input = ws.write(inExt, buffer)
    const info = await probe(input)
    // a photo reply is a valid source - it becomes a Ken Burns style clip
    const stillImage = src.type === 'imageMessage' || (info.hasVideo && info.duration < 0.12 && !info.hasAudio)
    if (!info.hasVideo && !stillImage) throw new Error('That file has no video track to edit.')

    /*
     * Voice first: the narration length decides whether the clip has to hold
     * its last frame, and buildCapcutPipeline needs to know that up front.
     */
    let voiceAudio = null
    let voiceDuration = 0
    if (script) {
      const spokenAudio = await synthesizeSpeech(script, { fetchAudio: fetchTts, ws })
      voiceAudio = spokenAudio.file
      voiceDuration = spokenAudio.duration
    }

    const pipeline = buildCapcutPipeline(intent.ops, {
      duration: info.duration || 10,
      hasAudio: info.hasAudio,
      voiceDuration,
      stillImage
    })

    // caption strip -> PNG (sharp, because this ffmpeg build has no drawtext)
    let captionPng = null
    if (pipeline.caption?.text) {
      captionPng = ws.write('png', await renderCaptionStrip(pipeline.caption.text, { width: OUT_W }))
    }

    const output = ws.file('mp4')
    await runFfmpeg(pipelineToArgs(pipeline, { input, captionPng, voiceAudio, output }))

    const out = fs.readFileSync(output)
    if (out.length < 2000) throw new Error('The render came out empty — try a simpler edit.')

    const done = intent.ops
      .map((o) => (o.type === 'style' ? o.name : o.type))
      .join(' → ')
    await m.reply({
      video: out,
      caption: `🎬 *.capcut ready*\n\n▸ ${done}\n▸ ${pipeline.fps}fps · 720p · ${(out.length / 1048576).toFixed(1)}MB`
    })
    await m.react('✅')
  } finally {
    ws.cleanup()
  }
}

/* ------------------------------------------------------------------ *
 * create mode
 * ------------------------------------------------------------------ */

async function runCreate({ m, intent }) {
  const ws = new Workspace()
  try {
    if (!intent.topic) throw new Error('Give me a topic — *.capcut create a 1 minute video about jollof rice*')

    const duration = Math.min(intent.duration || 60, MAX_CREATE_SECONDS)
    const wantsVoice = intent.ops.some((o) => o.type === 'voiceover')
    const wantsCaptions = intent.ops.some((o) => o.type === 'caption')
    const styleOp = intent.ops.find((o) => o.type === 'style')

    await m.reply(
      `🎬 *Building your video*\n\n▸ topic: *${intent.topic}*\n▸ length: ~${duration}s\n` +
        `▸ ${wantsVoice ? 'AI script + voiceover' : 'no narration'}${wantsCaptions ? ' + captions' : ''}\n\n` +
        '_This takes a minute or two. I will send it when it lands._'
    )

    const { file, scenes } = await renderCreate(
      {
        topic: intent.topic,
        duration,
        wantsVoice,
        wantsCaptions,
        style: styleOp ? STYLE_FILTERS[styleOp.name] : null
      },
      {
        ws,
        writeScript,
        speak: (line) => synthesizeSpeech(line, { fetchAudio: fetchTts, ws }),
        fetchImage: async (keyword, i) =>
          ws.write('jpg', await getBuffer(stockImageUrl(keyword, i), { timeout: 40_000 })),
        fetchVideo:
          process.env.PEXELS_KEY || process.env.PIXABAY_KEY
            ? (keyword, i) => stockVideo(keyword, i, ws)
            : null
      }
    )

    const out = fs.readFileSync(file)
    await m.reply({
      video: out,
      caption: `🎬 *.capcut ready*\n\n▸ *${intent.topic}*\n▸ ${scenes.length} scenes · 720p30 · ${(out.length / 1048576).toFixed(1)}MB`
    })
    await m.reply(
      `🎞️ *Scene list*\n\n${scenes
        .map((s, i) => `*${i + 1}.* ${s.line}\n     _${s.duration.toFixed(1)}s · ${s.keyword}_`)
        .join('\n')}`
    )
    await m.react('✅')
  } finally {
    ws.cleanup()
  }
}

/* ------------------------------------------------------------------ */

export default {
  name: 'capcut',
  alias: ['edit', 'videoedit', 'autoedit'],
  category: 'CONVERTER',
  desc: 'Full video editor in plain English — voiceover, captions, styles, speed, or build a video from a topic',
  usage: '.capcut reverse it, slow it down, put a caption "wait for it"',
  cooldown: 30,
  async run({ m, text, prefix }) {
    const intent = parseCapcutIntent(text)

    if (intent.mode === 'help') {
      if (intent.unknown.length) {
        return m.reply(
          `🤔 I don't know *${intent.unknown.slice(0, 3).join('*, *')}* yet.\n\n${HELP(prefix)}`
        )
      }
      return m.reply(HELP(prefix))
    }

    if (intent.mode === 'create') {
      await m.react('⏳')
      try {
        await runCreate({ m, intent })
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
      return
    }

    const src = videoSource(m)
    if (!src) {
      return m.reply(
        `🎬 Reply to a video with *${prefix}capcut ${text || 'make it cinematic'}*\n\n` +
          `_Or build one from scratch:_\n*${prefix}capcut create a 1 minute video about ${text || 'Lagos nightlife'} with a voiceover*`
      )
    }

    await m.react('⏳')
    try {
      await runEdit({ m, intent, src })
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
}
