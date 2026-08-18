import './_isolate.js'
import { cleanPhone, startPairing, jobFor } from '../src/lib/pair.js'
import { makeToken, isToken, saveSession, readSession } from '../src/lib/deployStore.js'

let pass = 0, fail = 0
const t = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

t('strips plus and spaces', cleanPhone('+234 801 234 5678') === '2348012345678')
t('rejects letters', cleanPhone('hello') === '')

const bad = await startPairing({ phone: '123' })
t('short number is refused without opening WhatsApp', bad.ok === false && /international/.test(bad.error))

t('no leftover job after a rejected number', jobFor('123') === null)

const token = makeToken()
t('token looks like VNM-XXXXXX', isToken(token))

const saved = await saveSession({
  phone: '2348012345678',
  sessionId: Buffer.from(JSON.stringify({ noiseKey: { private: { type: 'Buffer', data: [1] } }, me: { id: 'x' } })).toString('base64'),
  ownerName: 'Micheal'
})
t('saveSession returns a token', isToken(saved))
const row = await readSession(saved)
t('readSession returns the creds', Boolean(row?.sessionId) && row.phone === '2348012345678')

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
