import assert from 'node:assert/strict'
import toolCommands from '../plugins/tools/misc.js'

const vvpr = toolCommands.find((command) => command.name === 'vvpr')
assert.ok(vvpr, 'vvpr command must be registered')

const media = Buffer.from('private view-once fixture')
const sender = '2348022222222@s.whatsapp.net'

function message({ type = 'imageMessage', isGroup = true, download = async () => media } = {}) {
  const replies = []
  const privateMessages = []
  return {
    replies,
    privateMessages,
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
      },
      send: async (content, options) => {
        privateMessages.push({ jid: options.jid, content, options })
      }
    }
  }
}

// A group request must send the recovered file only to the requesting user's DM.
{
  const { m, replies, privateMessages } = message()
  await vvpr.run({ m })

  assert.equal(privateMessages.length, 1)
  assert.equal(privateMessages[0].jid, sender)
  assert.equal(privateMessages[0].content.image, media)
  assert.equal(privateMessages[0].options.keep, true)
  assert.match(privateMessages[0].content.caption, /privately/i)
  assert.ok(replies.some((reply) => /check your DM/i.test(reply)))
  assert.ok(
    replies.every((reply) => !reply?.image && !reply?.video && !reply?.audio),
    'recovered media must never be posted in the public group'
  )
}

// In an existing DM, send the media once without an unnecessary confirmation.
{
  const { m, replies, privateMessages } = message({ type: 'videoMessage', isGroup: false })
  await vvpr.run({ m })

  assert.equal(privateMessages.length, 1)
  assert.equal(privateMessages[0].jid, sender)
  assert.equal(privateMessages[0].content.video, media)
  assert.equal(replies.length, 0)
}

// Voice notes use the same WhatsApp payload as the existing public reveal.
{
  const { m, privateMessages } = message({ type: 'audioMessage' })
  await vvpr.run({ m })

  assert.equal(privateMessages[0].jid, sender)
  assert.equal(privateMessages[0].content.audio, media)
  assert.equal(privateMessages[0].content.mimetype, 'audio/mpeg')
  assert.equal(privateMessages[0].content.ptt, true)
}

// Calling the command without replying gives clear instructions and sends no DM.
{
  const replies = []
  const privateMessages = []
  const m = {
    sender,
    isGroup: true,
    quoted: null,
    reply: async (content) => replies.push(content),
    send: async (content, options) => privateMessages.push({ content, options })
  }

  await vvpr.run({ m })

  assert.equal(privateMessages.length, 0)
  assert.match(replies[0], /Reply to a view-once message with \*\.vvpr\*/)
}

console.log('✅ vvpr sends view-once media only to the requester’s private DM')
