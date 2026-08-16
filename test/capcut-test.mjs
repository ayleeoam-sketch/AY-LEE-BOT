/**
 * Offline tests for the .capcut mega editor.
 *
 *   node test/capcut-test.mjs
 *
 * Nothing here touches the network. The intent parser and pipeline builder
 * are pure, so they are asserted directly; the render tests generate their
 * own 3s clip with ffmpeg and inject stub TTS / image fetchers, so the
 * assembled MP4s are real files produced by the real code path.
 */
import './_isolate.js'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { loadPlugins, commands } from '../src/lib/pluginLoader.js'
import {
  parseCapcutIntent,
  buildCapcutPipeline,
  pipelineToArgs,
  renderCaptionStrip,
  captionSvg,
  wrapCaption,
  ttsChunks,
  ttsUrl,
  synthesizeSpeech,
  renderCreate,
  planScenes,
  sceneKeyword,
  sceneCount,
  kenBurns,
  stockImageUrl,
  atempoChain,
  toSeconds,
  probe,
  runFfmpeg,
  Workspace,
  STYLE_FILTERS,
  OP_ORDER
} from '../src/lib/clipstitch.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

/** ops -> compact comparable shape, e.g. "style:bw,reverse" */
const shape = (ops) =>
  ops
    .map((o) => {
      if (o.type === 'style') return `style:${o.name}`
      if (o.type === 'speed') return `speed:${o.factor}`
      if (o.type === 'crop') return `crop:${o.ratio}`
      if (o.type === 'zoom') return `zoom:${o.where}`
      if (o.type === 'trim') return `trim:${o.start}-${o.end}`
      if (o.type === 'fps') return `fps:${o.value}`
      if (o.type === 'voiceover') return `voice:${o.source}${o.text ? `="${o.text}"` : ''}`
      if (o.type === 'caption') return `caption="${o.text}"`
      return o.type
    })
    .join(',')

console.log('\n─── plugin registration ───\n')

await loadPlugins()
for (const c of ['capcut', 'edit', 'videoedit', 'autoedit']) {
  check(`command .${c} registered`, commands.has(c))
}
const plugin = commands.get('capcut')
check('capcut sits in the CONVERTER category', plugin?.category === 'CONVERTER')
check('capcut declares a cooldown', typeof plugin?.cooldown === 'number' && plugin.cooldown > 0)
check('capcut has desc + usage', !!plugin?.desc && !!plugin?.usage)

/* ================================================================== *
 * Part 1 - natural language intent parser (25+ phrases)
 * ================================================================== */

console.log('\n─── intent parser ───\n')

const CASES = [
  // the headline examples from the brief
  ['I want a voiceover saying "Welcome back to the channel" and make it cinematic',
    'style:cinematic,voice:text="Welcome back to the channel"'],
  ['reverse it, slow it down, put a caption "send this to her 😂"',
    'speed:0.5,reverse,caption="send this to her 😂"'],
  ['make it black and white with my voiceover read from the quoted message',
    'style:bw,voice:quoted'],
  ['trending style', 'fps:30,style:viral,zoom:start'],
  ['make it go viral', 'fps:30,style:viral,zoom:start'],

  // voiceover phrasings
  ['add voice saying hello world', 'voice:text="hello world"'],
  ['voice over saying "the story begins"', 'voice:text="the story begins"'],
  ['narrate the quoted message', 'voice:quoted'],
  ['read the quoted message', 'voice:quoted'],
  ['narrate "this city never sleeps"', 'voice:text="this city never sleeps"'],

  // captions
  ['caption "wait for it"', 'caption="wait for it"'],
  ['subtitle "part 2 tomorrow"', 'caption="part 2 tomorrow"'],
  ['put text "no way 💀"', 'caption="no way 💀"'],
  ['add words "look at this"', 'caption="look at this"'],

  // styles
  ['make it cinematic', 'style:cinematic'],
  ['vintage look', 'style:vintage'],
  ['vaporwave', 'style:vaporwave'],
  ['glitch effect', 'style:glitch'],
  ['make it warm', 'style:warm'],
  ['darker please', 'style:dark'],

  // motion / speed
  ['reverse it', 'reverse'],
  ['slow it down', 'speed:0.5'],
  ['speed it up', 'speed:2'],
  ['boomerang', 'boomerang'],
  ['make it smooth', 'fps:30'],
  ['zoom at the start', 'zoom:start'],
  ['zoom at the end', 'zoom:end'],
  ['add shake', 'shake'],
  ['speed ramp', 'speedramp'],

  // cut / crop
  ['trim from 0:10 to 0:25', 'trim:10-25'],
  ['trim from 5 to 12', 'trim:5-12'],
  ['crop 9:16', 'crop:9:16'],
  ['crop 1:1', 'crop:1:1'],
  ['make it vertical', 'crop:9:16'],

  // audio
  ['mute it', 'mute'],
  ['no sound', 'mute'],

  // chains
  ['reverse and slow and bw', 'speed:0.5,reverse,style:bw'],
  ['trim from 0:00 to 0:10, crop 9:16, make it cinematic and mute',
    'trim:0-10,crop:9:16,style:cinematic,mute'],
  ['slow it down and add a caption "so satisfying" and make it warm',
    'speed:0.5,style:warm,caption="so satisfying"']
]

for (const [input, expected] of CASES) {
  const got = shape(parseCapcutIntent(input).ops)
  check(`"${input.slice(0, 58)}"`, got === expected, `got ${got}`)
}

check('parser handled 25+ phrases', CASES.length >= 25, String(CASES.length))

/* --------------------------- ordering rules --------------------------- */

const chained = parseCapcutIntent('caption "hi", mute, crop 9:16, reverse, cinematic, trim from 1 to 9')
const order = chained.ops.map((o) => OP_ORDER[o.type])
check('canonical order: trim -> crop -> speed -> style -> motion -> caption -> audio',
  order.every((v, i) => i === 0 || v >= order[i - 1]), JSON.stringify(chained.ops.map((o) => o.type)))

check('duplicate ops collapse', parseCapcutIntent('reverse it and reverse again').ops.length === 1)
check('conflicting speeds keep the first', shape(parseCapcutIntent('slow it down then speed it up').ops) === 'speed:0.5')

/* ---------------------------- unknown input --------------------------- */

/* Vague enthusiasm is a real request, not an error - it gets the viral punch. */
for (const vague of ['make this insane', 'edit it nicely', 'do something cool with it', 'make it fire']) {
  const r = parseCapcutIntent(vague)
  check(`vague "${vague}" still produces an edit`, r.mode === 'edit' && r.ops.some((o) => o.type === 'style'), r.mode)
}
check('"look like a movie" maps to cinematic',
  shape(parseCapcutIntent('make it look like a movie').ops) === 'style:cinematic')

const junk = parseCapcutIntent('flibberdygibbet the wumpus')
check('unknown instruction -> help mode', junk.mode === 'help')
check('unknown words are reported back', junk.unknown.includes('flibberdygibbet') && junk.unknown.includes('wumpus'))
check('empty input -> help mode', parseCapcutIntent('').mode === 'help')
check('a recognised edit never returns help', parseCapcutIntent('make it cinematic').mode === 'edit')
check('filler words alone do not trigger unknown',
  parseCapcutIntent('please make it cinematic for me').unknown.length === 0,
  JSON.stringify(parseCapcutIntent('please make it cinematic for me').unknown))

/* ------------------------------ create mode --------------------------- */

console.log('\n─── create mode parsing ───\n')

const c1 = parseCapcutIntent('create a 2 minute video about Lagos nightlife from stock clips, with a voiceover')
check('create mode detected', c1.mode === 'create')
check('create topic extracted', c1.topic === 'Lagos nightlife', c1.topic)
check('create duration = 120s', c1.duration === 120, String(c1.duration))
check('create wants clips', c1.stock === 'clips')
check('create includes a voiceover op', c1.ops.some((o) => o.type === 'voiceover' && o.source === 'script'))

const c2 = parseCapcutIntent('create a 30 second video about jollof rice from stock images with voiceover and captions')
check('create seconds parsed', c2.duration === 30, String(c2.duration))
check('create images mode', c2.stock === 'images')
check('create captions requested', c2.ops.some((o) => o.type === 'caption' && o.perScene))
check('create topic strips stock/voice noise', c2.topic === 'jollof rice', c2.topic)

const c3 = parseCapcutIntent('create a cinematic 1 minute video about the Sahara desert from stock images')
check('create carries a style', c3.ops.some((o) => o.type === 'style' && o.name === 'cinematic'))
check('create duration clamped to sane range', c3.duration === 60, String(c3.duration))
check('"make it cinematic" is NOT create mode', parseCapcutIntent('make it cinematic').mode === 'edit')

/* ----------------------------- unit helpers --------------------------- */

check('toSeconds mm:ss', toSeconds('1:05') === 65)
check('toSeconds hh:mm:ss', toSeconds('1:00:30') === 3630)
check('toSeconds bare number', toSeconds('12.5') === 12.5)
check('toSeconds 1m30s', toSeconds('1m30s') === 90)
check('atempo chains beyond 2x', atempoChain(4).join(',') === 'atempo=2,atempo=2')
check('atempo chains below 0.5x', atempoChain(0.25).join(',') === 'atempo=0.5,atempo=0.5')
check('atempo passes through 1x as empty', atempoChain(1).length === 0)

/* ================================================================== *
 * Part 2 - pipeline builder snapshots
 * ================================================================== */

console.log('\n─── pipeline builder (deterministic snapshots) ───\n')

const build = (phrase, opts = {}) =>
  buildCapcutPipeline(parseCapcutIntent(phrase).ops, { duration: 10, hasAudio: true, ...opts })

const argsOf = (phrase, opts = {}, files = {}) =>
  pipelineToArgs(build(phrase, opts), { input: 'in.mp4', output: 'out.mp4', ...files })

// determinism: same input, byte-identical args, every time
const a1 = argsOf('reverse and slow and bw').join(' ')
const a2 = argsOf('reverse and slow and bw').join(' ')
check('builder is deterministic', a1 === a2)

const bw = build('make it black and white')
check('bw snapshot', bw.vf ===
  'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,hue=s=0,eq=contrast=1.08,fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2',
  bw.vf)

const cine = build('make it cinematic')
check('cinematic letterboxes 2.35:1 + contrast 1.12', cine.vf.includes("crop='min(iw,ih*2.35)'") && cine.vf.includes('eq=contrast=1.12'))
check('cinematic drops to 24fps', cine.fps === 24 && cine.vf.includes('fps=24'))

const viral = build('make it go viral')
check('viral punches saturation + sharpen', viral.vf.includes('eq=saturation=1.25') && viral.vf.includes('unsharp='))
check('viral adds a zoom', viral.vf.includes('zoompan='))

const rev = build('reverse it')
check('reverse filters both streams', rev.vf.includes('reverse') && rev.af.includes('areverse'))

const slow = build('slow it down')
check('slow uses setpts 2x + atempo 0.5', slow.vf.includes('setpts=2*PTS') && slow.af === 'atempo=0.5')
check('slow doubles the reported duration', slow.duration === 20, String(slow.duration))

const fast = build('speed it up')
check('fast uses setpts 0.5 + atempo 2', fast.vf.includes('setpts=0.5*PTS') && fast.af === 'atempo=2')

const crop = build('crop 9:16')
check('9:16 centre crop expression', crop.vf.includes("crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'"))
check('1:1 centre crop expression', build('crop 1:1').vf.includes("crop='min(iw,ih)':'min(iw,ih)'"))
check('4:5 centre crop expression', build('crop 4:5').vf.includes("crop='min(iw,ih*4/5)'"))

const trim = build('trim from 0:10 to 0:25')
check('trim emits -ss/-to before the input', trim.pre.join(' ') === '-ss 10 -to 25', trim.pre.join(' '))
check('trim sets the working duration', trim.duration === 15, String(trim.duration))

const shake = build('add shake')
check('shake wobbles with a crop expression', /crop=iw-12:ih-12:x='6\+6\*sin/.test(shake.vf), shake.vf)

const ramp = build('speed ramp it')
check('speed ramp uses a time-varying setpts', ramp.vf.includes("setpts='(1.6-0.8*T/10)*PTS'"), ramp.vf)

const boom = build('boomerang')
const boomArgs = pipelineToArgs(boom, { input: 'in.mp4', output: 'out.mp4' })
check('boomerang splits + reverses + concats', boomArgs.join(' ').includes('split[bf][bb];[bb]reverse[br];[bf][br]concat=n=2:v=1:a=0[vbase]'))
check('boomerang doubles duration', boom.duration === 20, String(boom.duration))

const muted = build('mute it')
check('mute maps no audio', pipelineToArgs(muted, { input: 'i.mp4', output: 'o.mp4' }).includes('-an'))

check('every style has a filter', Object.keys(STYLE_FILTERS).length === 10)
for (const name of Object.keys(STYLE_FILTERS)) {
  const p = build(name === 'bw' ? 'black and white' : name)
  check(`style "${name}" reaches the filter chain`, p.vf.includes(STYLE_FILTERS[name].split(',')[0]))
}

/* --------------------------- output format ---------------------------- */

const fmt = argsOf('make it cinematic')
check('encodes h264', fmt.join(' ').includes('-c:v libx264'))
check('CRF 28', fmt.includes('28') && fmt.includes('-crf'))
check('AAC 128k', fmt.join(' ').includes('-c:a aac -b:a 128k'))
check('faststart', fmt.join(' ').includes('-movflags faststart'))
check('720p cap in the scale filter', fmt.join(' ').includes('scale=1280:720'))
check('30fps default', build('reverse it').fps === 30)
check('hard -t limit is always present', fmt.includes('-t'))

/* ------------------------- caption + voice wiring --------------------- */

const capArgs = argsOf('caption "hello"', {}, { captionPng: 'cap.png' })
check('caption overlays the PNG strip', capArgs.join(' ').includes('[1:v]overlay=(W-w)/2:H-h-40:format=auto[vout]'))
check('caption never uses drawtext', !capArgs.join(' ').includes('drawtext'))

const voMix = argsOf('voiceover saying "hi"', {}, { voiceAudio: 'vo.mp3' })
check('voiceover mixes over the original at 0.2', voMix.join(' ').includes('[0:a]volume=0.2[bg]') && voMix.join(' ').includes('amix=inputs=2'))
check('voiceover itself plays at 1.0', voMix.join(' ').includes('volume=1.0[vo]'))
check('voiceover job is -shortest', voMix.includes('-shortest'))

const voMute = argsOf('voiceover saying "hi" and mute', {}, { voiceAudio: 'vo.mp3' })
check('mute + voiceover replaces the track (no amix)', !voMute.join(' ').includes('amix'))

const voKeep = build('voiceover saying "hi" and keep my audio')
check('"keep my audio" keeps the original bed', voKeep.keepOriginal === true)

const held = build('voiceover saying "hi"', { duration: 3, voiceDuration: 9 })
check('a long voiceover holds the last frame', held.holdFrames === true && held.vf.includes('tpad=stop_mode=clone'))
check('held duration follows the voice', held.durationCap > 9, String(held.durationCap))
check('a short voiceover does not pad', build('voiceover saying "hi"', { duration: 30, voiceDuration: 4 }).holdFrames === false)

/* --------------------------- caption rendering ------------------------ */

console.log('\n─── caption strips (sharp/SVG) ───\n')

check('wrapCaption wraps long text', wrapCaption('word '.repeat(30)).length > 1)
check('wrapCaption keeps short text on one line', wrapCaption('short one').length === 1)
check('wrapCaption caps at 4 lines', wrapCaption('word '.repeat(200)).length === 4)
const svg = captionSvg('5 < 7 & "quotes" \'x\'')
check('caption SVG escapes markup', svg.includes('&lt;') && svg.includes('&amp;') && !svg.includes('<7'))
check('caption SVG keeps emoji', captionSvg('send this to her 😂').includes('😂'))
const strip = await renderCaptionStrip('send this to her 😂')
check('caption renders a real PNG', strip.length > 1000 && strip.slice(1, 4).toString() === 'PNG')
const stripMeta = await sharp(strip).metadata()
check('caption strip is 1280 wide', stripMeta.width === 1280, String(stripMeta.width))
check('caption strip has alpha', stripMeta.channels === 4)

/* ------------------------------- TTS ---------------------------------- */

console.log('\n─── TTS chunking ───\n')

check('empty text -> no chunks', ttsChunks('').length === 0)
check('short text -> one chunk', ttsChunks('Hello there friend.').length === 1)
const many = ttsChunks('This is a sentence. '.repeat(40))
check('long text splits into many chunks', many.length > 1)
check('every chunk respects the 200 char cap', many.every((c) => c.length <= 200), String(Math.max(...many.map((c) => c.length))))
check('chunking splits on sentence boundaries', many[0].endsWith('.'))
const giant = ttsChunks('go. ' + 'z'.repeat(450))
check('a word longer than the cap is still spoken in full', giant.join('').includes('z'.repeat(200)))
check('no text is dropped when chunking', giant.join('').replace(/\s/g, '').length === ('go.' + 'z'.repeat(450)).length)
check('tts url is keyless google translate', ttsUrl('hi').startsWith('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&'))
check('tts url encodes the query', ttsUrl('a b&c').includes('q=a%20b%26c'))

/* --------------------------- scene planning --------------------------- */

console.log('\n─── create-mode planning ───\n')

check('sceneCount scales with runtime', sceneCount(120) > sceneCount(30))
check('sceneCount has a floor of 3', sceneCount(5) === 3)
check('sceneCount has a ceiling', sceneCount(9999) === 24)
check('sceneKeyword drops stopwords', sceneKeyword('The city of Lagos never sleeps at night') === 'city lagos', sceneKeyword('The city of Lagos never sleeps at night'))
check('sceneKeyword falls back to the topic', sceneKeyword('a an the', 'Lagos') === 'Lagos')
const planned = planScenes(['Line one here', 'Line two here'], { durations: [4.2, 7.1] })
check('scene duration follows the narration length', planned[0].duration > 4 && planned[1].duration > 7)
check('scenes get alternating Ken Burns moves', planned[0].motion !== planned[1].motion)
check('Ken Burns cycles through 4 moves', new Set([0, 1, 2, 3].map((i) => kenBurns(i))).size === 4)
check('Ken Burns emits zoompan', kenBurns(0).startsWith('zoompan='))
check('stock image url is keyless loremflickr', stockImageUrl('lagos night').startsWith('https://loremflickr.com/1280/720/lagos%2Cnight'))

/* ================================================================== *
 * Part 3 - real local renders
 * ================================================================== */

console.log('\n─── local renders (real ffmpeg) ───\n')

const ws = new Workspace()
let renderedOk = false
try {
  // a 3 second test clip with a tone, generated locally
  const src = ws.file('mp4')
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src
  ])
  const srcInfo = await probe(src)
  check('test clip generated (3s, with audio)', Math.abs(srcInfo.duration - 3) < 0.2 && srcInfo.hasAudio)

  /* ---- reverse + bw + caption on the real clip ---- */
  const intent = parseCapcutIntent('reverse it and make it black and white with a caption "wait for it 😂"')
  const pipe = buildCapcutPipeline(intent.ops, { duration: srcInfo.duration, hasAudio: srcInfo.hasAudio })
  const capPng = ws.write('png', await renderCaptionStrip(pipe.caption.text))
  const out1 = ws.file('mp4')
  await runFfmpeg(pipelineToArgs(pipe, { input: src, captionPng: capPng, output: out1 }))
  const o1 = await probe(out1)
  check('reverse+bw+caption produced a file', fs.existsSync(out1) && fs.statSync(out1).size > 5000)
  check('reverse+bw+caption is playable video', o1.hasVideo)
  check('reverse+bw+caption keeps duration ~3s', Math.abs(o1.duration - 3) < 0.4, o1.duration.toFixed(2))
  check('reverse+bw+caption keeps audio', o1.hasAudio)

  /* ---- voiceover mux with an injected TTS stub ---- */
  let ttsCalls = 0
  const fetchAudio = async (url) => {
    ttsCalls++
    const q = decodeURIComponent(new URL(url).searchParams.get('q') || '')
    const seconds = Math.max(0.8, Math.min(9, q.length / 15))
    const f = ws.file('mp3')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=520:duration=${seconds.toFixed(2)}`, '-b:a', '128k', f])
    return fs.readFileSync(f)
  }

  // deliberately over the 200-char GTTS cap so the multi-request concat runs
  const longScript =
    'Welcome back to the channel and thanks for sticking around this far into the video. ' +
    'This voiceover deliberately runs past the two hundred character limit so the chunking and concat path is exercised properly. ' +
    'It should still line up with the picture when everything is muxed together at the very end of the job.'
  check('render script is over the TTS cap', longScript.length > 200, String(longScript.length))
  const speech = await synthesizeSpeech(longScript, { fetchAudio, ws })
  check('TTS stub was chunked into multiple requests', ttsCalls > 1, String(ttsCalls))
  check('synthesized speech is a real audio file', fs.existsSync(speech.file) && speech.duration > 1)

  const voIntent = parseCapcutIntent('voiceover saying "welcome back" and make it cinematic')
  const voPipe = buildCapcutPipeline(voIntent.ops, {
    duration: srcInfo.duration,
    hasAudio: srcInfo.hasAudio,
    voiceDuration: speech.duration
  })
  const out2 = ws.file('mp4')
  await runFfmpeg(pipelineToArgs(voPipe, { input: src, voiceAudio: speech.file, output: out2 }))
  const o2 = await probe(out2)
  check('voiceover render produced a file', fs.existsSync(out2) && fs.statSync(out2).size > 5000)
  check('voiceover render has both streams', o2.hasVideo && o2.hasAudio)
  check('voiceover longer than the clip is not cut off',
    o2.duration >= speech.duration - 0.6, `${o2.duration.toFixed(2)} vs voice ${speech.duration.toFixed(2)}`)

  /* ---- create mode with injected image + TTS stubs ---- */
  const fetchImage = async (keyword, i) =>
    ws.write('jpg', await sharp({
      create: { width: 1280, height: 720, channels: 3, background: { r: (i * 47) % 255, g: 90, b: 170 } }
    }).jpeg().toBuffer())

  const created = await renderCreate(
    { topic: 'Lagos nightlife', duration: 30, wantsVoice: true, wantsCaptions: true, style: STYLE_FILTERS.cinematic },
    {
      ws,
      writeScript: async (topic, n) =>
        Array.from({ length: n }, (_, i) => `Scene ${i + 1} shows ${topic} where the lights never go out.`),
      speak: (line) => synthesizeSpeech(line, { fetchAudio, ws }),
      fetchImage
    }
  )
  const o3 = await probe(created.file)
  check('create mode assembled a real MP4', fs.existsSync(created.file) && fs.statSync(created.file).size > 20_000)
  check('create mode produced multiple scenes', created.scenes.length >= 3, String(created.scenes.length))
  check('create mode output is playable with audio', o3.hasVideo && o3.hasAudio)
  check('create mode duration is the sum of its scenes',
    Math.abs(o3.duration - created.scenes.reduce((a, s) => a + s.duration, 0)) < 1.5,
    `${o3.duration.toFixed(2)} vs ${created.scenes.reduce((a, s) => a + s.duration, 0).toFixed(2)}`)
  check('every scene carries a keyword for stock search', created.scenes.every((s) => s.keyword.length > 1))

  /* ---- resilience: every stock image fetch fails, render must survive ---- */
  const resilient = await renderCreate(
    { topic: 'Lagos nightlife', duration: 21, wantsVoice: true, wantsCaptions: false },
    {
      ws,
      writeScript: async (topic, n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} about ${topic} at night.`),
      speak: (line) => synthesizeSpeech(line, { fetchAudio, ws }),
      fetchImage: async () => { throw new Error('stock source down') }
    }
  )
  const o4 = await probe(resilient.file)
  check('create mode survives a total stock-image outage', fs.existsSync(resilient.file) && o4.hasVideo && o4.duration > 1,
    `${o4.duration.toFixed(2)}s`)

  /* ---- a TTS outage is reported friendly, never as a socket error ---- */
  let ttsErr = ''
  try {
    await synthesizeSpeech('hello there', { fetchAudio: async () => { throw new Error('ECONNRESET tls socket') }, ws })
  } catch (e) { ttsErr = e.message }
  check('TTS outage gives a friendly message, not a socket dump',
    /unreachable/.test(ttsErr) && !/ECONNRESET/.test(ttsErr), ttsErr)

  renderedOk = true
} catch (e) {
  check('local render suite completed', false, e.message)
} finally {
  const dir = ws.dir
  ws.cleanup()
  check('workspace tmp files are cleaned up', !fs.existsSync(dir))
}

/* --------------------------- tmp hygiene ------------------------------ */

const tmpDir = path.resolve('tmp')
const leftovers = fs.existsSync(tmpDir)
  ? fs.readdirSync(tmpDir).filter((f) => f.startsWith('capcut-'))
  : []
check('no capcut leftovers in tmp/', leftovers.length === 0, leftovers.join(','))

/* ------------------------- plugin behaviour --------------------------- */

console.log('\n─── plugin surface ───\n')

const mkM = (over = {}) => {
  const o = { replies: [], reactions: [], isMedia: false, quoted: null, ...over }
  o.reply = async (c) => { o.replies.push(typeof c === 'string' ? c : c.caption || '[media]'); return c }
  o.react = async (e) => { o.reactions.push(e) }
  return o
}

let mm = mkM()
await plugin.run({ m: mm, text: '', prefix: '.' })
check('no args -> help card', /CAPCUT/.test(mm.replies[0] || ''))
check('help card lists the verbs it knows', /cinematic/.test(mm.replies[0]) && /boomerang/.test(mm.replies[0]) && /voiceover/.test(mm.replies[0]))
check('help card marks lip-sync as coming soon', /lip-sync/i.test(mm.replies[0]) && /coming soon/i.test(mm.replies[0]))

mm = mkM()
await plugin.run({ m: mm, text: 'flibberdygibbet it', prefix: '.' })
check('unknown verb -> punchy help card', /don't know/.test(mm.replies[0]) && /CAPCUT/.test(mm.replies[0]))

mm = mkM()
await plugin.run({ m: mm, text: 'make it cinematic', prefix: '.' })
check('edit with no video -> friendly prompt, no stack trace', /Reply to a video/.test(mm.replies[0] || ''))
check('no-video prompt never reacts with an error', !mm.reactions.includes('❌'))

mm = mkM({
  isMedia: true,
  type: 'videoMessage',
  download: async () => Buffer.alloc(45 * 1024 * 1024, 1)
})
await plugin.run({ m: mm, text: 'make it cinematic', prefix: '.' })
check('oversized input fails friendly', /keep it under 40MB/.test(mm.replies.join(' ')), mm.replies.join(' ').slice(0, 80))
check('oversized input reacts ❌ (no crash)', mm.reactions.includes('❌'))

mm = mkM({ isMedia: true, type: 'videoMessage', quoted: null, download: async () => Buffer.alloc(0) })
await plugin.run({ m: mm, text: 'narrate the quoted message', prefix: '.' })
check('voiceover with nothing to read fails friendly', /Reply to the message/.test(mm.replies.join(' ')), mm.replies.join(' ').slice(0, 90))

console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`)
if (fail) process.exitCode = 1
