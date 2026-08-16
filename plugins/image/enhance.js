import sharp from 'sharp'
import { extOf } from '../../src/lib/media.js'

/**
 * Photo enhance / upscale. Pure local sharp, no AI API key:
 * 2x lanczos upscale + auto normalise + mild sharpen. Honest upgrade,
 * no fake "AI Remini" label - it makes screenshots and compressed
 * WhatsApp forwards noticeably cleaner.
 *
 *   .enhance (reply to an image)
 */

export async function enhanceImage(buffer) {
  const meta = await sharp(buffer).metadata()
  const w = meta.width || 0
  if (!w) throw new Error('that does not look like an image')
  if (Math.max(w, meta.height || 0) > 4096) throw new Error('image already large / too big to enhance safely')

  const scale = Math.min(2, 2200 / Math.max(w, meta.height || 1))
  return sharp(buffer)
    .resize({
      width: Math.round(w * scale),
      height: Math.round((meta.height || 1) * scale),
      kernel: 'lanczos3'
    })
    .normalise()
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, -0.4, 0, -0.4, 2.6, -0.4, 0, -0.4, 0]
    })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer()
}

export default {
  name: 'enhance',
  alias: ['upscale', 'hq', 'hd'],
  category: 'IMAGE',
  desc: 'Upscale and sharpen a photo (2x, local)',
  usage: '.enhance (reply to an image)',
  cooldown: 15,
  async run({ m }) {
    const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
    if (!src) return m.reply('✨ Reply to an image with *.enhance*')

    await m.react('⏳')
    try {
      const buffer = await src.download()
      const before = (buffer.length / 1024).toFixed(0)
      const out = await enhanceImage(buffer)
      const after = (out.length / 1024).toFixed(0)
      await m.reply({
        image: out,
        caption: `✨ *Enhanced* - upscaled, normalised, sharpened\n📦 ${before}KB → ${after}KB`
      })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
}
