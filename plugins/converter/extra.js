import sharp from 'sharp'
import { toSticker, addExif, extOf } from '../../src/lib/media.js'

const mediaSource = (m) => {
  if (m.isMedia) return m
  if (m.quoted?.isMedia) return m.quoted
  return null
}

/** Sticker variants from the original menu, all rendered locally. */
const stickerVariant = ({ name, alias, desc, build }) => ({
  name,
  alias,
  category: 'CONVERTER',
  desc,
  usage: `.${name} (reply to an image)`,
  cooldown: 6,
  async run({ m, config }) {
    const src = mediaSource(m)
    if (!src || !['imageMessage', 'stickerMessage', 'videoMessage'].includes(src.type)) {
      return m.reply(`🖼️ Reply to an image with *.${name}*`)
    }
    await m.react('⏳')
    try {
      const input = await src.download()
      const shaped = await build(input)
      let webp = await toSticker(shaped, { animated: false })
      webp = await addExif(webp, config.botName, config.ownerName)
      await m.reply({ sticker: webp })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

/** circular mask as an SVG, composited with sharp */
const circleMask = async (buffer) => {
  const size = 512
  const img = await sharp(buffer).resize(size, size, { fit: 'cover' }).png().toBuffer()
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  )
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

const roundedMask = async (buffer) => {
  const size = 512
  const r = 90
  const img = await sharp(buffer).resize(size, size, { fit: 'cover' }).png().toBuffer()
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  )
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

export default [
  stickerVariant({
    name: 'circlestk', alias: ['circle', 'roundsticker'],
    desc: 'Make a circular sticker', build: circleMask
  }),
  stickerVariant({
    name: 'roundstk', alias: ['rounded'],
    desc: 'Make a rounded-corner sticker', build: roundedMask
  }),
  stickerVariant({
    name: 'black', alias: ['blackstk'],
    desc: 'Sticker on a black background',
    build: async (b) =>
      sharp({ create: { width: 512, height: 512, channels: 4, background: '#000000' } })
        .composite([{ input: await sharp(b).resize(460, 460, { fit: 'inside' }).png().toBuffer(), gravity: 'centre' }])
        .png()
        .toBuffer()
  }),
  stickerVariant({
    name: 'white', alias: ['whitestk'],
    desc: 'Sticker on a white background',
    build: async (b) =>
      sharp({ create: { width: 512, height: 512, channels: 4, background: '#ffffff' } })
        .composite([{ input: await sharp(b).resize(460, 460, { fit: 'inside' }).png().toBuffer(), gravity: 'centre' }])
        .png()
        .toBuffer()
  }),

  {
    name: 'exif',
    alias: ['stickerinfo'],
    category: 'CONVERTER',
    desc: 'Read the pack info stored in a sticker',
    usage: '.exif (reply to a sticker)',
    async run({ m }) {
      if (m.quoted?.type !== 'stickerMessage') return m.reply('🏷️ Reply to a sticker with *.exif*')
      try {
        const webp = (await import('node-webpmux')).default
        const img = new webp.Image()
        await img.load(await m.quoted.download())
        if (!img.exif) return m.reply('🏷️ That sticker has no pack information.')
        // the JSON payload starts after the 22-byte EXIF header
        const json = JSON.parse(img.exif.slice(22).toString('utf-8'))
        await m.reply(
          `🏷️ *STICKER INFO*\n\n` +
            `📦 Pack: ${json['sticker-pack-name'] || 'none'}\n` +
            `👤 Author: ${json['sticker-pack-publisher'] || 'none'}\n` +
            `🆔 ID: ${json['sticker-pack-id'] || 'none'}\n` +
            `😀 Emojis: ${(json.emojis || []).join(' ') || 'none'}`
        )
      } catch (e) {
        await m.reply(`❌ Could not read the sticker metadata: ${e.message}`)
      }
    }
  },
  {
    name: 'doc',
    alias: ['todoc', 'tofile'],
    category: 'CONVERTER',
    desc: 'Resend media as a downloadable document',
    usage: '.doc (reply to media)',
    cooldown: 8,
    async run({ m }) {
      const src = mediaSource(m)
      if (!src) return m.reply('📄 Reply to any media with *.doc*')
      await m.react('📄')
      try {
        const buffer = await src.download()
        const ext = await extOf(buffer, 'bin')
        const mimes = {
          mp4: 'video/mp4', mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          png: 'image/png', webp: 'image/webp', ogg: 'audio/ogg', m4a: 'audio/mp4', pdf: 'application/pdf'
        }
        await m.reply({
          document: buffer,
          mimetype: mimes[ext] || 'application/octet-stream',
          fileName: `venom-md.${ext}`,
          caption: `📄 Sent as a document (${(buffer.length / 1048576).toFixed(2)} MB)`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'tovv',
    alias: ['toviewonce'],
    category: 'CONVERTER',
    desc: 'Resend an image or video as view-once',
    usage: '.tovv (reply to media)',
    cooldown: 8,
    async run({ m }) {
      const src = mediaSource(m)
      if (!src || !['imageMessage', 'videoMessage'].includes(src.type)) {
        return m.reply('👁️ Reply to an image or video with *.tovv*')
      }
      try {
        const buffer = await src.download()
        const key = src.type === 'imageMessage' ? 'image' : 'video'
        await m.reply({ [key]: buffer, viewOnce: true, caption: '👁️ View once' })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'aitts',
    alias: ['voicetts'],
    category: 'CONVERTER',
    desc: 'Read text aloud in a chosen language',
    usage: '.aitts en hello there',
    cooldown: 10,
    async run({ m, args }) {
      const lang = /^[a-z]{2}$/i.test(args[0] || '') ? args[0].toLowerCase() : 'en'
      const body = (/^[a-z]{2}$/i.test(args[0] || '') ? args.slice(1).join(' ') : args.join(' ')) || m.quoted?.text
      if (!body) return m.reply('🔊 Usage: *.aitts en hello there*\n\nLanguages: en es fr de pt ar hi ja ko ru')
      if (body.length > 200) return m.reply('❌ Keep it under 200 characters.')
      await m.react('🔊')
      try {
        const { getBuffer } = await import('../../src/lib/api.js')
        const { toPTT } = await import('../../src/lib/media.js')
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(body)}&tl=${lang}&client=tw-ob`
        const raw = await getBuffer(url, { headers: { Referer: 'https://translate.google.com/' } })
        await m.reply({ audio: await toPTT(raw, 'mp3'), mimetype: 'audio/ogg; codecs=opus', ptt: true })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
