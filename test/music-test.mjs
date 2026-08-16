/**
 * Offline tests for the multi-source music pipeline.
 *
 *   node test/music-test.mjs
 *
 * No network: sources are exercised through parse fixtures and musicAuto's
 * injectable sink map, so this works on any machine.
 */
import {
  musicAuto, MUSIC_SINKS, AUDIOMACK_TRACK,
  parseAudiomackTrack, findAudiomackTracks
} from '../src/lib/downloader.js'
import { loadPlugins, commands } from '../src/lib/pluginLoader.js'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + extra}`)
  cond ? pass++ : fail++
}

/* ---------------------- registration ---------------------- */

await loadPlugins()
for (const cmd of ['music', 'mplay', 'sc', 'soundcloud', 'audiomack', 'amack']) {
  check(`command .${cmd} registered`, commands.has(cmd))
}

/* ------------------- Audiomack URL parsing ------------------- */

check('audiomack track url', AUDIOMACK_TRACK.test('https://audiomack.com/davido/song/unavailable'))
check('audiomack url with query', AUDIOMACK_TRACK.test('https://audiomack.com/kizz-daniel/song/buga?key=x'))
check('rejects album link', !AUDIOMACK_TRACK.test('https://audiomack.com/davido/album/timeless'))

/* ------------------- Audiomack result parsing ------------------- */

// real api.audiomack.com shape: url_slug carries the full path
const apiShape = { title: 'Unavailable (feat. Musa Keys)', artist: 'Davido', url_slug: '/davido/song/unavailable-1234567' }
check('parses /artist/song/slug url_slug', parseAudiomackTrack(apiShape)?.url === 'https://audiomack.com/davido/song/unavailable-1234567')

const fullUrlShape = { title: 'Buga', url: 'https://audiomack.com/kizz-daniel/song/buga-lo-lo-lo' }
check('parses direct url field', parseAudiomackTrack(fullUrlShape)?.url === fullUrlShape.url)

const composedShape = { title: 'Gwagwalada', artist: 'BNXN fka Buju', url_slug: 'gwagwalada' }
check('composes url from artist+slug', parseAudiomackTrack(composedShape)?.url === 'https://audiomack.com/bnxnfkabuju/song/gwagwalada')

check('junk objects rejected', parseAudiomackTrack({ foo: 1 }) === null && parseAudiomackTrack(null) === null)

// __NEXT_DATA__ has tracks nested deep under props
const nextData = {
  props: {
    pageProps: {
      results: {
        music: [
          { garbage: true },
          { title: 'Essence', artist: 'Wizkid', url_slug: '/wizkid/song/essence-x1', unknown: null }
        ]
      }
    }
  }
}
const found = findAudiomackTracks(nextData)
check('finds nested tracks in __NEXT_DATA__', found.length === 1 && found[0].url === 'https://audiomack.com/wizkid/song/essence-x1', JSON.stringify(found))

/* ------------------- musicAuto fallback ordering ------------------- */

const ok = (label, dur = 1) => ({
  label,
  search: async () => [{ title: `${label} Song`, url: `http://x/${label}`, artist: 'Tester', duration: dur }],
  download: async () => ({ buffer: Buffer.from('fake-audio'), ext: 'mp3' })
})
const broken = (label) => ({
  label,
  search: async () => { throw new Error(`${label} exploded`) },
  download: async () => ({ buffer: Buffer.from(''), ext: 'mp3' })
})
const empty = (label) => ({
  label,
  search: async () => [],
  download: async () => ({ buffer: Buffer.from(''), ext: 'mp3' })
})

// first source wins when it works
let r = await musicAuto('any song', {}, { soundcloud: ok('SoundCloud'), audiomack: ok('Audiomack'), youtube: ok('YouTube') })
check('soundcloud-first default order', r.source === 'SoundCloud' && r.title === 'SoundCloud Song' && r.buffer.toString() === 'fake-audio')

// first fails -> second source delivers
r = await musicAuto('any song', {}, { soundcloud: broken('SoundCloud'), audiomack: ok('Audiomack'), youtube: ok('YouTube') })
check('falls through to audiomack', r.source === 'Audiomack')

// first two fail -> third saves the day
r = await musicAuto('any song', {}, { soundcloud: broken('SoundCloud'), audiomack: empty('Audiomack'), youtube: ok('YouTube') })
check('falls through to youtube', r.source === 'YouTube')

// caller-controlled order (spotify wants youtube first)
r = await musicAuto('any song', { order: ['youtube', 'soundcloud'] }, { youtube: ok('YouTube'), soundcloud: ok('SoundCloud') })
check('respects explicit order', r.source === 'YouTube')

// everything failed -> grouped error naming every source
try {
  await musicAuto('ghost song', {}, { soundcloud: broken('SoundCloud'), audiomack: empty('Audiomack'), youtube: broken('YouTube') })
  check('aggregate error thrown', false, 'no throw!')
} catch (e) {
  check(
    'aggregate error names every source',
    /SoundCloud exploded/.test(e.message) && /Audiomack: no results/.test(e.message) && /YouTube exploded/.test(e.message),
    e.message
  )
}

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
void MUSIC_SINKS
