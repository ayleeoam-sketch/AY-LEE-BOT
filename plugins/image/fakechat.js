import sharp from 'sharp'

/**
 * Fake WhatsApp chat screenshot - viral prank / meme material.
 *
 *   .fakechat Tunde |Hey you good?|Yeah man what's up|pls send 5k
 *
 * Bubbles ALTERNATE sides: first message from the named contact (left),
 * second from "you" (right), and so on. Rendered locally via sharp - no
 * external service, no key, works offline.
 */

/* ------------------------- svg helpers ------------------------- */

export const escSvg = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Greedy word wrap by character count (SVG text has no auto-wrap). */
export function wrapLine(text, max = 34) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (next.length > max && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines.slice(0, 6) // hard cap per bubble
}

/** Build the whole chat as an SVG string. Exported for tests. */
export function buildChatSvg(name, messages) {
  const W = 800
  const HEADER_H = 112
  const PadX = 26
  const maxBubble = 560
  const bubText = 30
  let y = HEADER_H + 26

  const bubbles = []
  messages.slice(0, 8).forEach((text, i) => {
    const side = i % 2 ? 'me' : 'them'
    const lines = wrapLine(text)
    const bw = Math.min(maxBubble, Math.max(...lines.map((l) => l.length), 6) * (bubText * 0.52) + 44)
    const bh = lines.length * 40 + 30
    const x = side === 'me' ? W - PadX - bw : PadX
    const fill = side === 'me' ? '#005c4b' : '#202c33'
    const spans = lines.map(
      (l, k) =>
        `<text x="${x + 22}" y="${y + 42 + k * 40}" fill="#e9edef" font-size="${bubText}" font-family="DejaVu Sans, Noto Color Emoji, Noto Emoji, Segoe UI Emoji, Arial, sans-serif">${escSvg(l)}</text>`
    )
    bubbles.push(
      `<rect x="${x}" y="${y}" rx="18" ry="18" width="${bw}" height="${bh}" fill="${fill}"/>\n${spans.join('\n')}`
    )
    y += bh + 20
  })

  const H = Math.max(240, y + 30)
  const initial = escSvg((name || '?').trim().slice(0, 1).toUpperCase())
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0b141a"/>
  <rect width="${W}" height="${HEADER_H}" fill="#202c33"/>
  <circle cx="60" cy="${HEADER_H / 2}" r="34" fill="#6b7f8b"/>
  <text x="60" y="${HEADER_H / 2 + 12}" text-anchor="middle" font-size="40" fill="#e9edef" font-family="DejaVu Sans, Arial, sans-serif">${initial}</text>
  <text x="116" y="${HEADER_H / 2 - 2}" font-size="34" fill="#e9edef" font-family="DejaVu Sans, Arial, sans-serif">${escSvg(name)}</text>
  <text x="116" y="${HEADER_H / 2 + 34}" font-size="24" fill="#8696a0" font-family="DejaVu Sans, Arial, sans-serif">online</text>
  ${bubbles.join('\n')}
</svg>`
  return svg
}

export default {
  name: 'fakechat',
  alias: ['fakeconvo', 'chatprank'],
  category: 'IMAGE-MEME',
  desc: 'Generate a fake WhatsApp chat screenshot',
  usage: '.fakechat Name | message from them | reply from you | ...',
  cooldown: 10,
  async run({ m, text }) {
    const [name, ...msgs] = String(text || '').split('|').map((s) => s.trim())
    if (!name || !msgs.length) {
      return m.reply(
        '😹 *.fakechat* makes a fake chat screenshot,\n' +
          'messages alternate: them | you | them | you...\n\n' +
          '*.fakechat Tunde | hey | what\'s good | send my money 😭*'
      )
    }
    if (msgs.length > 8) return m.reply('😹 Max 8 messages so the screenshot stays readable.')

    await m.react('😹')
    try {
      const svg = buildChatSvg(name, msgs.filter(Boolean))
      const png = await sharp(Buffer.from(svg)).png().toBuffer()
      await m.reply({ image: png, caption: `😹 Fake chat with *${name}*` })
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
}
