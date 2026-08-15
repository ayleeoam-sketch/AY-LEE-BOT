import { toMp3, toPTT, toPTV, applyAudioFx, AUDIO_FX, extOf } from '../../src/lib/media.js'

const audioSource = (m) => {
  const ok = ['audioMessage', 'videoMessage', 'documentMessage']
  if (m.isMedia && ok.includes(m.type)) return m
  if (m.quoted?.isMedia && ok.includes(m.quoted.type)) return m.quoted
  return null
}

/** One plugin object per ffmpeg effect - keeps the menu identical to spec. */
const effectPlugins = Object.keys(AUDIO_FX).map((fx) => ({
  name: fx,
  category: 'CONVERTER',
  desc: `Apply the "${fx}" audio effect`,
  usage: `.${fx} (reply to audio)`,
  cooldown: 10,
  async run({ m }) {
    const src = audioSource(m)
    if (!src) return m.reply(`🎧 Reply to an audio or video with *.${fx}*`)
    await m.react('⏳')
    try {
      const buffer = await src.download()
      const inExt = await extOf(buffer, 'mp3')
      const out = await applyAudioFx(buffer, fx, inExt)
      await m.reply({ audio: out, mimetype: 'audio/mpeg', ptt: false })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ Effect failed: ${e.message}`)
    }
  }
}))

export default [
  {
    name: 'tomp3',
    alias: ['toaudio', 'mp3'],
    category: 'CONVERTER',
    desc: 'Extract audio from a video as MP3',
    usage: '.tomp3 (reply to a video)',
    cooldown: 8,
    async run({ m }) {
      const src = audioSource(m)
      if (!src) return m.reply('🎵 Reply to a video or audio with *.tomp3*')
      await m.react('⏳')
      try {
        const buffer = await src.download()
        const out = await toMp3(buffer, await extOf(buffer, 'mp4'))
        await m.reply({ audio: out, mimetype: 'audio/mpeg', fileName: 'audio.mp3' })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'tovn',
    alias: ['toptt', 'voice', 'tovoice'],
    category: 'CONVERTER',
    desc: 'Convert audio into a voice note',
    usage: '.tovn (reply to audio)',
    cooldown: 8,
    async run({ m }) {
      const src = audioSource(m)
      if (!src) return m.reply('🎙️ Reply to an audio with *.tovn*')
      await m.react('⏳')
      try {
        const buffer = await src.download()
        const out = await toPTT(buffer, await extOf(buffer, 'mp3'))
        await m.reply({ audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'ptv',
    alias: ['tovideonote'],
    category: 'CONVERTER',
    desc: 'Convert a video into a round video note',
    usage: '.ptv (reply to a video)',
    cooldown: 15,
    async run({ m }) {
      const src = m.type === 'videoMessage' ? m : m.quoted?.type === 'videoMessage' ? m.quoted : null
      if (!src) return m.reply('⭕ Reply to a video with *.ptv*')
      await m.react('⏳')
      try {
        const out = await toPTV(await src.download())
        await m.reply({ video: out, ptv: true })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  ...effectPlugins
]
