/** Prove the voice pipeline: sample + text → WhatsApp voice note. */
import './_isolate.js'
import fs from 'fs'
import { spawn } from 'child_process'
import { FFMPEG } from '../src/lib/media.js'
import { cloneSpeak, speakPlain, analyzeVoice } from '../src/lib/voiceclone.js'

const tmp = '/tmp/venom-voice-sample.ogg'

function makeSample() {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=140:duration=1.4',
      '-c:a', 'libopus', '-ar', '48000', '-ac', '1',
      tmp
    ])
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-200)))))
  })
}

let pass = 0, fail = 0
const t = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond || !extra ? '' : ' -> ' + String(extra).slice(0, 120)}`)
  cond ? pass++ : fail++
}

await makeSample()
const sample = fs.readFileSync(tmp)
t('sample voice note exists', sample.length > 500)

const print = await analyzeVoice(sample)
t('analyzeVoice returns a pitch', Number(print.pitchRatio) > 0)

const spoken = await speakPlain('how are you', { ptt: true })
t('speakPlain returns opus bytes', Buffer.isBuffer(spoken.audio) && spoken.audio.length > 800, spoken.audio?.length)

const cloned = await cloneSpeak(sample, 'how are you')
t('cloneSpeak returns opus bytes', Buffer.isBuffer(cloned.audio) && cloned.audio.length > 800, cloned.audio?.length)
t('cloneSpeak keeps a profile', cloned.profile && cloned.profile.pitchRatio > 0)

fs.writeFileSync('/tmp/venom-how-are-you.ogg', cloned.audio)
t('wrote playable voice note', fs.statSync('/tmp/venom-how-are-you.ogg').size > 800)

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
process.exit(fail ? 1 : 0)
