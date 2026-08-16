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
  parseInviteCode('https://chat.whatsapp.com/DYCYPJ602Un8ibZbMAnle7?s=cl&p=a&mlu=0') === 'DYCYPJ602Un8ibZbMAnle7'
)
check('plain link', parseInviteCode('https://chat.whatsapp.com/AbCdEfGhIjKlMnOp1234') === 'AbCdEfGhIjKlMnOp1234')
check('invite/ path works too', parseInviteCode('chat.whatsapp.com/invite/QwErTyUiOp123456') === 'QwErTyUiOp123456')
check('garbage rejected', parseInviteCode('https://wa.me/2348012345678') === null)

/* ------------------ fake world ------------------ */

const GROUP = '120363111222333444@g.us'
const MEMBER = '2348011111111'
const STRANGER = '2348099999999'
const OWNER = '2348000000000' // matches fakeSock.user.id -> fromMe/owner exempt path uses isOwner flag

let adds = []
const fakeSock = {
  user: { id: `${OWNER}:1@s.whatsapp.net`, name: 'TestBot' },
  sendMessage: async () => ({ key: { id: 'K' } }),
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
    return [{ status: '200', jid: users[0] }]
  }
}

const COMMANDS = new Map([['ping', {}]])

const fakeMsg = (senderNumber, body, extra = {}) => ({
  chat: `${senderNumber}@s.whatsapp.net`,
  sender: `${senderNumber}@s.whatsapp.net`,
  senderNumber,
  body,
  fromMe: false,
  isOwner: false,
  isSudo: false,
  react: async () => {},
  reply: async (c) => {
    fakeMsg.lastReply = c
  },
  ...extra
})

await setVar('FORCE_JOIN', 'true')
await setVar('FORCE_READD', 'true')

/* ------------------ gate: command parsing ------------------ */

// member with a real command -> allowed
let m1 = fakeMsg(MEMBER, '.ping')
let stop = await plugin.before({ sock: fakeSock, m: m1, commands: COMMANDS })
check('member may use commands', stop !== true)

// stranger with a command -> blocked + invite sent
let m2 = fakeMsg(STRANGER, '.ping')
stop = await plugin.before({ sock: fakeSock, m: m2, commands: COMMANDS })
check('stranger is blocked', stop === true)
check(
  'blocked reply carries the invite',
  /chat\.whatsapp\.com\/DYCYPJ602Un8ibZbMAnle7/.test(fakeMsg.lastReply?.text || ''),
  JSON.stringify(fakeMsg.lastReply).slice(0, 140)
)
check('blocked reply mentions the stranger', (fakeMsg.lastReply?.mentions || [])[0] === `${STRANGER}@s.whatsapp.net`)

// plain chat from a stranger -> ignored (no gate spam)
let m3 = fakeMsg(STRANGER, 'hello bot')
stop = await plugin.before({ sock: fakeSock, m: m3, commands: COMMANDS })
check('plain chat is not gated', stop !== true)

// unknown command from a stranger -> not gated (it was never going to run)
let m4 = fakeMsg(STRANGER, '.nosuchcommand')
stop = await plugin.before({ sock: fakeSock, m: m4, commands: COMMANDS })
check('unknown commands pass through unmolested', stop !== true)

// exempt: owner
let m5 = fakeMsg(OWNER, '.ping', { isOwner: true })
stop = await plugin.before({ sock: fakeSock, m: m5, commands: COMMANDS })
check('owner is exempt', stop !== true)

// exempt: sudo
let m6 = fakeMsg(STRANGER, '.ping', { isSudo: true })
stop = await plugin.before({ sock: fakeSock, m: m6, commands: COMMANDS })
check('sudo users are exempt', stop !== true)

// gate off -> stranger allowed
await setVar('FORCE_JOIN', 'false')
stop = await plugin.before({ sock: fakeSock, m: fakeMsg(STRANGER, '.ping'), commands: COMMANDS })
check('gate off lets everyone through', stop !== true)
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
plugin.onGroupUpdate._readds = new Map() // reset throttle for the check
await plugin.onGroupUpdate({
  sock: fakeSock,
  event: { id: GROUP, action: 'remove', participants: [`${MEMBER}@s.whatsapp.net`] }
})
check('readd off leaves people out', adds.length === 1)
await setVar('FORCE_READD', 'true')

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
