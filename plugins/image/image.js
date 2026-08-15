import sharp from 'sharp'
import { getBuffer } from '../../src/lib/api.js'

/**
 * IMAGE + IMAGE-MEME commands.
 *
 * Two sources:
 *  - popcat.xyz  : verified working meme/filter endpoints (21 tested live)
 *  - sharp       : local filters, so the basics never depend on a service
 */

/** Get the image to operate on: attached, quoted, or the sender's avatar. */
async function sourceImage(sock, m) {
  const src =
    m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
  if (src) return { buffer: await src.download(), from: 'message' }

  const target = m.mentions?.[0] || m.quoted?.sender || m.sender
  try {
    const url = await sock.profilePictureUrl(target, 'image')
    return { buffer: await getBuffer(url), from: 'avatar', url }
  } catch {
    return null
  }
}

/** Upload a buffer somewhere popcat can fetch it from. */
async function hostImage(buffer) {
  // Catbox is a keyless, long-standing anonymous host
  const FormData = (await import('form-data')).default
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', buffer, { filename: 'image.jpg' })
  const axios = (await import('axios')).default
  const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 60_000
  })
  const url = String(data).trim()
  if (!/^https?:\/\//.test(url)) throw new Error('upload failed')
  return url
}

/** popcat effects that take an image url */
const POPCAT_IMAGE = {
  wanted: '🤠 Wanted poster',
  jail: '🚔 Behind bars',
  drip: '💧 Drip',
  blur: '🌫️ Blurred',
  invert: '🔄 Inverted',
  greyscale: '⚫ Greyscale',
  ad: '📺 Advertisement',
  communism: '☭ Communism',
  gun: '🔫 Gun',
  clown: '🤡 Clown',
  uncover: '🔍 Uncover'
}

/** popcat effects that take text */
const POPCAT_TEXT = {
  drake: { fields: 2, label: '🎵 Drake meme', usage: '.drake bugs | features' },
  pooh: { fields: 2, label: '🍯 Tuxedo Pooh', usage: '.pooh code | clean code' },
  oogway: { fields: 1, label: '🐢 Oogway quote', usage: '.oogway your wisdom' },
  biden: { fields: 1, label: '🇺🇸 Biden tweet', usage: '.biden your message' },
  alert: { fields: 1, label: '🚨 iPhone alert', usage: '.alert your warning' },
  caution: { fields: 1, label: '⚠️ Caution sign', usage: '.caution your text' },
  facts: { fields: 1, label: '📖 Facts book', usage: '.facts your statement' },
  sadcat: { fields: 1, label: '😿 Sad cat', usage: '.sadcat your text' },
  unforgivable: { fields: 1, label: '😤 Unforgivable', usage: '.unforgivable your text' }
}

const imageCommand = (name, label) => ({
  name,
  category: 'IMAGE-MEME',
  desc: `${label} effect`,
  usage: `.${name} (reply to an image, or tag someone)`,
  cooldown: 8,
  async run({ sock, m }) {
    await m.react('🎨')
    try {
      const src = await sourceImage(sock, m)
      if (!src) {
        await m.react('❌')
        return m.reply('🖼️ Reply to an image, or tag someone with a profile picture.')
      }
      const url = src.url || (await hostImage(src.buffer))
      const out = await getBuffer(
        `https://api.popcat.xyz/v2/${name}?image=${encodeURIComponent(url)}`,
        { timeout: 45_000 }
      )
      if (out.length < 2000) throw new Error('the effect service returned nothing')
      await m.reply({ image: out, caption: label })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

const textCommand = (name, { fields, label, usage }) => ({
  name,
  category: 'IMAGE-MEME',
  desc: `${label} meme`,
  usage,
  cooldown: 8,
  async run({ m, text }) {
    const body = text || m.quoted?.text
    if (!body) return m.reply(`📝 Usage: *${usage}*`)
    await m.react('🎨')
    try {
      let url
      if (fields === 2) {
        const [a, b] = body.includes('|') ? body.split('|').map((s) => s.trim()) : [body, '']
        if (!b) { await m.react('❌'); return m.reply(`📝 This meme needs two parts:\n*${usage}*`) }
        url = `https://api.popcat.xyz/v2/${name}?text1=${encodeURIComponent(a)}&text2=${encodeURIComponent(b)}`
      } else {
        url = `https://api.popcat.xyz/v2/${name}?text=${encodeURIComponent(body)}`
      }
      const out = await getBuffer(url, { timeout: 45_000 })
      if (out.length < 2000) throw new Error('the meme service returned nothing')
      await m.reply({ image: out, caption: label })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

/* local sharp filters - no network, always available */
const localFilter = (name, label, transform) => ({
  name,
  category: 'IMAGE',
  desc: `${label} an image`,
  usage: `.${name} (reply to an image)`,
  cooldown: 5,
  async run({ sock, m }) {
    await m.react('🎨')
    try {
      const src = await sourceImage(sock, m)
      if (!src) { await m.react('❌'); return m.reply('🖼️ Reply to an image or tag someone.') }
      const out = await transform(sharp(src.buffer)).png().toBuffer()
      await m.reply({ image: out, caption: `🎨 ${label}` })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

export default [
  ...Object.entries(POPCAT_IMAGE).map(([n, l]) => imageCommand(n, l)),
  ...Object.entries(POPCAT_TEXT).map(([n, cfg]) => textCommand(n, cfg)),

  /* ---- local, dependency-free image tools ---- */
  localFilter('grey', 'Greyscale', (s) => s.greyscale()),
  localFilter('sepia', 'Sepia tone', (s) => s.tint({ r: 112, g: 66, b: 20 })),
  localFilter('sharpen', 'Sharpen', (s) => s.sharpen({ sigma: 2 })),
  localFilter('flipv', 'Flip vertically', (s) => s.flip()),
  localFilter('flop', 'Mirror horizontally', (s) => s.flop()),
  localFilter('negate', 'Invert colours', (s) => s.negate()),
  localFilter('pixelate', 'Pixelate', (s) => s.resize(48, 48, { fit: 'inside' }).resize(600, null, { kernel: 'nearest' })),
  localFilter('blur2', 'Heavy blur', (s) => s.blur(14)),
  localFilter('rotate', 'Rotate 90°', (s) => s.rotate(90)),

  {
    name: 'compress',
    alias: ['shrink'],
    category: 'UTILITIES',
    desc: 'Shrink an image file size',
    usage: '.compress (reply to an image)',
    cooldown: 8,
    async run({ sock, m }) {
      await m.react('🗜️')
      try {
        const src = await sourceImage(sock, m)
        if (!src) { await m.react('❌'); return m.reply('🖼️ Reply to an image.') }
        const before = src.buffer.length
        const out = await sharp(src.buffer).jpeg({ quality: 55, mozjpeg: true }).toBuffer()
        const saved = Math.max(0, Math.round((1 - out.length / before) * 100))
        await m.reply({
          image: out,
          caption: `🗜️ *Compressed*\n📥 ${(before / 1024).toFixed(0)} KB → 📤 ${(out.length / 1024).toFixed(0)} KB\n💾 Saved ${saved}%`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'imageinfo',
    alias: ['iminfo'],
    category: 'IMAGE',
    desc: 'Show image dimensions and format',
    usage: '.imageinfo (reply to an image)',
    async run({ sock, m }) {
      try {
        const src = await sourceImage(sock, m)
        if (!src) return m.reply('🖼️ Reply to an image.')
        const i = await sharp(src.buffer).metadata()
        await m.reply(
          `🖼️ *IMAGE INFO*\n\n` +
            `📐 Size: ${i.width} x ${i.height}\n` +
            `🎨 Format: ${i.format}\n` +
            `📊 Channels: ${i.channels}\n` +
            `💾 File size: ${(src.buffer.length / 1024).toFixed(1)} KB\n` +
            `🔍 Density: ${i.density || 'n/a'}\n` +
            `✨ Alpha: ${i.hasAlpha ? 'yes' : 'no'}`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
