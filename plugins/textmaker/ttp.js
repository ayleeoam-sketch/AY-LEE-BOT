import sharp from 'sharp'
import { toSticker, addExif } from '../../src/lib/media.js'
import config from '../../src/config.js'

/**
 * .ttp — text straight to a sticker, the single most-used command in most
 * WhatsApp bots and the one VENOM was missing.
 *
 * Rendered locally with SVG + sharp. Every bot that pipes this through
 * ephoto360 or an "attp API" breaks the week that service dies; this one
 * cannot, because there is nothing to break. Instant, offline, free.
 */

const PALETTES = {
  white: { fill: '#ffffff', stroke: '#000000' },
  black: { fill: '#111111', stroke: '#ffffff' },
  red: { fill: '#ff2d2d', stroke: '#3a0000' },
  blue: { fill: '#2d9bff', stroke: '#001a33' },
  green: { fill: '#39ff88', stroke: '#00331a' },
  yellow: { fill: '#ffd83d', stroke: '#332800' },
  pink: { fill: '#ff5ec4', stroke: '#33001f' },
  purple: { fill: '#b46bff', stroke: '#1f0033' },
  orange: { fill: '#ff9426', stroke: '#331a00' },
  venom: { fill: '#7CFC00', stroke: '#0a0a0a' }
}

const SIZE = 512

const escape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Wrap on words so long text stays inside the square. */
function layout(text) {
  const words = String(text).trim().split(/\s+/)
  const lines = []
  let line = ''
  const maxChars = words.length > 3 ? 12 : 10

  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line.trim())
      line = w
    } else {
      line = `${line} ${w}`.trim()
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 5)
}

/** Render text as a transparent 512x512 PNG. */
export async function renderTtp(text, palette = 'white') {
  const { fill, stroke } = PALETTES[palette] || PALETTES.white
  const lines = layout(text)
  const longest = Math.max(...lines.map((l) => l.length), 1)

  /*
   * Fit to the square. Bold DejaVu averages ~0.62em per character, so the
   * width budget is longest * fontSize * 0.62 - measured, not guessed, after
   * the first version clipped "much longer" off the edge.
   */
  const CHAR_W = 0.62
  const byWidth = (SIZE * 0.9) / (longest * CHAR_W)
  const byHeight = (SIZE * 0.78) / (lines.length * 1.12)
  const fontSize = Math.max(22, Math.min(150, Math.floor(Math.min(byWidth, byHeight))))
  const lineHeight = fontSize * 1.12
  const startY = SIZE / 2 - ((lines.length - 1) * lineHeight) / 2

  const tspans = lines
    .map(
      (l, i) =>
        `<text x="${SIZE / 2}" y="${startY + i * lineHeight}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="bold" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(3, fontSize / 14)}" ` +
        `paint-order="stroke fill">${escape(l)}</text>`
    )
    .join('')

  const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">${tspans}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export default [
  {
    name: 'ttp',
    alias: ['attp', 'textsticker', 'tsticker'],
    category: 'TEXTMAKER',
    desc: 'Turn text into a sticker',
    usage: '.ttp hello  |  .ttp red hello',
    cooldown: 3,
    async run({ m, args, text, prefix }) {
      let body = text
      let palette = 'white'

      // first word may be a colour
      if (args.length > 1 && PALETTES[args[0].toLowerCase()]) {
        palette = args[0].toLowerCase()
        body = args.slice(1).join(' ')
      }
      body = (body || m.quoted?.text || '').trim()

      if (!body) {
        return m.reply(
          `🔤 *Usage:* ${prefix}ttp <text>\n\n` +
            `Add a colour first:\n*${prefix}ttp venom GOAT*\n\n` +
            `*Colours:* ${Object.keys(PALETTES).join(', ')}\n\n` +
            `_Works on a reply too._`
        )
      }
      if (body.length > 60) return m.reply('❌ Keep it under 60 characters — stickers are small.')

      await m.react('🎨')
      try {
        const png = await renderTtp(body, palette)
        const webp = await toSticker(png, { animated: false })
        const final = await addExif(webp, config.botName, config.ownerName).catch(() => webp)
        await m.reply({ sticker: final })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'ttpimg',
    alias: ['ttpimage', 'textimage'],
    category: 'TEXTMAKER',
    desc: 'Same as .ttp but sends an image',
    usage: '.ttpimg venom GOAT',
    cooldown: 3,
    async run({ m, args, text, prefix }) {
      let body = text
      let palette = 'white'
      if (args.length > 1 && PALETTES[args[0].toLowerCase()]) {
        palette = args[0].toLowerCase()
        body = args.slice(1).join(' ')
      }
      body = (body || m.quoted?.text || '').trim()
      if (!body) return m.reply(`📝 Usage: ${prefix}ttpimg <text>`)

      await m.react('🎨')
      try {
        await m.reply({ image: await renderTtp(body, palette), caption: `🔤 ${body.slice(0, 60)}` })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
