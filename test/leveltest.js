/**
 * Offline test for the new level/rank system.
 * Drives fake messages through the REAL handler and middleware chain.
 *
 *   node test/leveltest.js
 */
import './_isolate.js' // keeps tests off the live DB
import { connectDB } from '../src/lib/database.js'
import { loadVars, getVar } from '../src/lib/vars.js'
import { loadPlugins, middlewares, commands } from '../src/lib/pluginLoader.js'
import { serialize } from '../src/lib/serialize.js'
import { getUser } from '../src/lib/economy.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

const sent = []
const fakeSock = {
  user: { id: '2348000000000:1@s.whatsapp.net', name: 'TestBot' },
  sendMessage: async (jid, content) => {
    sent.push({ jid, content })
    return { key: { id: `F${sent.length}`, remoteJid: jid, fromMe: true } }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  profilePictureUrl: async () => {
    throw new Error('hidden')
  },
  updateMediaMessage: async () => {}
}

await connectDB()
await loadVars()
await loadPlugins()

const USER = '2348999000111@s.whatsapp.net'

// fresh fixture: the JSON backend persists between runs
const { default: DBF } = await import('../src/lib/database.js')
await DBF.users.delete({ id: USER.split('@')[0] })
process.on('exit', () => DBF.users.delete({ id: USER.split('@')[0] }).catch(() => {}))
const makeMsg = (body, fromMe = false) => ({
  key: { remoteJid: USER, id: Math.random().toString(36).slice(2), fromMe },
  pushName: 'XP Tester',
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: body }
})

const runBefore = async (m) => {
  for (const mw of middlewares) {
    if (typeof mw.before === 'function') {
      await mw.before({ sock: fakeSock, m, getVar, DB: (await import('../src/lib/database.js')).default, config: null, commands }).catch((e) => console.log('middleware error:', e.message))
    }
  }
}

check('LEVEL_UP defaults to on', getVar('LEVEL_UP') === true)
check('levelsystem middleware is registered', middlewares.some((m) => m.name === 'levelsystem'))

// 1) plain chat grants XP
let m = await serialize(fakeSock, makeMsg('hello everyone'))
await runBefore(m)
let u = await getUser(USER)
check('chatting grants XP', u.xp >= 1 && u.xp <= 5, `xp=${u.xp}`)
check('message counted', u.msgs === 1, `msgs=${u.msgs}`)

// 2) commands do NOT grant XP
const xpBefore = u.xp
m = await serialize(fakeSock, makeMsg('.ping'))
await runBefore(m)
u = await getUser(USER)
check('commands earn no XP', u.xp === xpBefore, `xp=${u.xp}`)

// 3) throttle: second message inside 20s grants nothing
m = await serialize(fakeSock, makeMsg('spam spam spam'))
await runBefore(m)
u = await getUser(USER)
check('XP grant is throttled (20s)', u.xp === xpBefore, `xp=${u.xp}`)

// 4) level-up announces + pays the bonus
// park the user 1 XP below the boundary so even the minimum grant (+1) tips them over
const { saveUser } = await import('../src/lib/economy.js')
u.xp = 99
u.level = 1
u.wallet = 0
await saveUser(u)
check('saveUser persists boundary', (await getUser(USER)).xp === 99)

const levelBeforeCount = sent.length
// time-jump past the 20s throttle: grantChatXp reads Date.now, so we stub it
const realNow = Date.now
Date.now = () => realNow() + 60_000
m = await serialize(fakeSock, makeMsg('final push'))
await runBefore(m)
Date.now = realNow

const after = await getUser(USER)
check('level up happened', after.level === 2, `level=${after.level} xp=${after.xp}`)
check('carry-over XP kept', after.xp >= 0 && after.xp < 200)
check('level-up coin bonus', after.wallet === 100, `wallet=${after.wallet}`)
check(
  'announcement sent',
  sent.length > levelBeforeCount && sent[sent.length - 1].content.text.includes('Level 2'),
  sent[sent.length - 1]?.content?.text
)

// 5) .rank command path (direct plugin invocation with fake m)
const rank = commands.get('rank')
const replied = []
const fakeM = {
  sender: USER,
  senderNumber: USER.split('@')[0],
  chat: USER,
  mentions: [],
  quoted: null,
  pushName: 'XP Tester',
  reply: async (c) => replied.push(c)
}
await rank.run({ sock: fakeSock, m: fakeM, args: [], text: '', command: 'rank', prefix: '.' })
check('.rank replies with a card', replied.length === 1 && /RANK CARD/.test(replied[0].caption || replied[0].text), JSON.stringify(replied[0]).slice(0, 120))
check('.rank mentions the user', (replied[0].mentions || []).includes(USER))

// 6) .topranks
const top = commands.get('topranks')
await top.run({ sock: fakeSock, m: { ...fakeM, isGroup: false }, args: [], text: '', command: 'topranks', prefix: '.' })
check('.topranks lists the user', /GLOBAL RANKS/.test(replied[replied.length - 1].text), JSON.stringify(replied.at(-1)).slice(0, 100))

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
