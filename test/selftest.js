/**
 * Offline self-test: boots every subsystem except the WhatsApp socket,
 * fakes a few messages through the real handler, and prints the results.
 *
 *   node test/selftest.js
 */
import './_isolate.js'   // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars, getVar, setVar } from '../src/lib/vars.js'
import { loadPlugins, commands, categories, pluginCount, findCommand } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  if (cond) {
    console.log(`  ✅ ${label}`)
    pass++
  } else {
    console.log(`  ❌ ${label} ${extra}`)
    fail++
  }
}

/* ------------------------- fake socket ------------------------- */
const sent = []
const fakeSock = {
  user: { id: '2348000000000:1@s.whatsapp.net', name: 'TestBot' },
  sendMessage: async (jid, content) => {
    sent.push({ jid, content })
    return { key: { id: `FAKE${sent.length}`, remoteJid: jid, fromMe: true } }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  groupMetadata: async (jid) => ({
    id: jid,
    subject: 'Test Group',
    owner: '2348011111111@s.whatsapp.net',
    creation: 1700000000,
    participants: [
      { id: '2348011111111@s.whatsapp.net', admin: 'superadmin' },
      { id: '2348022222222@s.whatsapp.net', admin: null },
      { id: '2348000000000@s.whatsapp.net', admin: 'admin' }
    ]
  }),
  groupParticipantsUpdate: async () => [{ status: '200' }],
  updateMediaMessage: async () => {}
}

const makeMsg = (body, { group = false, from = '2348011111111' } = {}) => ({
  key: {
    remoteJid: group ? '120363000000000000@g.us' : `${from}@s.whatsapp.net`,
    fromMe: false,
    id: `MSG${Math.random().toString(36).slice(2, 10)}`,
    participant: group ? `${from}@s.whatsapp.net` : undefined
  },
  pushName: 'Tester',
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: body }
})

const run = async (body, opts) => {
  sent.length = 0
  await handleMessage(fakeSock, makeMsg(body, opts))
  return sent
}

// media messages carry their text in `caption`, not `text` (e.g. the menu,
// which is sent as an image), so read both.
const textOf = (out) =>
  out
    .map((s) => s.content?.text || s.content?.caption || JSON.stringify(s.content).slice(0, 80))
    .join('\n---\n')

/* ---------------------------- tests ---------------------------- */
console.log('\n═══ WhatsApp Bot Self-Test ═══\n')

console.log('1. Boot')
await connectDB()
await loadVars()
await loadPlugins()
check('plugins loaded', pluginCount() > 0, `(got ${pluginCount()})`)
check('categories built', categories.size > 0, `(got ${categories.size})`)
check('command index built', commands.size > 0, `(got ${commands.size} names+aliases)`)

console.log('\n2. Plugin integrity')
const all = [...new Set([...commands.values()])]
const noDesc = all.filter((p) => !p.desc)
const noRun = all.filter((p) => typeof p.run !== 'function')
check('every plugin has run()', noRun.length === 0, noRun.map((p) => p.name).join(','))
check('every plugin has a description', noDesc.length === 0, noDesc.map((p) => p.name).join(','))
check('aliases resolve', findCommand('p')?.name === 'ping')
check('alias "help" -> menu', findCommand('help')?.name === 'menu')

console.log('\n3. Config vars')
check('MODE default is public', getVar('MODE') === 'public', `(got ${getVar('MODE')})`)
await setVar('CMD_REACT_EMOJI', '🔥')
check('setVar persists', getVar('CMD_REACT_EMOJI') === '🔥')
await setVar('CMD_REACT_EMOJI', '⚡')

console.log('\n4. Command execution (DM, owner)')
config.ownerNumbers = ['2348011111111']

let out = await run('.ping')
check('.ping replies', out.length > 0 && /Ping|Pong/i.test(textOf(out)))

out = await run('.menu')
const menu = textOf(out)
check('.menu replies', out.length > 0)
check('.menu shows the header box', menu.includes('┌────═━┈'))
// reactions are sent first, so find the real message rather than assuming index 0
check(
  '.menu is sent as an image with a caption',
  out.some((s) => s.content?.image && s.content?.caption)
)
check('.menu shows the original creator number', menu.includes('2348021016309'))
const menuCaption = out.find((s) => s.content?.caption)?.content.caption || ''
check('.menu does not advertise the deployer number', menuCaption.includes('2348021016309') && !menuCaption.includes('2348011111111'))
check('.menu advertises how to get a bot', /Want your own VENOM MD bot/i.test(menu) && /\.pair/i.test(menu))
check('.menu shows plugin count', /Plugins: \d+/.test(menu))
check('.menu shows uptime', /Uptime: /.test(menu))
check('.menu renders category blocks', menu.includes('┏') && menu.includes('┕'))
check('.menu lists ping', menu.includes('𝘱𝘪𝘯𝘨'), '(italic font conversion)')

out = await run('.menu bot')
check('.menu <category> filters', textOf(out).includes('𝘱𝘪𝘯𝘨') && !textOf(out).includes('𝘢𝘯𝘵𝘪𝘭𝘪𝘯𝘬'))

out = await run('.menu ping')
check('.menu <command> shows help card', /Category: BOT/.test(textOf(out)))

out = await run('.owner')
const creatorCard = out.find((s) => s.content?.contacts)?.content?.contacts?.contacts?.[0]?.vcard || ''
check('.owner advertises the original creator', /ORIGINAL VENOM MD CREATOR/.test(textOf(out)))
check('.owner always uses the creator number', /waid=2348021016309/.test(creatorCard))
check('.owner never exposes the deployer number', !creatorCard.includes('2348011111111'))
check('.owner tells people to .pair', /\.pair/.test(textOf(out)))

out = await run('.getbot')
check('.getbot explains official pair + group', /GET YOUR OWN VENOM MD/.test(textOf(out)) && /JQrMgboto6b3kbySokt8lP/.test(textOf(out)))

out = await run('.pair')
check('.pair refuses on a deployer copy', /official/i.test(textOf(out)))

out = await run('.voiceclone')
check('.voiceclone asks for a voice note', /voice note/i.test(textOf(out)) && /voiceclone/i.test(textOf(out)))

out = await run('.autodeploy')
check('.autodeploy is hub-only or explains paste', /official|AUTO DEPLOY/i.test(textOf(out)))

out = await run('.ping')
check('every command reply carries the get-bot footer', /Want this bot\? \*\.owner\* then \*\.pair\*/.test(textOf(out)))

out = await run('.stats')
check('.stats replies', /Plugins:/.test(textOf(out)))

out = await run('.totalusers')
check('.totalusers shows the network card', /VENOM NETWORK|Unique people/i.test(textOf(out)))

out = await run('.allvar')
check('.allvar lists settings', /MODE/.test(textOf(out)))

console.log('\n5. Permissions')
out = await run('.ban 2348099999999', { from: '2348022222222' })
check('non-owner blocked from .ban', out.length === 0 || /owner only/i.test(textOf(out)))

out = await run('.kick @2348022222222')
check('.kick refused in DM', /only works in groups/i.test(textOf(out)))

out = await run('.tagall', { group: true, from: '2348022222222' })
check('.tagall refused for non-admin', /admin/i.test(textOf(out)))

out = await run('.tagall hello', { group: true, from: '2348011111111' })
check('.tagall works for admin', /ATTENTION/i.test(textOf(out)))

out = await run('.ginfo', { group: true })
check('.ginfo reads group metadata', /Test Group/.test(textOf(out)))

console.log('\n6. Routing edge cases')
out = await run('hello there')
check('plain text ignored', out.length === 0)
out = await run('.notarealcommand')
check('unknown command ignored', out.length === 0)
out = await run('.')
check('bare prefix ignored', out.length === 0)
out = await run('.PING')
check('commands are case-insensitive', out.length > 0)

console.log('\n7. Mode gating')
await setVar('MODE', 'private')
out = await run('.ping', { from: '2348022222222' })
check('private mode blocks strangers', out.length === 0)
out = await run('.ping', { from: '2348011111111' })
check('private mode allows owner', out.length > 0)
out = await run('.owner', { from: '2348022222222' })
check('private mode still allows .owner so people can get the bot', /ORIGINAL VENOM MD CREATOR/.test(textOf(out)))
out = await run('.pair', { from: '2348022222222' })
check('private mode still allows .pair (hub-gated, not mode-gated)', out.length > 0)
await setVar('MODE', 'public')

console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`)
process.exit(fail ? 1 : 0)
