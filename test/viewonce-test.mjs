import assert from 'node:assert/strict'
import toolCommands from '../plugins/tools/misc.js'

const vvpr = toolCommands.find((command) => command.name === 'vvpr')
assert.ok(vvpr, 'vvpr command must be registered')

const media = Buffer.from('private view-once fixture')
const sender = '2348022222222@s.whatsapp.net'

function message({ type = 'imageMessage', isGroup = true, download = async () => media } = {}) {
  const replies = []
  return {
    replies,
    m: {
      sender,
      isGroup,
      quoted: {
        type,
        msg: type === 'audioMessage' ? { mimetype: 'audio/ogg; codecs=opus' } : {},
        download
      },
      reply: async (content) => {
        replies.push(content)
      }
    }
  }
}

// A group request must send the recovered file only to the requesting user's DM.
{
  const { m, replies } = message()
  const sent = []
  const sock = {
    sendMessage: async (jid, content) => sent.push({ jid, content })
  }

  await vvpr.run({ m, sock })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].jid, sender)
  assert.equal(sent[0].content.image, media)
  assert.match(sent[0].content.caption, /privately/i)
  assert.ok(replies.some((reply) => /check your DM/i.test(reply)))
  assert.ok(
    replies.every((reply) => !reply?.image && !reply?.video && !reply?.audio),
    'recovered media must never be posted in the public group'
  )
}

// In an existing DM, send the media once without an unnecessary confirmation.
{
  const { m, replies } = message({ type: 'videoMessage', isGroup: false })
  const sent = []
  const sock = {
    sendMessage: async (jid, content) => sent.push({ jid, content })
  }

  await vvpr.run({ m, sock })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].jid, sender)
  assert.equal(sent[0].content.video, media)
  assert.equal(replies.length, 0)
}

// Voice notes use the same WhatsApp payload as the existing public reveal.
{
  const { m } = message({ type: 'audioMessage' })
  const sent = []
  const sock = {
    sendMessage: async (jid, content) => sent.push({ jid, content })
  }

  await vvpr.run({ m, sock })

  assert.equal(sent[0].jid, sender)
  assert.equal(sent[0].content.audio, media)
  assert.equal(sent[0].content.mimetype, 'audio/mpeg')
  assert.equal(sent[0].content.ptt, true)
}

// Calling the command without replying gives clear instructions and sends no DM.
{
  const replies = []
  const sent = []
  const m = {
    sender,
    isGroup: true,
    quoted: null,
    reply: async (content) => replies.push(content)
  }
  const sock = {
    sendMessage: async (jid, content) => sent.push({ jid, content })
  }

  await vvpr.run({ m, sock })

  assert.equal(sent.length, 0)
  assert.match(replies[0], /Reply to a view-once message with \*\.vvpr\*/)
}

console.log('✅ vvpr sends view-once media only to the requester’s private DM')
