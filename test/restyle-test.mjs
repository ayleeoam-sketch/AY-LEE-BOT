/**
 * Offline test for the photo restyler (.restyle).
 *
 *   node test/restyle-test.mjs
 *
 * A local mock server emulates Gemini (keyed engine), catbox + pollinations
 * (keyless engine), so the suite never touches the real internet. Env
 * overrides for the base URLs are set BEFORE the lib is imported.
 */
import './_isolate.js' // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins, findCommand } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'
import http from 'http'
import { URL } from 'url'

const OWNER = '2340000000001'
const BOT = '2348000000000'

const FAKE_PNG = Buffer.from('FAKE-PNG-IMAGE-BYTES')

const hits = []
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  hits.push(`${req.method} ${u.pathname}${u.search}`)

  // Gemini generateContent
  if (u.pathname.includes(':generateContent')) {
    if (req.headers['x-goog-api-key'] !== 'test-gemini-key') {
      res.writeHead(403)
      return res.end()
    }
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      const text = parsed?.contents?.[0]?.parts?.find((p) => p.text)?.text || ''
      if (/nude|blocked/i.test(text)) {
        // emulate gemini's own safety refusal
        return res.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/png', data: FAKE_PNG.toString('base64') } },
                  { text: 'done' }
                ]
              }
            }
          ]
        })
      )
    })
    return
  }

  // catbox upload
  if (u.pathname.includes('catbox')) {
    let len = 0
    req.on('data', (d) => (len += d.length))
    req.on('end', () => {
      hits.push(`catbox-bytes:${len}`)
      res.end(`http://127.0.0.1:${mock.address().port}/files/test.jpg`)
    })
    return
  }

  // pollinations image
  if (u.pathname.includes('/prompt/')) {
    if (!u.searchParams.get('image')) {
      res.writeHead(400)
      return res.end()
    }
    hits.push(`pollinations-model:${u.searchParams.get('model')}`)
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    return res.end(Buffer.alloc(6000, 'p'))
  }

  res.writeHead(404)
  res.end()
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${mock.address().port}`

/* point the engines at the mock BEFORE importing the lib */
process.env.RESTYLE_GEMINI_BASE = `${base}/gemini`
process.env.RESTYLE_POLLINATIONS_BASE = `${base}/pollinations`
process.env.RESTYLE_CATBOX_BASE = `${base}/catbox`
delete process.env.GEMINI_API_KEY

const { STYLES, POSES, resolveInstruction, isBanned, transformImage } = await import('../src/lib/restyle.js')
const plugin = (await import('../plugins/ai/restyle.js')).default[0]

let pass = 0, fail = 0
const t = (label, cond, extra = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label} → ${String(extra).slice(0, 90)}`); fail++ }
}

/* ------------------------------ boot ------------------------------ */
await connectDB()
await loadVars()
await loadPlugins()
config.ownerNumbers = [OWNER]

console.log(`\n═══ .restyle PHOTO RESTYLER — offline test ═══\n`)

console.log('── PRESETS & SAFETY ──')
t('presets cover styles', Object.keys(STYLES).length >= 12, Object.keys(STYLES).length)
t('presets cover poses', Object.keys(POSES).length >= 10, Object.keys(POSES).length)
let r = resolveInstruction('anime')
t('style preset resolves', r.kind === 'style' && /anime/.test(r.instruction), r.kind)
r = resolveInstruction('pose:peace')
t('pose preset resolves', r.kind === 'pose' && /peace sign/i.test(r.instruction), r.kind)
r = resolveInstruction('make me a knight')
t('free-form instruction resolves', r.kind === 'custom' && r.instruction === 'make me a knight', r.kind)
t('empty instruction is null', resolveInstruction('') === null)
t('nude request blocked', isBanned('make her nude'))
t('undress request blocked', isBanned('remove her clothes'))
t('normal request passes', !isBanned('anime style') && !isBanned('peace sign'))

console.log('── ENGINES ──')
process.env.GEMINI_API_KEY = 'test-gemini-key'
hits.length = 0
let out = await transformImage(Buffer.from('REAL-IMAGE-BYTES'), 'turn this into anime style')
t('gemini used when key present', out.engine === 'Gemini', out.engine)
t('gemini endpoint called once', hits.filter((h) => h.includes(':generateContent')).length === 1)
t('gemini returns image bytes', out.buffer.equals(FAKE_PNG))
try {
  await transformImage(Buffer.from('x'), 'make her nude now')
  t('banned prompt rejected before any call', false)
} catch (e) {
  t('banned prompt rejected before any call', /nude|sexual/i.test(e.message), e.message)
}
// gemini refusing on its own (blockReason) must surface, not silently fall back
try {
  await transformImage(Buffer.from('x'), 'this edit gets blocked')
  t('gemini safety refusal surfaces', false)
} catch (e) {
  t('gemini safety refusal surfaces', /blocked/i.test(e.message), e.message)
}

delete process.env.GEMINI_API_KEY
hits.length = 0
out = await transformImage(Buffer.from('REAL-IMAGE-BYTES'), 'turn this into anime style')
t('keyless engine used without key', out.engine === 'Pollinations', out.engine)
t('image uploaded to catbox', hits.some((h) => h.startsWith('catbox-bytes:')))
t('pollinations called with kontext + image', hits.some((h) => h.includes('pollinations-model:kontext')))
t('pollinations returns image bytes', out.buffer.length >= 5000)

console.log('── COMMAND ──')
t('.restyle registered with aliases', findCommand('restyle')?.name === 'restyle' && findCommand('vary')?.name === 'restyle')

// drive the plugin directly with a fake quoted image message
const sent = []
const fakeM = (quotedType, quotedBytes, text = '') => {
  const q = quotedType
    ? { type: quotedType, download: async () => Buffer.from(quotedBytes) }
    : null
  return {
    type: 'conversation',
    quoted: q,
    react: async () => {},
    reply: async (content) => {
      sent.push(content)
      return { key: { id: 'x' } }
    },
    chat: 'x@s.whatsapp.net',
    commandResponses: []
  }
}

sent.length = 0
await plugin.run({ m: fakeM(null), text: '' })
t('no image -> preset menu', sent.some((s) => /STYLES/.test(s) && /POSES/.test(s)), sent[0])
sent.length = 0
await plugin.run({ m: fakeM(null), text: 'anime' })
t('no image with preset -> menu still', sent.some((s) => /RESTYLE/.test(s)))
sent.length = 0
delete process.env.GEMINI_API_KEY
await plugin.run({ m: fakeM('imageMessage', Buffer.alloc(300, 'i')), text: 'anime' })
const imgReply = sent.find((s) => s.image)
t('edited image sent back', !!imgReply, sent.map((s) => Object.keys(s).join(',')))
t('caption names engine', /Engine: Pollinations/.test(imgReply?.caption || ''), imgReply?.caption)
sent.length = 0
await plugin.run({ m: fakeM('imageMessage', Buffer.alloc(300, 'i')), text: 'make her nude' })
t('command refuses nudity upfront', sent.some((s) => /do not make/.test(s)), sent[0])

await mock.close()
console.log(`\n${fail ? `❌ ${fail} failed` : '🎉 all passed'} (${pass} checks)`)
process.exit(fail ? 1 : 0)
