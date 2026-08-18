/**
 * Offline tests for the support-group gate + auto re-add.
 *
 *   node test/forcejoin-test.mjs
 *
 * Drives the real middleware (`before`) and event hook (`onGroupUpdate`)
 * against a fake socket. No network.
 */
import '../test/_isolate.js'
import { loadVars, getVar, setVar } from '../src/lib/vars.js'
import { connectDB } from '../src/lib/database.js'
import configMod from '../src/config.js'
import plugin, { parseInviteCode } from '../plugins/config/forcejoin.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

await connectDB()
await loadVars()

/* ---------------- the user's real link ---------------- */

check(
  'parses the owner\'s link (query junk stripped)',
  parseInviteCode('https://chat.whatsapp.com/JQrMgboto6b3kbySokt8lP?s=cl&p=a&mlu=0') === 'JQrMgboto6b3kbySokt8lP'
)
check('plain link', parseInviteCode('https://chat.whatsapp.com/AbCdEfGhIjKlMnOp1234') === 'AbCdEfGhIjKlMnOp1234')
check('invite/ path works too', parseInviteCode('chat.whatsapp.com/invite/QwErTyUiOp123456') === 'QwErTyUiOp123456')
check('garbage rejected', parseInviteCode('https://wa.me/2348012345678') === null)

/* ------------------ fake world ------------------ */

const GROUP = '120363111222333444@g.us'
const MEMBER = '2348011111111'
const STRANGER = '2348099999999' // can be auto-added (WhatsApp allows it)
const SHY = '2348077777777' // privacy blocks direct adds -> gets the link
const OWNER = '2348000000000'

let adds = []
let dms = []
const fakeSock = {
  user: { id: `${OWNER}:1@s.whatsapp.net`, name: 'TestBot' },
  sendMessage: async (jid, content) => {
    dms.push({ jid, text: content.text || '' })
    return { key: { id: 'K' } }
  },
  groupGetInviteInfo: async (code) => {
    if (code !== parseInviteCode(getVar('SUPPORT_LINK'))) throw new Error('invalid invite')
    return { id: GROUP, subject: 'VENOM SUPPORT' }
  },
  groupMetadata: async (jid) => ({
    id: jid,
    subject: 'VENOM SUPPORT',
    participants: [
      { id: `${OWNER}@s.whatsapp.net`, admin: 'superadmin' },
      { id: `${MEMBER}@s.whatsapp.net`, admin: null }
    ]
  }),
  groupParticipantsUpdate: async (jid, users, action) => {
    adds.push({ jid, users: users.map((u) => String(u)), action })
    const n = String(users[0]).split('@')[0]
    if (n === SHY) return [{ status: '403', jid: users[0] }] // privacy
    return [{ status: '200', jid: users[0] }]
  }
}

const COMMANDS = new Map([['ping', {}]])

const fakeMsg = (senderNumber, body, extra = {}) => {
  const msg = {
    chat: `${senderNumber}@s.whatsapp.net`,
    sender: `${senderNumber}@s.whatsapp.net`,
    senderNumber,
    body,
    fromMe: false,
    isOwner: false,
    isSudo: false,
    reactions: [],
    replies: [],
    react: async (e) => msg.reactions.push(e),
    reply: async (c) => msg.replies.push(c)
  }
  return Object.assign(msg, extra)
}

await setVar('FORCE_JOIN', 'true')
await setVar('FORCE_READD', 'true')
await setVar('FORCE_AUTOADD', 'true')

/* ------------------ gate: member walks straight in ------------------ */

adds = []
dms = []
let stop = await plugin.before({ sock: fakeSock, m: fakeMsg(MEMBER, '.ping'), commands: COMMANDS })
check('member may use commands', stop !== true)
check('member is not auto-added again', adds.length === 0)

/* ------------- the flow the owner asked for ------------- */

// a stranger who USES the bot gets auto-added, and the command runs anyway
let m2 = fakeMsg(STRANGER, '.ping')
stop = await plugin.before({ sock: fakeSock, m: m2, commands: COMMANDS })
check('first-time user is auto-added into the group', adds.length === 1 && adds[0].action === 'add' && adds[0].users[0].includes(STRANGER))
check('their command still runs after the auto-add', stop !== true)
check(
  'welcome DM explains they were added',
  dms.some((d) => d.jid === `${STRANGER}@s.whatsapp.net` && /added you to \*VENOM SUPPORT\*/.test(d.text)),
  JSON.stringify(dms.at(-1)).slice(0, 120)
)

// a stranger whose privacy blocks adds -> gate message + link
dms = []
let m3 = fakeMsg(SHY, '.ping')
stop = await plugin.before({ sock: fakeSock, m: m3, commands: COMMANDS })
check('privacy-blocked stranger is gated', stop === true)
check(
  'gate reply carries the invite link',
  m3.replies.length === 1 && /chat\.whatsapp\.com\/JQrMgboto6b3kbySokt8lP/.test(m3.replies[0]?.text || ''),
  JSON.stringify(m3.replies[0]).slice(0, 140)
)
check('gate reply mentions the stranger', (m3.replies[0]?.mentions || [])[0] === `${SHY}@s.whatsapp.net`)

/* ------------------ anti-spam hardening ------------------ */

// same blocked stranger commands again: no second add attempt, no second card
adds = []
const m3b = fakeMsg(SHY, '.menu')
stop = await plugin.before({ sock: fakeSock, m: m3b, commands: new Map([...COMMANDS, ['menu', {}]]) })
check('repeat within 6h: no second add attempt', adds.length === 0 && stop === true)
check('lock notice is throttled (quiet 🔒 only)', m3b.replies.length === 0 && m3b.reactions.includes('🔒'))

// hourly add budget exhausts -> remaining strangers get the link instead
// (move the clock to a fresh hour first: previous attempts consumed this hour's budget)
const realNow = Date.now
Date.now = () => realNow() + 3700_000
configMod.forceAutoAddHourly = 2
const crowd = ['2348055500001', '2348055500002', '2348055500003']
adds = []
const gates = []
for (const c of crowd) {
  const mm = fakeMsg(c, '.ping')
  const st = await plugin.before({ sock: fakeSock, m: mm, commands: COMMANDS })
  gates.push({ st, replies: mm.replies.length })
}
check('hourly budget: first two strangers added', adds.length === 2)
check('third stranger exceeds budget -> gated with link', gates[2].st === true && gates[2].replies === 1)
Date.now = realNow
configMod.forceAutoAddHourly = 20 // restore

// autoadd off -> no add attempt, just the gate
// (use a fresh number: STRANGER above is now cached as a real member)
const STRANGER2 = '2348066666666'
await setVar('FORCE_AUTOADD', 'false')
adds = []
stop = await plugin.before({ sock: fakeSock, m: fakeMsg(STRANGER2, '.ping'), commands: COMMANDS })
check('autoadd off: no add attempt', adds.length === 0)
check('autoadd off: stranger is gated instead', stop === true)
await setVar('FORCE_AUTOADD', 'true')

/* ------------------ gate hygiene ------------------ */

stop = await plugin.before({ sock: fakeSock, m: fakeMsg(STRANGER, 'hello bot'), commands: COMMANDS })
check('plain chat is not gated', stop !== true)

stop = await plugin.before({ sock: fakeSock, m: fakeMsg(STRANGER, '.nosuchcommand'), commands: COMMANDS })
check('unknown commands pass through unmolested', stop !== true)

stop = await plugin.before({
  sock: fakeSock,
  m: fakeMsg(STRANGER2, '.owner'),
  commands: new Map([['owner', { always: true }]])
})
check('.owner bypasses the gate so people can still reach the creator', stop !== true)

stop = await plugin.before({
  sock: fakeSock,
  m: fakeMsg(STRANGER2, '.pair'),
  commands: new Map([['pair', { always: true }]])
})
check('.pair bypasses the gate so official pairing stays reachable', stop !== true)

stop = await plugin.before({ sock: fakeSock, m: fakeMsg(OWNER, '.ping', { isOwner: true }), commands: COMMANDS })
check('owner is exempt', stop !== true)

stop = await plugin.before({ sock: fakeSock, m: fakeMsg(STRANGER, '.ping', { isSudo: true }), commands: COMMANDS })
check('sudo users are exempt', stop !== true)

await setVar('FORCE_JOIN', 'false')
adds = []
stop = await plugin.before({ sock: fakeSock, m: fakeMsg(STRANGER, '.ping'), commands: COMMANDS })
check('gate off lets everyone through (no adds)', stop !== true && adds.length === 0)
await setVar('FORCE_JOIN', 'true')

/* ------------------ auto re-add on leave ------------------ */

adds = []
await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: GROUP, action: 'add', participants: [`${MEMBER}@s.whatsapp.net`] }
})
check('new joins are not re-added', adds.length === 0)

await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: GROUP, action: 'remove', participants: [`${MEMBER}@s.whatsapp.net`] }
})
check('leaver gets re-added', adds.length === 1 && adds[0].action === 'add' && adds[0].jid === GROUP)

await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: GROUP, action: 'remove', participants: [`${MEMBER}@s.whatsapp.net`] }
})
check('10-minute throttle blocks a re-add war', adds.length === 1)

// other groups are untouched
await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: '999999999999@g.us', action: 'remove', participants: ['2348012345678@s.whatsapp.net'] }
})
check('other groups are ignored', adds.length === 1)

// toggled off -> nobody re-added
await setVar('FORCE_READD', 'false')
await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: GROUP, action: 'remove', participants: [`${MEMBER}@s.whatsapp.net`] }
})
check('readd off leaves people out', adds.length === 1)
await setVar('FORCE_READD', 'true')

// leaver whose privacy blocks adds gets the link in a DM instead
dms = []
await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: GROUP, action: 'remove', participants: [`${SHY}@s.whatsapp.net`] }
})
check(
  'privacy-blocked leaver gets the link via DM',
  dms.some((d) => d.jid === `${SHY}@s.whatsapp.net` && /chat\.whatsapp\.com\/JQrMgboto6b3kbySokt8lP/.test(d.text)),
  JSON.stringify(dms.at(-1)).slice(0, 140)
)

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
