/**
 * Offline test for the .cmds command directory.
 *
 *   node test/directory-test.mjs
 *
 * Loads every plugin, runs .cmds through the real handler and checks that
 * the output maps the whole bot: header, every category, the owner section
 * and the copy-paste hints.
 */
import './_isolate.js' // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins, categories, findCommand } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'

const OWNER = '2340000000001'
const BOT = '2348000000000'

const sent = []
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, name: 'VENOM MD BOT' },
  sendMessage: async (jid, content) => {
    sent.push(content)
    return { key: { id: 'X' + Math.random(), remoteJid: jid, fromMe: true } }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {}
}

const build = (body) => ({
  key: { remoteJid: `${OWNER}@s.whatsapp.net`, fromMe: false, id: 'M' + Math.random().toString(36).slice(2) },
  pushName: 'Micheal',
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: body }
})
const run = async (body) => {
  sent.length = 0
  await handleMessage(sock, build(body))
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

console.log(`\n═══ .cmds DIRECTORY — offline test ═══\n`)

const o = await run('.cmds')
const out = txt(o)

t('renders the directory header', /COMMAND DIRECTORY/.test(out), out)
t('shows category and command totals', /categories · \d+ commands/.test(out), out)
t('every category appears', [...categories.keys()].every((c) => out.includes(c)), out)
t('SPORTS section present with count', /SPORTS\* \(\d+\)/.test(out), out)
t('sports points at .menu sports', /menu sports/.test(out), out)
t('owner section present', /OWNER ONLY/.test(out), out)
t('owner section lists real owner commands', /.ban/.test(out) && /.setpp/.test(out), out)
t('flagship owner commands surface first', /.clone/.test(out) && /.predkey/.test(out), out)
t('owner section notes the hidden rest', /\+\d+ more/.test(out), out)
t('quick-start block present', /START HERE/.test(out) && /pred/.test(out) && /ping/.test(out), out)
t('creator footer present', /wa\.me/.test(out), out)
t('message is one reply, not spam', o.length === 1, o.length)

// the prediction alias must not steal the economy .bet (gamble) command
const bet = findCommand('bet')
t('.bet still belongs to the economy gamble command', bet?.name === 'gamble', bet?.name)

console.log(`\n${fail ? `❌ ${fail} failed` : '🎉 all passed'} (${pass} checks)`)
process.exit(fail ? 1 : 0)
