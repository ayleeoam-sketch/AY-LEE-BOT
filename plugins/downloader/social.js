import {
  tiktokDownload, instagramDownload, anyDownload, detectPlatform,
  fmtCount, fmtDuration, isUrl, hasYtdlp, hasCookies
} from '../../src/lib/downloader.js'
import { getBuffer } from '../../src/lib/api.js'

export default [
  {
    name: 'tiktok',
    alias: ['tt', 'ttdl', 'tiktokdl'],
    category: 'DOWNLOADER',
    desc: 'Download a TikTok video without watermark',
    usage: '.tiktok <link>',
    cooldown: 15,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !isUrl(url)) return m.reply('🎵 Send a TikTok link:\n*.tiktok https://vm.tiktok.com/...*')
      if (detectPlatform(url) !== 'tiktok') return m.reply('❌ That is not a TikTok link.')

      await m.react('⏳')
      try {
        const { info, buffer, images } = await tiktokDownload(url)

        // photo carousels come back as an image list
        if (images?.length) {
          await m.reply(`🖼️ *TikTok slideshow* — ${images.length} images\n👤 ${info.author}`)
          for (const img of images.slice(0, 10)) {
            await m.reply({ image: await getBuffer(img).catch(() => null) }).catch(() => {})
          }
          await m.react('✅')
          return
        }

        await m.reply({
          video: buffer,
          caption:
            `╭━━━〔 *TIKTOK* 〕━━━╮\n` +
            `┃ 📝 ${(info.title || 'No caption').slice(0, 150)}\n` +
            `┃ 👤 ${info.author || 'unknown'}\n` +
            `┃ ⏱️ ${fmtDuration(info.duration)}\n` +
            `┃ 👁️ ${fmtCount(info.views)}  ❤️ ${fmtCount(info.likes)}\n` +
            `┃ ✨ No watermark\n` +
            `╰━━━━━━━━━━━━━━━╯`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'ttmp3',
    alias: ['ttaudio', 'tiktokaudio'],
    category: 'DOWNLOADER',
    desc: 'Get the audio from a TikTok video',
    usage: '.ttmp3 <link>',
    cooldown: 15,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !isUrl(url)) return m.reply('🎵 Send a TikTok link: *.ttmp3 <link>*')
      await m.react('⏳')
      try {
        const { info } = await tiktokDownload(url)
        if (info.music) {
          const audio = await getBuffer(info.music)
          await m.reply({ audio, mimetype: 'audio/mpeg', fileName: 'tiktok-audio.mp3' })
        } else {
          // no separate music track - strip audio from the video
          const { buffer } = await anyDownload(url, { audio: true })
          await m.reply({ audio: buffer, mimetype: 'audio/mpeg', fileName: 'tiktok-audio.mp3' })
        }
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'instagram',
    alias: ['ig', 'igdl', 'insta', 'reel'],
    category: 'DOWNLOADER',
    desc: 'Download an Instagram post or reel',
    usage: '.instagram <link>',
    cooldown: 15,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !isUrl(url)) return m.reply('📸 Send an Instagram link:\n*.instagram https://instagram.com/reel/...*')
      if (detectPlatform(url) !== 'instagram') return m.reply('❌ That is not an Instagram link.')

      await m.react('⏳')
      try {
        const { buffer, ext, info } = await instagramDownload(url)
        const caption =
          `╭━━━〔 *INSTAGRAM* 〕━━━╮\n` +
          `┃ 📝 ${(info.title || 'Instagram media').slice(0, 150)}\n` +
          (info.author ? `┃ 👤 ${info.author}\n` : '') +
          (info.likes ? `┃ ❤️ ${fmtCount(info.likes)}\n` : '') +
          `╰━━━━━━━━━━━━━━━╯`

        if (info.isVideo || ext === 'mp4') await m.reply({ video: buffer, caption })
        else await m.reply({ image: buffer, caption })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        // instagramDownload returns a multi-line, actionable message
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'facebook',
    alias: ['fb', 'fbdl'],
    category: 'DOWNLOADER',
    desc: 'Download a Facebook video',
    usage: '.facebook <link>',
    cooldown: 20,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !isUrl(url)) return m.reply('📘 Send a Facebook video link: *.facebook <link>*')
      await m.react('⏳')
      try {
        const { buffer } = await anyDownload(url, { quality: 480 })
        await m.reply({ video: buffer, caption: '📘 *Facebook video*' })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ Facebook download failed: ${e.message}\n\n_Private or age-restricted videos need cookies.txt._`)
      }
    }
  },
  {
    name: 'twitter',
    alias: ['x', 'xdl', 'twdl'],
    category: 'DOWNLOADER',
    desc: 'Download a video from Twitter/X',
    usage: '.twitter <link>',
    cooldown: 20,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !isUrl(url)) return m.reply('🐦 Send a Twitter/X link: *.twitter <link>*')
      await m.react('⏳')
      try {
        const { buffer } = await anyDownload(url, { quality: 720 })
        await m.reply({ video: buffer, caption: '🐦 *Twitter/X video*' })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'autodl',
    alias: ['dl', 'download'],
    category: 'DOWNLOADER',
    desc: 'Download from any supported site automatically',
    usage: '.autodl <link>  |  .autodl <link> audio',
    cooldown: 20,
    async run({ m, text, args }) {
      if (!hasYtdlp()) return m.reply('⚠️ yt-dlp is not installed. Run *npm run setup*.')
      const url = args.find(isUrl) || (isUrl(m.quoted?.text) ? m.quoted.text : null)
      if (!url) return m.reply('🔗 Send any media link:\n*.autodl <link>*\n\nAdd *audio* to get audio only.')

      const wantAudio = /\b(audio|mp3|song)\b/i.test(text)
      const platform = detectPlatform(url) || 'that site'

      await m.react('⏳')
      try {
        // route to the specialised handler when we have one
        if (platform === 'tiktok' && !wantAudio) {
          const { info, buffer } = await tiktokDownload(url)
          await m.reply({ video: buffer, caption: `🎵 *TikTok* — ${info.author || ''}` })
          return m.react('✅')
        }
        if (platform === 'instagram') {
          const { buffer, ext, info } = await instagramDownload(url)
          if (info.isVideo || ext === 'mp4') await m.reply({ video: buffer, caption: '📸 *Instagram*' })
          else await m.reply({ image: buffer, caption: '📸 *Instagram*' })
          return m.react('✅')
        }

        const { buffer, ext } = await anyDownload(url, { audio: wantAudio, quality: 480 })
        if (wantAudio || ext === 'mp3') {
          await m.reply({ audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3' })
        } else {
          await m.reply({ video: buffer, caption: `✅ Downloaded from ${platform}` })
        }
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'dlstatus',
    category: 'DOWNLOADER',
    desc: 'Check downloader health and capabilities',
    usage: '.dlstatus',
    owner: true,
    async run({ m }) {
      await m.reply(
        `📥 *DOWNLOADER STATUS*\n\n` +
          `${hasYtdlp() ? '✅' : '❌'} yt-dlp engine\n` +
          `${hasCookies() ? '✅' : '⚠️'} cookies.txt ${hasCookies() ? '(loaded)' : '(not set)'}\n\n` +
          `*Platform support:*\n` +
          `✅ YouTube — audio + video, keyless\n` +
          `✅ TikTok — no watermark via tikwm\n` +
          `${hasCookies() ? '✅' : '⚠️'} Instagram — ${hasCookies() ? 'cookies loaded' : 'needs cookies.txt'}\n` +
          `✅ Twitter/X, Facebook, and 1800+ other sites\n\n` +
          (hasCookies()
            ? ''
            : `_To enable Instagram: export cookies with the "Get cookies.txt LOCALLY" browser extension and save as *cookies.txt* in the bot folder._`)
      )
    }
  }
]
