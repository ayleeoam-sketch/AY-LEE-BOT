import {
  youtubeInfo, youtubeAudio, youtubeVideo, youtubeSearch,
  fmtDuration, fmtCount, hasYtdlp, isUrl
} from '../../src/lib/downloader.js'

/**
 * "Document" variants of the download commands.
 * WhatsApp compresses audio/video aggressively; sending the same file as a
 * document preserves the original quality, which is what the -doc commands
 * in the original menu were for.
 */

const YT_URL = /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

async function resolve(input) {
  if (isUrl(input)) {
    if (!YT_URL.test(input)) throw new Error('That is not a YouTube link.')
    return input
  }
  const [first] = await youtubeSearch(input, 1)
  if (!first) throw new Error(`No YouTube results for "${input}".`)
  return first.url
}

const docCommand = ({ name, alias, audio, desc }) => ({
  name,
  alias,
  category: 'DOWNLOADER',
  desc,
  usage: `.${name} <song or link>`,
  cooldown: 30,
  async run({ m, text, args }) {
    if (!hasYtdlp()) return m.reply('⚠️ yt-dlp is not installed. Run *npm run setup*.')
    if (!text) return m.reply(`📄 Give me a name or link:\n*.${name} alan walker faded*`)

    const qualities = [144, 240, 360, 480, 720]
    const last = parseInt(args[args.length - 1])
    const quality = qualities.includes(last) ? last : 360
    const query = qualities.includes(last) ? args.slice(0, -1).join(' ') : text

    await m.react('⏳')
    try {
      const url = await resolve(query)
      const info = await youtubeInfo(url)

      const limit = audio ? 1800 : 900
      if (info.duration > limit) {
        await m.react('❌')
        return m.reply(`⏱️ That is ${fmtDuration(info.duration)} long — the limit is ${limit / 60} minutes.`)
      }

      await m.reply(
        `📄 *${audio ? 'AUDIO' : 'VIDEO'} AS DOCUMENT*\n\n` +
          `🎵 ${info.title}\n👤 ${info.author}\n⏱️ ${fmtDuration(info.duration)}\n` +
          `👁️ ${fmtCount(info.views)} views\n\n_Downloading — documents keep full quality..._`
      )

      const { buffer } = audio
        ? await youtubeAudio(url)
        : await youtubeVideo(url, { quality })

      const safe = info.title.replace(/[^\w\s-]/g, '').slice(0, 60).trim() || 'venom-md'
      await m.reply({
        document: buffer,
        mimetype: audio ? 'audio/mpeg' : 'video/mp4',
        fileName: `${safe}.${audio ? 'mp3' : 'mp4'}`,
        caption: `📄 *${info.title}*\n💾 ${(buffer.length / 1048576).toFixed(2)} MB`
      })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

export default [
  docCommand({ name: 'playdoc', alias: ['ytadoc', 'songdoc'], audio: true, desc: 'Download a song as a document (full quality)' }),
  docCommand({ name: 'videodoc', alias: ['ytvdoc', 'viddoc'], audio: false, desc: 'Download a video as a document (full quality)' }),

  {
    name: 'tik-img',
    alias: ['ttimg', 'tikimg', 'tiktokimg'],
    category: 'DOWNLOADER',
    desc: 'Download images from a TikTok photo post',
    usage: '.tik-img <link>',
    cooldown: 20,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      if (!url || !isUrl(url)) return m.reply('🖼️ Send a TikTok photo-post link.')
      await m.react('⏳')
      try {
        const { tiktokDownload } = await import('../../src/lib/downloader.js')
        const { getBuffer } = await import('../../src/lib/api.js')
        const { info, images } = await tiktokDownload(url)
        if (!images?.length) {
          await m.react('❌')
          return m.reply('❌ That post has no images — use *.tiktok* for videos.')
        }
        await m.reply(`🖼️ *TikTok slideshow*\n👤 ${info.author}\n📸 ${images.length} images`)
        let sent = 0
        for (const img of images.slice(0, 12)) {
          try {
            await m.reply({ image: await getBuffer(img) })
            sent++
          } catch {}
        }
        await m.react(sent ? '✅' : '❌')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'gdrive',
    alias: ['drive', 'gdrivedl'],
    category: 'DOWNLOADER',
    desc: 'Download a public Google Drive file',
    usage: '.gdrive <link>',
    cooldown: 25,
    async run({ m, text }) {
      const url = text || m.quoted?.text
      const id =
        String(url || '').match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] ||
        String(url || '').match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1]
      if (!id) return m.reply('📁 Send a Google Drive share link:\n*.gdrive https://drive.google.com/file/d/.../view*')

      await m.react('📁')
      try {
        const { getBuffer } = await import('../../src/lib/api.js')
        // the confirm=t parameter bypasses the virus-scan interstitial
        const direct = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`
        const buffer = await getBuffer(direct, { timeout: 180_000 })

        // an HTML body means Drive served a permission page instead of the file
        if (buffer.slice(0, 15).toString().toLowerCase().includes('<!doctype')) {
          throw new Error('the file is not publicly shared — set it to "Anyone with the link"')
        }
        const mb = buffer.length / 1048576
        if (mb > 90) {
          await m.react('❌')
          return m.reply(`❌ That file is ${mb.toFixed(1)}MB, over WhatsApp's limit.\n\n🔗 ${direct}`)
        }
        const { extOf } = await import('../../src/lib/media.js')
        const ext = await extOf(buffer, 'bin')
        await m.reply({
          document: buffer,
          fileName: `gdrive-file.${ext}`,
          mimetype: 'application/octet-stream',
          caption: `📁 *Google Drive*\n💾 ${mb.toFixed(2)} MB`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'pint',
    alias: ['pinterest'],
    category: 'DOWNLOADER',
    desc: 'Search Pinterest-style images',
    usage: '.pint sunset aesthetic',
    cooldown: 12,
    async run({ m, text }) {
      if (!text) return m.reply('📌 Usage: *.pint sunset aesthetic*')
      await m.react('📌')
      try {
        const { getBuffer } = await import('../../src/lib/api.js')
        let sent = 0
        for (let i = 0; i < 3; i++) {
          const url = `https://loremflickr.com/900/1200/${encodeURIComponent(text.replace(/\s+/g, ','))}?lock=${Date.now() + i * 97}`
          try {
            const b = await getBuffer(url, { timeout: 30_000 })
            if (b.length > 3000) {
              await m.reply({ image: b, caption: i === 0 ? `📌 *${text}*` : undefined })
              sent++
            }
          } catch {}
        }
        if (!sent) throw new Error('no images found for that keyword')
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'apk',
    alias: ['apkdl', 'apksearch'],
    category: 'DOWNLOADER',
    desc: 'Search for an Android app',
    usage: '.apk whatsapp',
    cooldown: 12,
    async run({ m, text }) {
      if (!text) return m.reply('📱 Usage: *.apk whatsapp*')
      await m.react('📱')
      try {
        const { getJson } = await import('../../src/lib/api.js')
        // iTunes-style lookup is not available for Android, so use the
        // public F-Droid index, which is open and needs no key.
        const d = await getJson('https://f-droid.org/repo/index-v2.json', { timeout: 60_000 })
        const q = text.toLowerCase()
        const hits = Object.entries(d.packages || {})
          .filter(([id, p]) => {
            const name = p.metadata?.name?.en_US || id
            return name.toLowerCase().includes(q) || id.toLowerCase().includes(q)
          })
          .slice(0, 5)

        if (!hits.length) {
          await m.react('❌')
          return m.reply(
            `❌ No open-source app matching "${text}" on F-Droid.\n\n` +
              `_Only F-Droid apps can be searched — Play Store scraping is blocked and mirror sites are unsafe._`
          )
        }

        await m.reply(
          `📱 *F-DROID APPS*\n_${text}_\n\n` +
            hits
              .map(([id, p], i) => {
                const meta = p.metadata || {}
                const name = meta.name?.en_US || id
                const summary = meta.summary?.en_US || ''
                return `*${i + 1}.* ${name}\n   📦 ${id}\n   📝 ${String(summary).slice(0, 80)}\n   🔗 https://f-droid.org/packages/${id}/`
              })
              .join('\n\n')
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
