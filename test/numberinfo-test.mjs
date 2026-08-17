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
  assert.match(replies[0], /cannot reveal an exact address, live GPS location/i)
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

console.log('✅ .track reports safe phone metadata without claiming live location')
