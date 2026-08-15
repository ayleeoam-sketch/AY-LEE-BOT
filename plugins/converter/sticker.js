import { toSticker, addExif, stickerToImage, stickerToVideo, extOf } from '../../src/lib/media.js'
import { getVar } from '../../src/lib/vars.js'

/** Pick whichever message actually carries media: this one or the quoted one. */
const mediaSource = (m) => {
  if (m.isMedia) return { holder: m, type: m.type }
  if (m.quoted?.isMedia) return { holder: m.quoted, type: m.quoted.type }
  return null
}

export default [
  {
    name: 'sticker',
    alias: ['s', 'stiker'],
    category: 'CONVERTER',
    desc: 'Turn an image, video or GIF into a sticker',
    usage: '.sticker (send with, or reply to, media)',
    cooldown: 5,
    async run({ m, text, config }) {
      const src = mediaSource(m)
      if (!src) return m.reply('🖼️ Send an image/video with *.sticker*, or reply to one.')
      if (!['imageMessage', 'videoMessage', 'stickerMessage'].includes(src.type)) {
        return m.reply('❌ Only images, videos and GIFs can become stickers.')
      }

      // videos over ~10s make huge stickers that WhatsApp rejects
      const seconds = src.holder.msg?.seconds || 0
      if (seconds > 10) return m.reply('⏱️ Video is too long - keep it under 10 seconds.')

      await m.react('⏳')
      try {
        const buffer = await src.holder.download()
        const animated = src.type === 'videoMessage' || !!src.holder.msg?.isAnimated
        const crop = /crop|full/i.test(text)

        let webp = await toSticker(buffer, { animated, crop })

        // custom pack name:  .sticker Pack | Author
        const [pack, author] = text.includes('|')
          ? text.split('|').map((s) => s.trim())
          : [config.botName, config.ownerName]
        webp = await addExif(webp, pack || config.botName, author || config.ownerName)

        if (webp.length > 1_000_000) {
          await m.react('❌')
          return m.reply('❌ Sticker came out too large. Try a shorter or smaller clip.')
        }

        await m.reply({ sticker: webp })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ Sticker failed: ${e.message}`)
      }
    }
  },
  {
    name: 'take',
    alias: ['steal', 'rename'],
    category: 'CONVERTER',
    desc: 'Re-brand a sticker with your own pack name',
    usage: '.take Pack Name | Author  (reply to a sticker)',
    cooldown: 5,
    async run({ m, text, config }) {
      if (m.quoted?.type !== 'stickerMessage') return m.reply('🏷️ Reply to a sticker with *.take Pack | Author*')
      await m.react('⏳')
      try {
        const buffer = await m.quoted.download()
        const [pack, author] = text.includes('|')
          ? text.split('|').map((s) => s.trim())
          : [text || config.botName, config.ownerName]
        const out = await addExif(buffer, pack || config.botName, author || config.ownerName)
        await m.reply({ sticker: out })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'photo',
    alias: ['toimg', 'toimage'],
    category: 'CONVERTER',
    desc: 'Convert a sticker back into an image',
    usage: '.photo (reply to a sticker)',
    cooldown: 5,
    async run({ m }) {
      if (m.quoted?.type !== 'stickerMessage') return m.reply('🖼️ Reply to a sticker with *.photo*')
      await m.react('⏳')
      try {
        const buffer = await m.quoted.download()
        if (m.quoted.msg?.isAnimated) {
          const video = await stickerToVideo(buffer)
          await m.reply({ video, caption: '🎞️ Animated sticker → video', gifPlayback: true })
        } else {
          const image = await stickerToImage(buffer)
          await m.reply({ image, caption: '🖼️ Sticker → image' })
        }
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'mp4',
    alias: ['tovideo', 'tomp4', 'tovid'],
    category: 'CONVERTER',
    desc: 'Convert an animated sticker into a video',
    usage: '.mp4 (reply to an animated sticker)',
    cooldown: 8,
    async run({ m }) {
      if (m.quoted?.type !== 'stickerMessage') return m.reply('🎞️ Reply to an animated sticker with *.mp4*')
      await m.react('⏳')
      try {
        const video = await stickerToVideo(await m.quoted.download())
        await m.reply({ video, caption: '🎞️ Sticker → video' })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'gif',
    alias: ['togif'],
    category: 'CONVERTER',
    desc: 'Convert an animated sticker into a playable GIF',
    usage: '.gif (reply to an animated sticker)',
    cooldown: 8,
    async run({ m }) {
      if (m.quoted?.type !== 'stickerMessage') return m.reply('🎞️ Reply to an animated sticker with *.gif*')
      await m.react('⏳')
      try {
        const video = await stickerToVideo(await m.quoted.download())
        await m.reply({ video, gifPlayback: true, caption: '🎞️ Sticker → GIF' })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
