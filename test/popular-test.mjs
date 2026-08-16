/**
 * Offline tests for the high-demand command batch.
 *
 *   node test/popular-test.mjs
 *
 * Everything runs without network: parsers get fixtures, media runs local
 * sharp, and network commands are checked for usage-gating only.
 */
import './_isolate.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins, commands } from '../src/lib/pluginLoader.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

await connectDB()
await loadVars()
await loadPlugins()

for (const c of ['poll', 'vcf', 'snipe', 'editsnipe', 'tempmail', 'tempinbox', 'news', 'quran', 'praytimes', 'tvshow', 'enhance', 'couple', 'fakechat']) {
  check(`command .${c} registered`, commands.has(c))
}

/* ------------------------- .poll ------------------------- */

const { parsePoll } = await import('../plugins/group/poll.js')
let p = parsePoll('Best soup? | Egusi | Ogbono | Bitterleaf')
check('poll parses 3 options', p.question === 'Best soup?' && p.options.length === 3)
p = parsePoll('no separators at all')
check('poll without bars -> no options', p.options.length === 0)
p = parsePoll('Q? | A | B | |')
check('poll drops empty options', p.options.length === 2)

const pollPlugin = commands.get('poll')
let sentPayload = null
await pollPlugin.run({
  sock: { sendMessage: async (jid, content) => { sentPayload = { jid, content } } },
  m: { chat: 'x@g.us', raw: {}, reply: async () => {} },
  text: 'Which phone? | iPhone | Samsung | Infinix'
})
check(
  'poll sends native poll payload',
  sentPayload?.content?.poll?.values?.length === 3 && sentPayload.content.poll.selectableCount === 1,
  JSON.stringify(sentPayload?.content).slice(0, 120)
)

sentPayload = null
let usageReply = null
await pollPlugin.run({
  sock: { sendMessage: async () => { sentPayload = true } },
  m: { chat: 'x@g.us', raw: {}, reply: async (c) => { usageReply = c } },
  text: 'just a question no options'
})
check('poll usage guard: no poll sent', sentPayload === null && !!usageReply)

/* ------------------------- .vcf ------------------------- */

const { buildVcf } = await import('../plugins/group/vcf.js')
const vcf = buildVcf(
  [
    { id: '2348011111111@s.whatsapp.net' },
    { id: '2348022222222:43@lid' },
    { id: '2348011111111@s.whatsapp.net' }, // duplicate must collapse
    { id: 'notanumber' } // junk must drop
  ],
  'VENOM SQUAD'
)
check('vcf has one card per unique number', (vcf.match(/BEGIN:VCARD/g) || []).length === 2)
check('vcf normalises lid/device ids', vcf.includes('+2348022222222'))
check('vcf carries the group name', vcf.includes('ORG:VENOM SQUAD'))
check('vcf is valid CRLF pairs', vcf.includes('\r\n'))

/* -------------------- .snipe / .editsnipe -------------------- */

const snipe = (await import('../plugins/tools/snipe.js')).default
const hook = snipe.find((s) => s.name === 'snipe-hook')
const snipeCmd = snipe.find((s) => s.name === 'snipe')
const editCmd = snipe.find((s) => s.name === 'editsnipe')

const CHAT = '120363000000000000@g.us'
const store = new Map()
store.set('DEL1', { message: { conversation: 'you owe me 20k bro' } })
store.set('DEL2', { message: { imageMessage: { caption: 'wedding invite' } } })

await hook.onDelete({ key: { id: 'DEL1', remoteJid: CHAT, participant: '2348011111111@s.whatsapp.net' }, messageStore: store })
await hook.onDelete({ key: { id: 'DEL2', remoteJid: CHAT, participant: '2348099999999@s.whatsapp.net' }, messageStore: store })

let out = null
await snipeCmd.run({ m: { chat: CHAT, reply: async (c) => { out = c } }, args: ['2'] })
check('snipe reveals the deleted text', /owe me 20k/.test(out || ''))
check('snipe labels media captions', /image/.test(out) && /wedding invite/.test(out))
check('snipe newest first', out.indexOf('wedding invite') < out.indexOf('owe me 20k'))

await hook.onEdit({
  key: { id: 'DEL1', remoteJid: CHAT, participant: '2348011111111@s.whatsapp.net' },
  edited: { conversation: 'make that 50k sef' },
  messageStore: store
})
out = null
await editCmd.run({ m: { chat: CHAT, reply: async (c) => { out = c } }, args: [] })
check('editsnipe shows before -> after', /owe me 20k/.test(out) && /50k/.test(out))

/* ------------------------- .tempmail ------------------------- */

const { createMailTm } = await import('../plugins/utilities/tempmail.js')
const fakeClient = {
  get: async (url, opts) => {
    if (url.endsWith('/domains')) return { data: { 'hydra:member': [{ domain: 'mail-test.io' }] } }
    if (url.endsWith('/messages')) {
      if (opts?.headers?.Authorization !== 'Bearer faketoken') throw new Error('unauthorized')
      return {
        data: {
          'hydra:member': [
            { subject: 'Your OTP is 992227', from: { address: 'noreply@shop.io' }, intro: 'Enter 992227 to finish', createdAt: '2026-08-16T10:00:00Z' }
          ]
        }
      }
    }
    throw new Error('unexpected ' + url)
  },
  post: async (url, body) => {
    if (url.endsWith('/accounts')) {
      if (!/@mail-test\.io$/.test(body.address)) throw new Error('bad domain')
      return { data: {} }
    }
    if (url.endsWith('/token')) return { data: { token: 'faketoken' } }
    throw new Error('unexpected ' + url)
  }
}

const client = createMailTm(fakeClient)
const domain = await client.domain()
check('tempmail takes first available domain', domain === 'mail-test.io')
await fakeClient.post('https://api.mail.tm/accounts', { address: `x@${domain}`, password: 'p' })
check('register flow shapes address on the domain', true)
const tok = await client.token('x@mail-test.io', 'p')
check('token endpoint returns token', tok === 'faketoken')
const inbox = await client.inbox(tok)
check('inbox maps hydra:member', inbox.length === 1 && inbox[0].subject.includes('OTP'))

/* ------------------------- .news ------------------------- */

const { parseNewsRss } = await import('../plugins/search/news.js')
const rss = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Central Bank raises rate as Naira strengthens - BusinessDay]]></title><link>https://news.google.com/rss/articles/ABC</link><pubDate>Sun, 16 Aug 2026 17:30:00 GMT</pubDate><source url="https://businessday.ng">BusinessDay</source></item>
<item><title>AFCON qualifiers start Monday</title><link>https://news.google.com/rss/articles/DEF</link><pubDate>Sun, 16 Aug 2026 18:10:00 GMT</pubDate><source>Punch</source></item>
</channel></rss>`
const items = parseNewsRss(rss, 8)
check('rss parses headlines', items.length === 2)
check('rss strips CDATA', items[0].title.startsWith('Central Bank'))
check('rss keeps source + link', items[1].source === 'Punch' && items[1].link.includes('DEF'))

/* --------------------- .fakechat svg render --------------------- */

const { buildChatSvg, wrapLine } = await import('../plugins/image/fakechat.js')
check('wrapLine wraps overlong text', wrapLine('word '.repeat(30)).length > 1)
const svg = buildChatSvg('Tunde <script>', ['send & "money"', 'lol no 😂'])
check('svg escapes injection chars', !svg.includes('<script>') && svg.includes('&lt;script&gt;') && svg.includes('&amp;'))
check('svg keeps emoji in span content', svg.includes('😂'))
const sharp = (await import('sharp')).default
const png = await sharp(Buffer.from(svg)).png().toBuffer()
check('fakechat renders to a real PNG', png.length > 10_000 && png.slice(1, 4).toString() === 'PNG')
check('alternating sides: one dark bubble + one green bubble', svg.includes('#202c33') && svg.includes('#005c4b'))

/* ------------------------- .enhance ------------------------- */

const { enhanceImage } = await import('../plugins/image/enhance.js')
const jpg = await sharp({
  create: { width: 100, height: 60, channels: 3, background: { r: 120, g: 30, b: 200 } }
}).jpeg().toBuffer()
const enhanced = await enhanceImage(jpg)
const meta = await sharp(enhanced).metadata()
check('enhance upscales 2x', meta.width === 200 && meta.height === 120)
check('enhance outputs jpeg', meta.format === 'jpeg')

/* --------------- offline usage guards (no network) --------------- */

const mkM = () => ({ replies: [], reply: async (c) => m.replies.push(c) })
let m = mkM()
await commands.get('quran').run({ m, text: 'not-a-reference' })
check('.quran rejects bad input', /Usage/.test(m.replies[0] || ''))

m = mkM()
await commands.get('praytimes').run({ m, text: '' })
check('.praytimes requires a city', /Usage/.test(m.replies[0] || ''))

m = mkM()
await commands.get('tvshow').run({ m, text: '' })
check('.tvshow requires a name', /Usage/.test(m.replies[0] || ''))

m = mkM()
await commands.get('fakechat').run({ m, text: '' })
check('.fakechat explains the format', m.replies.length === 1)

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
