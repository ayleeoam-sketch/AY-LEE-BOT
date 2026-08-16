import {
  musicAuto, hasYtdlp, isUrl,
  soundcloudSearch, soundcloudAudio, audiomackSearch, audiomackAudio,
  AUDIOMACK_TRACK, fmtDuration
} from '../../src/lib/downloader.js'
import { getBuffer } from '../../src/lib/api.js'

/**
 * One command, every music source.
 *
 *   .music <song name>      -> tries SoundCloud, then Audiomack, then YouTube
 *   .sc <name or link>      -> SoundCloud only
 *   .audiomack <name|link>  -> Audiomack only
 *
 * Why: YouTube bot-checks datacenter IPs ("sign in to confirm you're not a
 * bot"), so YouTube-first bots look broken on cheap panels even when nothing
 * is wrong. SoundCloud and Audiomack don't do that check, which is why
 * .music usually delivers a song on hosts where .play cannot.
 */

const notInstalled = (m) =>
  m.reply('⚠️ yt-dlp is not installed.\n\nRun *npm run setup* in the bot folder, then try again.')

const safeFile = (s) => `${String(s).replace(/[^\w\s-]/g, '').slice(0, 60) || 'song'}.mp3`

async function sendTrack(m, url, track, source) {
  const { buffer } =
    source === 'Audiomack' ? await audiomackAudio(url) : await soundcloudAudio(url)
  await m.reply({
    audio: buffer,
    mimetype: 'audio/mpeg',
    fileName: safeFile(track.title || 'song')
  })
}

export default [
  {
    name: 'music',
    alias: ['mplay', 'findsong', 'song'],
    category: 'DOWNLOADER',
    desc: 'Find a song on SoundCloud, Audiomack or YouTube and send the audio',
    usage: '.music davido unavailable',
    cooldown: 20,
    async run({ m, text }) {
      if (!hasYtdlp()) return notInstalled(m)
      const query = text || m.quoted?.text
      if (!query) return m.reply('🎵 Give me a song name:\n*.music davido unavailable*')
      if (isUrl(query) && !AUDIOMACK_TRACK.test(query)) {
        return m.reply('🎵 Send a song *name*, not a link. For links use *.play* or *.autodl*.')
      }

      // an Audiomack track link goes straight to the downloader
      if (AUDIOMACK_TRACK.test(query)) {
        await m.react('⏳')
        try {
          const { buffer } = await audiomackAudio(query.split('?')[0])
          await m.reply({
            audio: buffer,
            mimetype: 'audio/mpeg',
            fileName: safeFile(query.split('/').pop().replace(/[-_]/g, ' '))
          })
          await m.react('✅')
        } catch (e) {
          await m.react('❌')
          await m.reply(`❌ ${e.message}`)
        }
        return
      }

      await m.react('🔍')
      try {
        const r = await musicAuto(query)
        const caption =
          `╭━━━〔 *MUSIC* 〔${r.source}〕━━━╮\n` +
          `┃ 🎵 ${r.title}\n` +
          `┃ 👤 ${r.artist}\n` +
          (r.duration ? `┃ ⏱️ ${fmtDuration(r.duration)}\n` : '') +
          `╰━━━━━━━━━━━━━━━━━━━╯`
        const img = r.image ? await getBuffer(r.image).catch(() => null) : null
        if (img) await m.reply({ image: img, caption }).catch(() => m.reply(caption))
        else await m.reply(caption)

        await m.reply({ audio: r.buffer, mimetype: 'audio/mpeg', fileName: safeFile(r.title) })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'sc',
    alias: ['soundcloud', 'sclink'],
    category: 'DOWNLOADER',
    desc: 'Download a song from SoundCloud (name or link)',
    usage: '.sc burna boy last last  |  .sc <soundcloud link>',
    cooldown: 15,
    async run({ m, text }) {
      if (!hasYtdlp()) return notInstalled(m)
      const input = (text || m.quoted?.text || '').trim()
      if (!input) return m.reply('🧡 *.sc burna boy last last* or paste a SoundCloud link')

      await m.react('⏳')
      try {
        let title = input
        let url = input
        if (/soundcloud\.com\/[\w-]+\/[\w-]+/i.test(input)) {
          url = input.split('?')[0]
          title = url.split('/').pop().replace(/[-_]/g, ' ')
        } else {
          const [first] = await soundcloudSearch(input, 1)
          if (!first) return m.reply(`❌ No SoundCloud results for "${input}".`)
          url = first.url
          title = first.title
        }
        await sendTrack(m, url, { title }, 'SoundCloud')
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'audiomack',
    alias: ['amack'],
    category: 'DOWNLOADER',
    desc: 'Download a song from Audiomack (name or link)',
    usage: '.audiomack kizz daniel buga  |  .audiomack <link>',
    cooldown: 15,
    async run({ m, text }) {
      if (!hasYtdlp()) return notInstalled(m)
      const input = (text || m.quoted?.text || '').trim()
      if (!input) return m.reply('🟠 *.audiomack kizz daniel buga* or paste an Audiomack link')

      await m.react('⏳')
      try {
        let url = input
        let track = { title: input }
        if (AUDIOMACK_TRACK.test(input)) {
          url = input.split('?')[0]
          track = { title: null }
        } else {
          const [first] = await audiomackSearch(input, 1)
          if (!first?.url) return m.reply(`❌ No Audiomack results for "${input}".\n\n_Try exact title + artist, or paste the track link._`)
          url = first.url
          track = first
        }
        await sendTrack(m, url, track, 'Audiomack')
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
