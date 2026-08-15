/**
 * Downloader test suite.
 *
 *   node test/dltest.js          guards + metadata only (fast)
 *   node test/dltest.js --full   also performs real downloads (slow, ~3 min)
 *
 * Real downloads are opt-in because YouTube rate-limits repeated hits from
 * one IP; running them on every commit would produce misleading failures.
 */
import './_isolate.js'   // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins, categories } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'
import * as D from '../src/lib/downloader.js'

const FULL = process.argv.includes('--full')
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const TT = 'https://www.tiktok.com/@scout2015/video/6718335390845095173'
const IG = 'https://www.instagram.com/reel/C5qLPhxsHZQ/'

const sent = []
const sock = {
  user: { id: '2348000000000:1@s.whatsapp.net' },
  sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'X' + Math.random(), remoteJid: jid, fromMe: true } } },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  groupMetadata: async (jid) => ({ id: jid, subject: 'T', participants: [] }),
  updateMediaMessage: async () => {}
}
const run = async (body) => {
  sent.length = 0
  await handleMessage(sock, {
    key: { remoteJid: '2340000000001@s.whatsapp.net', fromMe: false, id: 'M' + Math.random() },
    pushName: 'Micheal', messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: body }
  })
  return [...sent]
}
const txt = (o) => o.map((s) => s.text || s.caption || '').join('\n')

let pass = 0, fail = 0
const t = (label, cond, extra = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label} → ${String(extra).slice(0, 80)}`); fail++ }
}

await connectDB(); await loadVars(); await loadPlugins()
config.ownerNumbers = ['2340000000001']

console.log('\n═══ DOWNLOADER TESTS ═══')
console.log(`engine: ${D.hasYtdlp() ? 'yt-dlp present' : 'MISSING'} · cookies: ${D.hasCookies() ? 'loaded' : 'none'}`)
console.log(`commands: ${(categories.get('DOWNLOADER') || []).map((p) => p.name).join(', ')}\n`)

console.log('── URL detection ──')
t('detects youtube', D.detectPlatform(YT) === 'youtube')
t('detects youtu.be', D.detectPlatform('https://youtu.be/abc12345678') === 'youtube')
t('detects shorts', D.detectPlatform('https://youtube.com/shorts/abc12345678') === 'youtube')
t('detects tiktok', D.detectPlatform(TT) === 'tiktok')
t('detects vm.tiktok', D.detectPlatform('https://vm.tiktok.com/ZMabc/') === 'tiktok')
t('detects instagram', D.detectPlatform(IG) === 'instagram')
t('detects twitter/x', D.detectPlatform('https://x.com/user/status/123') === 'twitter')
t('rejects non-media url', D.detectPlatform('https://google.com') === null)

console.log('\n── input guards ──')
let o
o = await run('.play');                          t('.play needs input', /song name or YouTube/.test(txt(o)))
o = await run('.video');                         t('.video needs input', /video name or YouTube/.test(txt(o)))
o = await run('.tiktok');                        t('.tiktok needs link', /Send a TikTok/.test(txt(o)))
o = await run('.tiktok https://youtube.com/watch?v=x'); t('.tiktok rejects wrong platform', /not a TikTok/.test(txt(o)))
o = await run('.instagram');                     t('.instagram needs link', /Send an Instagram/.test(txt(o)))
o = await run('.instagram https://tiktok.com/x');t('.instagram rejects wrong platform', /not an Instagram/.test(txt(o)))
o = await run('.autodl');                        t('.autodl needs link', /Send any media link/.test(txt(o)))
o = await run('.ytsearch');                      t('.ytsearch needs query', /Usage/.test(txt(o)))
o = await run('.dlstatus');                      t('.dlstatus reports health', /DOWNLOADER STATUS/.test(txt(o)))

console.log('\n── live metadata ──')
o = await run('.ytsearch lofi hip hop')
t('.ytsearch returns results', /YOUTUBE SEARCH/.test(txt(o)) && /youtu/.test(txt(o)), txt(o).slice(0, 60))
o = await run(`.ytinfo ${YT}`)
t('.ytinfo fetches metadata', /Rick Astley/i.test(txt(o)), txt(o).slice(0, 60))
t('.ytinfo attaches thumbnail', o.some((s) => s.image))

console.log('\n── instagram graceful failure ──')
o = await run(`.instagram ${IG}`)
t('.instagram explains the cookie fix', /cookies\.txt|logged-in session/i.test(txt(o)), txt(o).slice(0, 80))

if (FULL) {
  console.log('\n── REAL DOWNLOADS (slow) ──')
  let st = Date.now()
  o = await run(`.play ${YT}`)
  let a = o.find((s) => s.audio)
  t('.play delivers real mp3', !!a && a.audio.length > 500_000, txt(o).slice(0, 70))
  if (a) console.log(`     ${(a.audio.length / 1048576).toFixed(2)}MB in ${((Date.now() - st) / 1000).toFixed(1)}s · valid ID3: ${a.audio.slice(0, 3).toString('hex') === '494433'}`)

  st = Date.now()
  o = await run(`.video ${YT} 240`)
  let v = o.find((s) => s.video)
  t('.video delivers real mp4', !!v && v.video.length > 500_000, txt(o).slice(0, 70))
  if (v) console.log(`     ${(v.video.length / 1048576).toFixed(2)}MB in ${((Date.now() - st) / 1000).toFixed(1)}s · valid ftyp: ${v.video.slice(4, 8).toString('ascii') === 'ftyp'}`)

  st = Date.now()
  o = await run('.play alan walker faded')
  a = o.find((s) => s.audio)
  t('.play works with a search term', !!a && a.audio.length > 500_000, txt(o).slice(0, 70))
  if (a) console.log(`     ${(a.audio.length / 1048576).toFixed(2)}MB in ${((Date.now() - st) / 1000).toFixed(1)}s`)

  st = Date.now()
  o = await run(`.tiktok ${TT}`)
  v = o.find((s) => s.video)
  t('.tiktok delivers real mp4', !!v && v.video.length > 100_000, txt(o).slice(0, 70))
  if (v) console.log(`     ${(v.video.length / 1048576).toFixed(2)}MB in ${((Date.now() - st) / 1000).toFixed(1)}s`)

  o = await run(`.ttmp3 ${TT}`)
  t('.ttmp3 delivers audio', o.some((s) => s.audio), txt(o).slice(0, 70))

  o = await run(`.autodl ${TT}`)
  t('.autodl routes to tiktok', o.some((s) => s.video), txt(o).slice(0, 70))
} else {
  console.log('\n  (skipping real downloads - pass --full to include them)')
}

console.log(`\n═══ ${pass} passed · ${fail} failed ═══\n`)
process.exit(fail ? 1 : 0)
