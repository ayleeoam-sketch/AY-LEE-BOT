/* Functional test: run every videofx ffmpeg pipeline on a real clip. */
import fs from 'fs'
import { convert, extOf, toMp3, applyAudioFx } from '../src/lib/media.js'

const input = fs.readFileSync(process.argv[2] || '/tmp/testvid.mp4')
console.log(`input: ${(input.length / 1024).toFixed(0)}KB`)

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', 'faststart', '-pix_fmt', 'yuv420p']

const FX = {
  boomerang: [
    '-t', '6',
    '-filter_complex',
    '[0:v]scale=480:-2,fps=20,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-an', ...H264
  ],
  vidfast: ['-vf', 'scale=480:-2,setpts=0.6*PTS', '-af', 'atempo=1.67', ...H264, '-c:a', 'aac', '-b:a', '128k'],
  vidslow: ['-vf', 'scale=480:-2,setpts=1.6*PTS', '-af', 'atempo=0.625', ...H264, '-c:a', 'aac', '-b:a', '128k'],
  vidreverse: ['-t', '15', '-vf', 'scale=480:-2,reverse', '-af', 'areverse', ...H264, '-c:a', 'aac', '-b:a', '128k'],
  smooth: ['-t', '12', '-vf', 'scale=480:-2,minterpolate=fps=30:mi_mode=blend', ...H264, '-c:a', 'aac', '-b:a', '128k']
}

const inExt = await extOf(input, 'mp4')
console.log('detected ext:', inExt)

for (const [name, args] of Object.entries(FX)) {
  const t = Date.now()
  try {
    const out = await convert(input, inExt, 'mp4', args)
    console.log(`OK   ${name}: ${(out.length / 1024).toFixed(0)}KB in ${((Date.now() - t) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n').pop()}`)
    process.exitCode = 1
  }
}

// audio fx sanity + the previously-broken path stays excluded from audio.js
const mp3 = await toMp3(input, inExt)
const bassed = await applyAudioFx(mp3, 'bass', 'mp3')
console.log(`OK   bass audio fx: ${(bassed.length / 1024).toFixed(0)}KB`)
