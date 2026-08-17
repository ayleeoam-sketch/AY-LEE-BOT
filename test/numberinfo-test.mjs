import assert from 'node:assert/strict'
import trackCommand, { inspectNumber, numberFrom } from '../plugins/utilities/numberinfo.js'

const nigeria = inspectNumber('2348021016309')
assert.ok(nigeria)
assert.equal(nigeria.phone.number, '+2348021016309')
assert.equal(nigeria.countryCode, 'NG')
assert.equal(nigeria.country, 'Nigeria')
assert.equal(nigeria.type, 'Mobile')
assert.equal(nigeria.phone.isValid(), true)

assert.equal(inspectNumber('08021016309'), null, 'local numbers must require a country code')
assert.equal(inspectNumber('123'), null, 'short input must be rejected')
assert.equal(numberFrom({ mentions: ['2348021016309@s.whatsapp.net'] }, ''), '2348021016309')
assert.equal(numberFrom({ mentions: [], quoted: { senderNumber: '14155552671' } }, ''), '14155552671')

// Command output includes useful public metadata and an honest location limit.
{
  const replies = []
  let checked = null
  const m = {
    mentions: [],
    quoted: null,
    reply: async (content) => replies.push(content)
  }
  const sock = {
    onWhatsApp: async (number) => {
      checked = number
      return [{ jid: `${number}@s.whatsapp.net`, exists: true }]
    }
  }

  await trackCommand.run({ sock, m, text: '2348021016309' })

  assert.equal(checked, '2348021016309')
  assert.equal(replies.length, 1)
  assert.match(replies[0], /Full number: \+2348021016309/)
  assert.match(replies[0], /Country\/region: Nigeria \(NG\)/)
  assert.match(replies[0], /Type: Mobile/)
  assert.match(replies[0], /WhatsApp: Registered/)
  assert.match(replies[0], /cannot reveal an exact address or live GPS location/i)
  assert.match(replies[0], /\.requestloc 2348021016309/)
}

// A local-format number gets a clear correction instead of a fake result.
{
  const replies = []
  const m = {
    mentions: [],
    quoted: null,
    reply: async (content) => replies.push(content)
  }

  await trackCommand.run({ sock: {}, m, text: '08021016309' })
  assert.match(replies[0], /full international number/i)
  assert.match(replies[0], /2348021016309/)
}

// Exact coordinates are forwarded only after the target receives a request
// and voluntarily shares a location in the bot's private DM.
{
  const requester = '2348011111111@s.whatsapp.net'
  const target = '2348021016309@s.whatsapp.net'
  const requestReplies = []
  const sent = []
  const sock = {
    onWhatsApp: async () => [{ jid: target, exists: true }],
    sendMessage: async (jid, content) => {
      sent.push({ jid, content })
      return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } }
    }
  }
  const requestMessage = {
    mentions: [target],
    quoted: null,
    sender: requester,
    senderNumber: '2348011111111',
    botNumber: '2348000000000',
    reply: async (content) => requestReplies.push(content)
  }

  await trackCommand.run({
    sock,
    m: requestMessage,
    text: '@2348021016309',
    command: 'requestloc'
  })

  const consentPrompt = sent.find((row) => row.jid === target)?.content?.text || ''
  assert.match(consentPrompt, /Only if you consent/i)
  assert.match(consentPrompt, /expires in 10 minutes/i)
  assert.ok(requestReplies.some((reply) => /Nothing is tracked without their consent/i.test(reply.text || reply)))

  const targetReplies = []
  const beforeResult = await trackCommand.before({
    sock,
    m: {
      isGroup: false,
      type: 'locationMessage',
      sender: target,
      senderNumber: '2348021016309',
      msg: {
        degreesLatitude: 6.5244,
        degreesLongitude: 3.3792,
        accuracyInMeters: 12,
        name: 'Shared place',
        address: 'Lagos, Nigeria'
      },
      reply: async (content) => targetReplies.push(content)
    }
  })

  assert.equal(beforeResult, false)
  const forwardedText = sent.find(
    (row) => row.jid === requester && /LOCATION SHARED WITH CONSENT/.test(row.content?.text || '')
  )?.content?.text
  const forwardedMap = sent.find((row) => row.jid === requester && row.content?.location)?.content?.location
  assert.match(forwardedText, /Latitude: 6\.5244/)
  assert.match(forwardedText, /Longitude: 3\.3792/)
  assert.match(forwardedText, /Accuracy: about 12 m/)
  assert.match(forwardedText, /maps\.google\.com\/\?q=6\.5244,3\.3792/)
  assert.equal(forwardedMap.degreesLatitude, 6.5244)
  assert.equal(forwardedMap.degreesLongitude, 3.3792)
  assert.ok(targetReplies.some((reply) => /not saved to the bot database/i.test(reply.text || reply)))

  // The request is one-time: sharing again does not forward another location.
  const sentBefore = sent.length
  await trackCommand.before({
    sock,
    m: {
      isGroup: false,
      type: 'locationMessage',
      sender: target,
      senderNumber: '2348021016309',
      msg: { degreesLatitude: 1, degreesLongitude: 2 },
      reply: async () => {}
    }
  })
  assert.equal(sent.length, sentBefore)
}

// A target can explicitly decline without revealing anything.
{
  const requester = '14155552671@s.whatsapp.net'
  const target = '447911123456@s.whatsapp.net'
  const sent = []
  const sock = {
    onWhatsApp: async () => [{ jid: target, exists: true }],
    sendMessage: async (jid, content) => {
      sent.push({ jid, content })
      return { key: { id: `D${sent.length}`, remoteJid: jid, fromMe: true } }
    }
  }

  await trackCommand.run({
    sock,
    command: 'requestloc',
    text: '447911123456',
    m: {
      mentions: [], quoted: null, sender: requester, senderNumber: '14155552671', botNumber: '1',
      reply: async () => {}
    }
  })

  const declineReplies = []
  await trackCommand.run({
    sock,
    command: 'track',
    text: 'cancel',
    m: {
      mentions: [], quoted: null, sender: target, senderNumber: '447911123456',
      reply: async (content) => declineReplies.push(content)
    }
  })
  assert.match(declineReplies[0], /declined/i)
  assert.ok(sent.some((row) => row.jid === requester && /declined the location request/i.test(row.content?.text || '')))

  const beforeCount = sent.length
  await trackCommand.before({
    sock,
    m: {
      isGroup: false,
      type: 'locationMessage',
      sender: target,
      senderNumber: '447911123456',
      msg: { degreesLatitude: 51.5, degreesLongitude: -0.1 },
      reply: async () => {}
    }
  })
  assert.equal(sent.length, beforeCount, 'declined location must not be forwarded')
}

console.log('✅ .track reports safe metadata and forwards exact location only with consent')
