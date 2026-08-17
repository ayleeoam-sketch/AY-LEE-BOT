/**
 * Offline test for the profile-clone plugin.
 *
 *   node test/clone-test.mjs
 *
 * Boots the real handler with a mock WhatsApp socket and drives
 * .clone / .clonestatus / .cloneinfo / .unclone end to end. Profile
 * pictures are served by a tiny local HTTP server so getBuffer() works
 * without touching the internet.
 */
import './_isolate.js' // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB, collection } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'
import http from 'http'

const OWNER = '2340000000001'
const MEMBER = '2348022222222' // group member, cloned via @mention
const BOT = '2348000000000'
const BOT_JID = `${BOT}:1@s.whatsapp.net`
const BOT_NORM_JID = `${BOT}@s.whatsapp.net`
const OWNER_JID = `${OWNER}@s.whatsapp.net`
const TARGET_JID = `${MEMBER}@s.whatsapp.net`

/* tiny local server so getBuffer() can download the fake profile pictures */
const ppServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' })
  const body = req.url.includes('orig')
    ? 'ORIGINAL-PP-BYTES'
    : req.url.includes('owner')
      ? 'OWNER-PP-BYTES'
      : 'TARGET-PP-BYTES'
  res.end(body)
})
await new Promise((r) => ppServer.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${ppServer.address().port}`

const sent = []
const calls = { names: [], bios: [], pics: [] }
const sock = {
  user: { id: BOT_JID, name: 'VENOM MD BOT' },
  sendMessage: async (jid, content) => {
    sent.push(content)
    return { key: { id: 'X' + Math.random(), remoteJid: jid, fromMe: true } }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  groupMetadata: async (jid) => ({
    id: jid,
    subject: 'Test GC',
    owner: OWNER_JID,
    creation: 1700000000,
    participants: [
      { id: OWNER_JID, admin: 'superadmin' },
      { id: TARGET_JID, admin: null, notify: 'Michael K.' },
      { id: BOT_JID, admin: 'admin' }
    ]
  }),
  groupParticipantsUpdate: async () => [{ status: '200' }],
  groupSettingUpdate: async () => {},
  updateMediaMessage: async () => {},
  profilePictureUrl: async (jid) => {
    if (jid === BOT_NORM_JID || jid === BOT_JID) return `${base}/orig.jpg`
    if (jid === TARGET_JID) return `${base}/target.jpg`
    if (jid === OWNER_JID) return `${base}/owner.jpg`
    throw new Error('no picture')
  },
  fetchStatus: async (jid) => {
    const bios = {
      [BOT_NORM_JID]: 'Official bot bio',
      [TARGET_JID]: 'Mike is the best.',
      [OWNER_JID]: 'Owner of the bot.'
    }
    const status = bios[jid] || ''
    return status ? [{ status, setAt: new Date(), id: jid }] : []
  },
  updateProfileName: async (name) => { calls.names.push(name) },
  updateProfileStatus: async (bio) => { calls.bios.push(bio) },
  updateProfilePicture: async (jid, buf) => { calls.pics.push({ jid, buf: Buffer.from(buf).toString() }) }
}

/** Build a message, with proper mention metadata when @tags are present. */
function build(body, { from = OWNER, group = true, pushName = 'Micheal' } = {}) {
  const mentions = [...body.matchAll(/@(\d{7,})/g)].map((x) => `${x[1]}@s.whatsapp.net`)
  return {
    key: {
      remoteJid: group ? '120363000000000000@g.us' : `${from}@s.whatsapp.net`,
      fromMe: false,
      id: 'M' + Math.random().toString(36).slice(2),
      participant: group ? `${from}@s.whatsapp.net` : undefined
    },
    pushName,
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: mentions.length
      ? { extendedTextMessage: { text: body, contextInfo: { mentionedJid: mentions } } }
      : { conversation: body }
  }
}

const run = async (body, opts) => {
  sent.length = 0
  await handleMessage(sock, build(body, opts))
  return [...sent]
}
const txt = (out) => out.map((s) => s.text || s.caption || Object.keys(s).join(',')).join('\n')

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
const clones = collection('clone')
await clones.delete({})

console.log(`\n═══ CLONE PLUGIN — offline test ═══\n`)

let o

console.log('── CLONE ──')
o = await run('.clone abc') // invalid arg
t('invalid argument shows usage', /Tag someone|CLONE/.test(txt(o)), txt(o))
o = await run(`.clone @${MEMBER}`) // group @mention -> roster notify name
t('clones group member name from roster', calls.names.at(-1) === 'Michael K.', calls.names.at(-1))
t('clones group member bio', calls.bios.at(-1) === 'Mike is the best.', calls.bios.at(-1))
t('clones group member picture', calls.pics.at(-1)?.buf === 'TARGET-PP-BYTES', calls.pics.at(-1)?.buf)
t('replies with PROFILE CLONED', /PROFILE CLONED/.test(txt(o)), txt(o))
o = await run('.clone', { from: OWNER, group: false }) // DM, bare .clone = clone me
t('clone me uses pushName from their message', calls.names.at(-1) === 'Micheal', calls.names.at(-1))
t('clone me copies their bio', calls.bios.at(-1) === 'Owner of the bot.', calls.bios.at(-1))
t('clone me copies their picture', calls.pics.at(-1)?.buf === 'OWNER-PP-BYTES', calls.pics.at(-1)?.buf)
o = await run('.clone 9990000000000') // not on WhatsApp
t('unknown number refused', /Couldn't read/.test(txt(o)), txt(o))
o = await run(`.clone ${BOT}`) // cloning the bot itself
t('cloning the bot is refused', /That's me/.test(txt(o)), txt(o))
const beforeNonOwner = calls.names.length
o = await run('.clone', { from: '2349999999999', group: false, pushName: 'Rando' })
t('non-owner blocked', /owner/i.test(txt(o)) && calls.names.length === beforeNonOwner, txt(o))

console.log('── CLONESTATUS / CLONEINFO ──')
o = await run('.clonestatus Own vibe now')
t('clonestatus sets custom bio', calls.bios.at(-1) === 'Own vibe now', calls.bios.at(-1))
o = await run('.cloneinfo')
t('cloneinfo shows origin', /Micheal/.test(txt(o)), txt(o))
t('cloneinfo shows status override', /Own vibe now/.test(txt(o)) && /overridden/.test(txt(o)), txt(o))

console.log('── UNCLONE ──')
o = await run('.unclone')
t('unclone restores original name', calls.names.at(-1) === 'VENOM MD BOT', calls.names.at(-1))
t('unclone restores original bio', calls.bios.at(-1) === 'Official bot bio', calls.bios.at(-1))
t('unclone restores original picture', calls.pics.at(-1)?.buf === 'ORIGINAL-PP-BYTES', calls.pics.at(-1)?.buf)
t('unclone reply', /UNCLONED/.test(txt(o)), txt(o))
o = await run('.unclone')
t('second unclone is a no-op', /Nothing to undo/.test(txt(o)), txt(o))

await ppServer.close()
console.log(`\n${fail ? `❌ ${fail} failed` : '🎉 all passed'} (${pass} checks)`)
process.exit(fail ? 1 : 0)
