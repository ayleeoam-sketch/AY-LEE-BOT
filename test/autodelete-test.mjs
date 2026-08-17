import './_isolate.js'
import assert from 'node:assert/strict'
import config from '../src/config.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars, getVar, setVar } from '../src/lib/vars.js'
import { loadPlugins, commands, findCommand } from '../src/lib/pluginLoader.js'
import { handleMessage, isCommandCleanup } from '../src/handler.js'

const OWNER = '2348011111111'
const MEMBER = '2348022222222'
const BOT = '2348000000000'
const GROUP = '120363000000000000@g.us'

const sent = []
let outgoing = 0
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, name: 'TestBot' },
  sendMessage: async (jid, content) => {
    const key = { id: `OUT${++outgoing}`, remoteJid: jid, fromMe: true }
    sent.push({ jid, content, key })
    return { key }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  groupMetadata: async (jid) => ({
    id: jid,
    subject: 'Cleanup Test',
    participants: [
      { id: `${OWNER}@s.whatsapp.net`, admin: 'superadmin' },
      { id: `${MEMBER}@s.whatsapp.net`, admin: null },
      { id: `${BOT}@s.whatsapp.net`, admin: 'admin' }
    ]
  }),
  updateMediaMessage: async () => {}
}

let incoming = 0
function raw(body, { from = OWNER, group = true } = {}) {
  const key = {
    remoteJid: group ? GROUP : `${from}@s.whatsapp.net`,
    fromMe: false,
    id: `CMD${++incoming}`,
    participant: group ? `${from}@s.whatsapp.net` : undefined
  }
  return {
    key,
    pushName: 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: body }
  }
}

async function run(body, options) {
  sent.length = 0
  const message = raw(body, options)
  await handleMessage(sock, message)
  return { message, output: [...sent] }
}

const deletedIds = (output) => output.filter((row) => row.content?.delete).map((row) => row.content.delete.id)

await connectDB()
await loadVars()
await loadPlugins()
config.ownerNumbers = [OWNER]

const previous = {
  cleanup: getVar('AUTO_DELETE_COMMANDS'),
  react: getVar('CMD_REACT'),
  mode: getVar('MODE')
}

try {
  await setVar('AUTO_DELETE_COMMANDS', 'false')
  await setVar('CMD_REACT', 'false')
  await setVar('MODE', 'public')

  assert.equal(findCommand('del')?.name, 'delete', '.del must resolve to the cleanup/delete command')

  // Turning cleanup on removes both its own confirmation and command message.
  let result = await run('.del on')
  assert.equal(getVar('AUTO_DELETE_COMMANDS'), true)
  const onReply = result.output.find((row) => /cleanup turned \*on\*/i.test(row.content?.text || ''))
  assert.ok(onReply, '.del on should send a confirmation before cleaning it')
  assert.ok(deletedIds(result.output).includes(onReply.key.id), 'the confirmation should be deleted')
  assert.ok(deletedIds(result.output).includes(result.message.key.id), 'the .del on command should be deleted')
  assert.equal(isCommandCleanup(result.message.key), true, 'intentional cleanup must be marked for anti-delete')

  // Every normal command reply is removed along with its trigger while enabled.
  result = await run('.ping')
  const pingReply = result.output.find((row) => /ping|pong/i.test(row.content?.text || ''))
  assert.ok(pingReply)
  assert.ok(deletedIds(result.output).includes(pingReply.key.id))
  assert.ok(deletedIds(result.output).includes(result.message.key.id))

  // Plugins that call sock.sendMessage directly are tracked too.
  result = await run('.hidetag direct reply')
  const directReply = result.output.find((row) => row.content?.text === 'direct reply')
  assert.ok(directReply)
  assert.ok(deletedIds(result.output).includes(directReply.key.id))
  assert.ok(deletedIds(result.output).includes(result.message.key.id))

  // Exercise the same keep-private path used by .vvpr: private media survives,
  // while the public "check your DM" confirmation and command are cleaned.
  commands.set('cleanupfixture', {
    name: 'cleanupfixture',
    async run({ m }) {
      await m.send({ image: Buffer.from('private') }, { jid: m.sender, keep: true })
      await m.reply('🔒 Sent privately — check your DM with the bot.')
    }
  })
  result = await run('.cleanupfixture')
  const privateMedia = result.output.find((row) => row.jid === `${OWNER}@s.whatsapp.net` && row.content?.image)
  const publicConfirmation = result.output.find((row) => /check your DM/i.test(row.content?.text || ''))
  assert.ok(privateMedia, 'the private media should be sent')
  assert.ok(publicConfirmation, 'the public confirmation should be sent before cleanup')
  assert.ok(!deletedIds(result.output).includes(privateMedia.key.id), 'private media must not be deleted')
  assert.ok(deletedIds(result.output).includes(publicConfirmation.key.id), 'public confirmation should be deleted')
  assert.ok(deletedIds(result.output).includes(result.message.key.id), 'the invoking command should be deleted')

  // Turning cleanup off takes effect before final cleanup, so that command and
  // its confirmation stay visible, as requested.
  result = await run('.del off')
  assert.equal(getVar('AUTO_DELETE_COMMANDS'), false)
  assert.equal(deletedIds(result.output).length, 0)
  assert.ok(result.output.some((row) => /cleanup turned \*off\*/i.test(row.content?.text || '')))

  result = await run('.ping')
  assert.equal(deletedIds(result.output).length, 0, 'commands must remain visible while cleanup is off')

  // Ordinary users cannot change the bot-wide setting.
  result = await run('.del on', { from: MEMBER })
  assert.equal(getVar('AUTO_DELETE_COMMANDS'), false)
  assert.ok(result.output.some((row) => /Only the owner/i.test(row.content?.text || '')))

  console.log('✅ .del on/off cleans command replies while preserving .vvpr private media')
} finally {
  commands.delete('cleanupfixture')
  await setVar('AUTO_DELETE_COMMANDS', String(previous.cleanup))
  await setVar('CMD_REACT', String(previous.react))
  await setVar('MODE', String(previous.mode))
}
