/** Offline tests for branding, footers, tokens and YouTube URL extraction. */
import './_isolate.js'
import { CREATOR, commandFooter, withCommandFooter, alreadyHasAd, isCreatorHub } from '../src/branding.js'
import { extractYoutubeUrl, extractYoutubeId } from '../src/lib/downloader.js'
import { makeToken, isToken, parseSessionPayload, decodeSessionId } from '../src/lib/deployStore.js'
import { detectLang } from '../src/lib/voiceclone.js'
import { resolveDeployInput, hostedList } from '../src/lib/hosted.js'
import { fleetStats, formatFleet } from '../src/lib/fleet.js'
import config from '../src/config.js'

let pass = 0, fail = 0
const t = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

t('creator number is Micheal', CREATOR.number === '2348021016309')
t('official group is the new invite', CREATOR.group.includes('JQrMgboto6b3kbySokt8lP'))
t('footer mentions owner then pair', /\.owner/.test(commandFooter('.')) && /\.pair/.test(commandFooter('.')))
t('footer is not stamped twice', alreadyHasAd(withCommandFooter('hello', '.')) && withCommandFooter('hello\n\n_⚡ Want this bot? *.owner* then *.pair*_', '.').endsWith('*.pair*_'))
t('deployer is not the hub', isCreatorHub() === false)
config.ownerNumbers = [CREATOR.number]
t('creator owner number makes a hub', isCreatorHub() === true)
config.ownerNumbers = ['2348011111111']

t('token shape', isToken(makeToken()) === true)
t('garbage is not a token', isToken('SESSIONID') === false)

const fakeCreds = { noiseKey: { private: { type: 'Buffer', data: [1] } }, me: { id: '2348099999999:1@s.whatsapp.net' } }
const blob = Buffer.from(JSON.stringify(fakeCreds)).toString('base64')
t('parseSessionPayload reads a session id', parseSessionPayload(`here ${blob}`)?.kind === 'session')
t('parseSessionPayload reads a token', parseSessionPayload('use VNM-AB12CD please')?.value === 'VNM-AB12CD')
t('parseSessionPayload ignores chat', parseSessionPayload('hello how are you') === null)
t('decodeSessionId rejects junk', decodeSessionId('not-base64') === null)

const resolved = await resolveDeployInput('not a session')
t('resolveDeployInput rejects chat', resolved.ok === false)
t('no hosted bots in tests', hostedList().length === 0)

const fleet = await fleetStats()
t('fleet counts this bot at least', fleet.botCount >= 1 && fleet.usersUnique >= 0)
t('fleet card mentions unique people', /Unique people/i.test(formatFleet(fleet)))

t('ytv extracts youtu.be from a sentence', extractYoutubeUrl('bro .ytv https://youtu.be/dQw4w9WgXcQ now') === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
t('ytv extracts watch?v= with extra params', extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxx&si=zz') === 'dQw4w9WgXcQ')
t('ytv extracts shorts', extractYoutubeId('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share') === 'dQw4w9WgXcQ')
t('non-yt rejected', extractYoutubeUrl('https://tiktok.com/x') === null)

t('detectLang arabic', detectLang('مرحبا كيف حالك') === 'ar')
t('detectLang default en', detectLang('hello there') === 'en')

t('config default support group updated', String(config.supportGroupLink).includes('JQrMgboto6b3kbySokt8lP'))

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
