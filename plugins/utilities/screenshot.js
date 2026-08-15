import { getBuffer, race } from '../../src/lib/api.js'

/**
 * Website screenshots.
 * thum.io is keyless and fast; microlink is the fallback.
 * Both verified live.
 */

const normalise = (input) => {
  let url = String(input || '').trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  try {
    const u = new URL(url)
    // block obvious SSRF targets - this runs on your server
    const host = u.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new Error('blocked')
    }
    return u.toString()
  } catch {
    return null
  }
}

const shoot = async (url, { width = 1280, full = false, crop = 1200 } = {}) =>
  race([
    () =>
      getBuffer(
        `https://image.thum.io/get/width/${width}/${full ? 'fullpage' : `crop/${crop}`}/noanimate/${url}`,
        { timeout: 60_000 }
      ),
    () =>
      getBuffer(
        `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url` +
          (full ? '&fullPage=true' : ''),
        { timeout: 60_000 }
      )
  ])

const ssCommand = ({ name, alias, label, desc, opts }) => ({
  name,
  alias,
  category: 'UTILITIES',
  desc,
  usage: `.${name} https://example.com`,
  cooldown: 15,
  async run({ m, text }) {
    const raw = text || m.quoted?.text
    const url = normalise(raw)
    if (!url) {
      return m.reply(
        raw
          ? '❌ That is not a valid public URL.'
          : `🌐 Give me a website:\n*.${name} github.com*`
      )
    }

    await m.react('📸')
    try {
      const buffer = await shoot(url, opts)
      if (buffer.length < 3000) throw new Error('the screenshot service returned an empty image')
      await m.reply({
        image: buffer,
        caption: `📸 *${label}*\n🔗 ${url}`
      })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ Could not capture that page: ${e.message}`)
    }
  }
})

export default [
  ssCommand({
    name: 'ss', alias: ['screenshot', 'sshot'], label: 'Desktop screenshot',
    desc: 'Screenshot a website (desktop view)', opts: { width: 1280, crop: 1000 }
  }),
  ssCommand({
    name: 'ssfull', alias: ['fullss'], label: 'Full page screenshot',
    desc: 'Screenshot an entire page top to bottom', opts: { width: 1280, full: true }
  }),
  ssCommand({
    name: 'ssphone', alias: ['ssmobile'], label: 'Mobile screenshot',
    desc: 'Screenshot a website in mobile width', opts: { width: 480, crop: 900 }
  }),
  ssCommand({
    name: 'sstab', alias: ['sstablet'], label: 'Tablet screenshot',
    desc: 'Screenshot a website in tablet width', opts: { width: 820, crop: 1100 }
  }),
  {
    name: 'qrcode',
    alias: ['qr', 'makeqr'],
    category: 'UTILITIES',
    desc: 'Turn text or a link into a QR code',
    usage: '.qrcode https://example.com',
    cooldown: 5,
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('🔳 Give me text or a link:\n*.qrcode https://example.com*')
      if (body.length > 900) return m.reply('❌ Too long for a QR code (max 900 characters).')
      await m.react('🔳')
      try {
        // rendered locally so there is no service to fail
        const QR = (await import('qrcode')).default
        const buffer = await QR.toBuffer(body, { width: 600, margin: 2, errorCorrectionLevel: 'M' })
        await m.reply({ image: buffer, caption: `🔳 *QR code*\n\n${body.slice(0, 200)}` })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'readqr',
    alias: ['scanqr', 'decodeqr'],
    category: 'UTILITIES',
    desc: 'Read the contents of a QR code image',
    usage: '.readqr (reply to a QR image)',
    cooldown: 10,
    async run({ m }) {
      const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
      if (!src) return m.reply('🔳 Reply to an image containing a QR code.')
      await m.react('🔍')
      try {
        const jsQR = (await import('jsqr')).default
        const sharp = (await import('sharp')).default
        const buffer = await src.download()
        const { data, info } = await sharp(buffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        const result = jsQR(new Uint8ClampedArray(data), info.width, info.height)
        if (!result?.data) {
          await m.react('❌')
          return m.reply('❌ No QR code found in that image. Try a clearer, closer photo.')
        }
        await m.reply(`🔳 *QR contents*\n\n${result.data.slice(0, 1500)}`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
