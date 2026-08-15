import sharp from 'sharp'
import { getBuffer } from '../../src/lib/api.js'

/**
 * Locally-rendered meme effects.
 *
 * The classic bot memes (wasted, rip, triggered, carbon...) all relied on
 * services that are now dead or key-gated. These are composited with sharp
 * instead, so they work forever and take about 200ms.
 */

async function sourceImage(sock, m) {
  const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
  if (src) return src.download()
  const target = m.mentions?.[0] || m.quoted?.sender || m.sender
  const url = await sock.profilePictureUrl(target, 'image')
  return getBuffer(url)
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** overlay an SVG on top of a square-cropped photo */
async function overlay(buffer, svg, size = 600) {
  const base = await sharp(buffer).resize(size, size, { fit: 'cover' }).png().toBuffer()
  return sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

const S = 600
const FONT = "'DejaVu Sans',sans-serif"

const memeCommand = ({ name, alias, label, desc, build, grey = false, tint = null }) => ({
  name,
  alias,
  category: 'IMAGE-MEME',
  desc,
  usage: `.${name} (reply to an image, or tag someone)`,
  cooldown: 6,
  async run({ sock, m, text }) {
    await m.react('🎨')
    try {
      let buffer = await sourceImage(sock, m)
      let pipeline = sharp(buffer).resize(S, S, { fit: 'cover' })
      if (grey) pipeline = pipeline.greyscale()
      if (tint) pipeline = pipeline.tint(tint)
      buffer = await pipeline.png().toBuffer()

      const out = await overlay(buffer, build(text?.trim() || ''), S)
      await m.reply({ image: out, caption: label })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      // a failed avatar fetch is the common case - say something useful
      const noImage =
        /profile|404|not.?found|protocol|ENOTFOUND|status code|not a media message|empty|download/i.test(e.message)
      await m.reply(
        noImage
          ? '🖼️ I need an image.\n\nReply to a photo with this command, or tag someone whose profile picture is visible to me.'
          : `❌ ${e.message}`
      )
    }
  }
})

export default [
  memeCommand({
    name: 'wasted', label: '💀 WASTED', desc: 'GTA "wasted" overlay', grey: true,
    build: () => `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="#000" opacity="0.42"/>
      <text x="${S / 2}" y="${S / 2 + 22}" font-family="${FONT}" font-size="82" font-weight="bold"
            fill="#c0392b" text-anchor="middle" stroke="#000" stroke-width="3" letter-spacing="6">WASTED</text>
    </svg>`
  }),
  memeCommand({
    name: 'rip-meme', alias: ['rip'], label: '🪦 R.I.P.', desc: 'Gravestone overlay', grey: true,
    build: (t) => `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="#000" opacity="0.5"/>
      <text x="${S / 2}" y="140" font-family="${FONT}" font-size="90" font-weight="bold"
            fill="#e8e8e8" text-anchor="middle" letter-spacing="10">R.I.P.</text>
      <text x="${S / 2}" y="${S - 70}" font-family="${FONT}" font-size="34"
            fill="#cfcfcf" text-anchor="middle">${esc(t || 'Gone but not forgotten')}</text>
      <text x="${S / 2}" y="${S - 25}" font-family="${FONT}" font-size="26" fill="#9a9a9a" text-anchor="middle">🕯️ ⚰️ 🕯️</text>
    </svg>`
  }),
  memeCommand({
    name: 'trigger-meme', alias: ['triggered'], label: '😡 TRIGGERED', desc: 'Triggered overlay',
    tint: { r: 255, g: 90, b: 60 },
    build: () => `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="#ff2200" opacity="0.22"/>
      <rect x="0" y="${S - 105}" width="${S}" height="105" fill="#c0140a"/>
      <text x="${S / 2}" y="${S - 36}" font-family="${FONT}" font-size="52" font-weight="bold"
            fill="#fff" text-anchor="middle" letter-spacing="4">TRIGGERED</text>
    </svg>`
  }),
  memeCommand({
    name: 'rainbow', alias: ['pride', 'gay'], label: '🌈 Rainbow', desc: 'Rainbow overlay',
    build: () => {
      const bands = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787']
      const h = S / bands.length
      return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
        ${bands.map((c, i) => `<rect x="0" y="${i * h}" width="${S}" height="${h}" fill="${c}" opacity="0.42"/>`).join('')}
      </svg>`
    }
  }),
  memeCommand({
    name: 'mnm', alias: ['moneyman'], label: '💰 Rich', desc: 'Money overlay',
    build: () => `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      ${Array.from({ length: 26 }, () => {
        const x = Math.random() * S, y = Math.random() * S, r = Math.random() * 28 + 22
        return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="${r.toFixed(0)}" opacity="0.9">💵</text>`
      }).join('')}
      <rect x="0" y="${S - 92}" width="${S}" height="92" fill="#0b6623" opacity="0.85"/>
      <text x="${S / 2}" y="${S - 32}" font-family="${FONT}" font-size="46" font-weight="bold"
            fill="#ffd700" text-anchor="middle">RICH 💰</text>
    </svg>`
  }),
  memeCommand({
    name: 'jailbars', alias: ['prison'], label: '🚔 Jailed', desc: 'Prison bars overlay', grey: true,
    build: () => `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="#000" opacity="0.28"/>
      ${Array.from({ length: 7 }, (_, i) =>
        `<rect x="${18 + i * 88}" y="0" width="26" height="${S}" fill="#2b2b2b" opacity="0.92" rx="4"/>`
      ).join('')}
      <rect x="0" y="0" width="${S}" height="22" fill="#2b2b2b"/>
      <rect x="0" y="${S - 22}" width="${S}" height="22" fill="#2b2b2b"/>
    </svg>`
  }),
  memeCommand({
    name: 'stonks', label: '📈 Stonks', desc: 'Stonks overlay',
    build: () => `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="#0a1f2e" opacity="0.35"/>
      <polyline points="40,520 160,430 260,470 380,250 500,150 560,90"
                fill="none" stroke="#00e676" stroke-width="10" stroke-linecap="round"/>
      <text x="${S / 2}" y="${S - 34}" font-family="${FONT}" font-size="60" font-weight="bold"
            fill="#00e676" text-anchor="middle" stroke="#003b1f" stroke-width="2">STONKS</text>
    </svg>`
  }),

  {
    name: 'carbon',
    alias: ['code2img'],
    category: 'IMAGE-MEME',
    desc: 'Turn code into a styled image',
    usage: '.carbon console.log("hi")',
    cooldown: 8,
    async run({ m, text }) {
      const code = text || m.quoted?.text
      if (!code) return m.reply('💻 Usage: *.carbon const x = 1*\n\nOr reply to a code message.')
      if (code.length > 1800) return m.reply('❌ Too long — keep it under 1800 characters.')

      await m.react('💻')
      try {
        const lines = code.split('\n').slice(0, 34)
        const lineH = 30
        const pad = 34
        const headerH = 46
        const width = Math.min(
          1100,
          Math.max(560, Math.max(...lines.map((l) => l.length)) * 10.2 + pad * 2 + 52)
        )
        const height = headerH + lines.length * lineH + pad * 2

        // very light syntax colouring - keywords, strings, comments, numbers
        const colour = (raw) => {
          let s = esc(raw)
          s = s.replace(/(\/\/.*)$/g, '<tspan fill="#6a9955">$1</tspan>')
          s = s.replace(/(&quot;[^&]*?&quot;|&apos;[^&]*?&apos;|`[^`]*?`)/g, '<tspan fill="#ce9178">$1</tspan>')
          s = s.replace(
            /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|try|catch|throw|typeof)\b/g,
            '<tspan fill="#569cd6">$1</tspan>'
          )
          s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<tspan fill="#b5cea8">$1</tspan>')
          s = s.replace(/\b(true|false|null|undefined)\b/g, '<tspan fill="#569cd6">$1</tspan>')
          return s
        }

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${height}" rx="14" fill="#1e1e1e"/>
          <rect width="${width}" height="${headerH}" rx="14" fill="#323233"/>
          <rect y="${headerH - 14}" width="${width}" height="14" fill="#323233"/>
          <circle cx="26" cy="23" r="7" fill="#ff5f56"/>
          <circle cx="50" cy="23" r="7" fill="#ffbd2e"/>
          <circle cx="74" cy="23" r="7" fill="#27c93f"/>
          <text x="${width - 18}" y="28" font-family="${FONT}" font-size="13" fill="#7a7a7a" text-anchor="end">VENOM MD</text>
          ${lines
            .map(
              (l, i) =>
                `<text x="${pad}" y="${headerH + pad + i * lineH}" font-family="monospace" font-size="17" fill="#4a4a4a">${String(i + 1).padStart(2, ' ')}</text>` +
                `<text x="${pad + 44}" y="${headerH + pad + i * lineH}" font-family="monospace" font-size="17" fill="#d4d4d4" xml:space="preserve">${colour(l)}</text>`
            )
            .join('')}
        </svg>`

        const buffer = await sharp(Buffer.from(svg)).png().toBuffer()
        await m.reply({ image: buffer, caption: '💻 *Carbon*' })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
