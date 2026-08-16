import { convert, extOf } from '../../src/lib/media.js'

/**
 * Video effects - the viral stuff: reply to someone's clip with one command
 * and the bot sends it back edited. Everything is local ffmpeg (no API key),
 * downscaled to 480p so even a slow host keeps up.
 *
 *   .boomerang   clip -> forward/reverse loop (plays like a GIF)
 *   .vidfast     clip -> 1.7x speed
 *   .vidslow     clip -> 0.63x slow motion
 *   .vidreverse  clip -> played backwards (max 15s)
 *   .smooth      clip -> motion-interpolated to 30fps (max 12s)
 */

const MAX_INPUT_MB = 40

const videoSource = (m) => {
  const ok = ['videoMessage', 'documentMessage']
  if (m.isMedia && ok.includes(m.type)) return m
  if (m.quoted?.isMedia && ok.includes(m.quoted.type)) return m.quoted
  return null
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', 'faststart', '-pix_fmt', 'yuv420p']

/** Run one effect and send it back as a WhatsApp video. */
async function applyVideoFx(m, cmd, { label, args, caption, gifPlayback = false }) {
  const src = videoSource(m)
  if (!src) return m.reply(`🎬 Reply to a video with *.${cmd}*`)

  await m.react('⏳')
  try {
    const buffer = await src.download()
    if (buffer.length > MAX_INPUT_MB * 1024 * 1024) {
      throw new Error(`That video is ${(buffer.length / 1048576).toFixed(1)}MB - keep it under ${MAX_INPUT_MB}MB.`)
    }

    const inExt = await extOf(buffer, 'mp4')
    const out = await convert(buffer, inExt, 'mp4', args)
    await m.reply({
      video: out,
      gifPlayback,
      caption: caption || `🎬 *${label}* done`
    })
    await m.react('✅')
  } catch (e) {
    await m.react('❌')
    await m.reply(`❌ ${e.message}`)
  }
}

export default [
  {
    name: 'boomerang',
    alias: ['boomer', 'loopvid'],
    category: 'CONVERTER',
    desc: 'Turn a video into a forward/reverse boomerang loop',
    usage: '.boomerang (reply to a short video)',
    cooldown: 20,
    async run({ m }) {
      await applyVideoFx(m, 'boomerang', {
        label: 'Boomerang',
        gifPlayback: true,
        // first 6 seconds, forward part + reversed part stitched together
        args: [
          '-t', '6',
          '-filter_complex',
          '[0:v]scale=480:-2,fps=20,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]',
          '-map', '[v]', '-an',
          ...H264
        ],
        caption: '🔁 *Boomerang*'
      })
    }
  },
  {
    name: 'vidfast',
    alias: ['2xvideo', 'speedup'],
    category: 'CONVERTER',
    desc: 'Speed a video up (1.7x, audio kept)',
    usage: '.vidfast (reply to a video)',
    cooldown: 20,
    async run({ m }) {
      await applyVideoFx(m, 'vidfast', {
        label: 'Fast video',
        args: [
          '-vf', 'scale=480:-2,setpts=0.6*PTS',
          '-af', 'atempo=1.67',
          ...H264,
          '-c:a', 'aac', '-b:a', '128k'
        ],
        caption: '⏩ *1.7x speed*'
      })
    }
  },
  {
    name: 'vidslow',
    alias: ['slowvid', 'slowmo'],
    category: 'CONVERTER',
    desc: 'Slow a video down (0.63x, audio kept)',
    usage: '.vidslow (reply to a video)',
    cooldown: 20,
    async run({ m }) {
      await applyVideoFx(m, 'vidslow', {
        label: 'Slow video',
        args: [
          '-vf', 'scale=480:-2,setpts=1.6*PTS',
          '-af', 'atempo=0.625',
          ...H264,
          '-c:a', 'aac', '-b:a', '128k'
        ],
        caption: '🐢 *Slow motion*'
      })
    }
  },
  {
    name: 'vidreverse',
    alias: ['reversevid', 'rvideo'],
    category: 'CONVERTER',
    desc: 'Play a video backwards (max 15 seconds)',
    usage: '.vidreverse (reply to a short video)',
    cooldown: 25,
    async run({ m }) {
      await applyVideoFx(m, 'vidreverse', {
        label: 'Reversed video',
        args: [
          '-t', '15',
          '-vf', 'scale=480:-2,reverse',
          '-af', 'areverse',
          ...H264,
          '-c:a', 'aac', '-b:a', '128k'
        ],
        caption: '⏪ *Reversed*'
      })
    }
  },
  {
    name: 'smooth',
    alias: ['fpsboost'],
    category: 'CONVERTER',
    desc: 'Motion-interpolate a video to 30fps for that smooth look (max 12s)',
    usage: '.smooth (reply to a short video)',
    cooldown: 25,
    async run({ m }) {
      await applyVideoFx(m, 'smooth', {
        label: 'Smooth video',
        args: [
          '-t', '12',
          // blend interpolation: fast, still gives the satisfying "smooth" look
          '-vf', 'scale=480:-2,minterpolate=fps=30:mi_mode=blend',
          ...H264,
          '-c:a', 'aac', '-b:a', '128k'
        ],
        caption: '🧈 *Smooth 30fps*'
      })
    }
  }
]
