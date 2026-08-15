import sharp from 'sharp'

/**
 * Local text-effect renderer.
 *
 * The original menu used ephoto360 / textpro.me. Both have hardened against
 * scraping - every form variant now returns {"success":false,"code":-1}, so
 * commands built on them would be dead on arrival.
 *
 * Instead these effects are rendered locally with SVG + sharp. That means:
 *   - no external service to rate-limit, block, or disappear
 *   - instant (about 100ms instead of several seconds)
 *   - works offline and on any host
 *
 * Each effect is a function returning an SVG string, rasterised to PNG.
 */

const W = 1200
const H = 500

/** escape user text for safe SVG embedding */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** shrink the font when the text is long so it always fits */
const fit = (text, base = 130, max = 9) => {
  const len = [...String(text)].length
  if (len <= max) return base
  return Math.max(34, Math.floor(base * (max / len)))
}

const FONT = "'DejaVu Sans','Liberation Sans',sans-serif"

/* --------------------------- effect library --------------------------- */

const EFFECTS = {
  neonlight: (t, c = '#00eaff', bg = '#05050c', core = '#e8ffff') => `
    <defs>
      <filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="20"/>
      </filter>
      <filter id="g2" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="9"/>
      </filter>
    </defs>
    <rect width="${W}" height="${H}" fill="${bg}"/>
    <text x="${W / 2}" y="${H / 2 + 45}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="${c}" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 45}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="${c}" text-anchor="middle" filter="url(#g2)" opacity="0.95">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 45}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="${core}" text-anchor="middle">${esc(t)}</text>`,

  neontext: (t) => EFFECTS.neonlight(t, '#ff2bd6', '#0d0210', '#ffe6fb'),
  blue: (t) => EFFECTS.neonlight(t, '#2b6bff', '#02061a', '#e6efff'),
  green: (t) => EFFECTS.neonlight(t, '#38ff7a', '#02120a', '#e9fff937'.slice(0,7)),
  glow: (t) => EFFECTS.neonlight(t, '#ffd400', '#120e01', '#fffbe6'),
  glow2: (t) => EFFECTS.neonlight(t, '#ff6a00', '#120701', '#fff0e6'),
  lightb: (t) => EFFECTS.neonlight(t, '#9fd8ff', '#03060d', '#ffffff'),

  neondvl: (t) => `
    <defs><filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="18"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#0a0004"/>
    <text x="${W / 2}" y="${H / 2 - 60}" font-size="86" text-anchor="middle">😈</text>
    <text x="${W / 2}" y="${H / 2 + 75}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ff1744" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 75}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ffe3e8" text-anchor="middle">${esc(t)}</text>`,

  glitch: (t) => `
    <rect width="${W}" height="${H}" fill="#07070f"/>
    <text x="${W / 2 - 7}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ff003c" text-anchor="middle" opacity="0.85">${esc(t)}</text>
    <text x="${W / 2 + 7}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#00fff2" text-anchor="middle" opacity="0.85">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ffffff" text-anchor="middle">${esc(t)}</text>
    <g opacity="0.28">
      ${Array.from({ length: 22 }, (_, i) => `<rect x="0" y="${i * 23}" width="${W}" height="5" fill="#000"/>`).join('')}
    </g>`,

  hacker: (t) => `
    <rect width="${W}" height="${H}" fill="#000"/>
    <g font-family="monospace" font-size="17" fill="#0f0" opacity="0.30">
      ${Array.from({ length: 15 }, (_, r) =>
        `<text x="8" y="${22 + r * 33}">${Array.from({ length: 74 }, () => (Math.random() > 0.5 ? 1 : 0)).join('')}</text>`
      ).join('')}
    </g>
    <defs><filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="14"/></filter></defs>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="monospace" font-size="${fit(t, 115)}" font-weight="bold"
          fill="#00ff41" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="monospace" font-size="${fit(t, 115)}" font-weight="bold"
          fill="#d9ffe4" text-anchor="middle">${esc(t)}</text>`,

  matrix: (t) => EFFECTS.hacker(t),

  galaxy: (t) => `
    <defs>
      <radialGradient id="bg" cx="50%" cy="50%">
        <stop offset="0%" stop-color="#3d1a6b"/><stop offset="55%" stop-color="#160c2e"/>
        <stop offset="100%" stop-color="#04030a"/>
      </radialGradient>
      <linearGradient id="tx" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff8ae2"/><stop offset="50%" stop-color="#a78bfa"/>
        <stop offset="100%" stop-color="#67e8f9"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${Array.from({ length: 150 }, () => {
      const x = Math.random() * W, y = Math.random() * H, r = Math.random() * 1.9
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(Math.random() * 0.8 + 0.2).toFixed(2)}"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#tx)" text-anchor="middle">${esc(t)}</text>`,

  galaxyw: (t) => EFFECTS.galaxy(t),

  fire: (t) => `
    <defs>
      <linearGradient id="fg" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#ff0000"/><stop offset="45%" stop-color="#ff8c00"/>
        <stop offset="100%" stop-color="#ffe259"/>
      </linearGradient>
      <filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="16"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="#0d0400"/>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ff6a00" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#fg)" text-anchor="middle">${esc(t)}</text>`,

  metal: (t) => `
    <defs>
      <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="35%" stop-color="#9aa4b2"/>
        <stop offset="55%" stop-color="#4b5563"/><stop offset="75%" stop-color="#d1d5db"/>
        <stop offset="100%" stop-color="#6b7280"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#12141a"/>
    <text x="${W / 2}" y="${H / 2 + 42}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#mg)" text-anchor="middle" stroke="#1f2937" stroke-width="2">${esc(t)}</text>`,

  steel: (t) => EFFECTS.metal(t),

  gold: (t) => `
    <defs>
      <linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff6c4"/><stop offset="40%" stop-color="#f5c542"/>
        <stop offset="70%" stop-color="#b8860b"/><stop offset="100%" stop-color="#ffdf70"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#0f0b02"/>
    <text x="${W / 2}" y="${H / 2 + 42}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#gg)" text-anchor="middle" stroke="#7a5c00" stroke-width="2">${esc(t)}</text>`,

  glossy: (t) => `
    <defs>
      <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7dd3fc"/><stop offset="49%" stop-color="#0284c7"/>
        <stop offset="51%" stop-color="#01497c"/><stop offset="100%" stop-color="#38bdf8"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#03121f"/>
    <text x="${W / 2}" y="${H / 2 + 42}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#gl)" text-anchor="middle" stroke="#e0f2fe" stroke-width="1.5">${esc(t)}</text>`,

  glass2: (t) => `
    <rect width="${W}" height="${H}" fill="#0b1220"/>
    <rect x="60" y="120" width="${W - 120}" height="${H - 240}" rx="26"
          fill="#ffffff" opacity="0.07" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>
    <text x="${W / 2}" y="${H / 2 + 38}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ffffff" fill-opacity="0.92" text-anchor="middle">${esc(t)}</text>`,

  wetglass: (t) => `
    <rect width="${W}" height="${H}" fill="#16323d"/>
    ${Array.from({ length: 90 }, () => {
      const x = Math.random() * W, y = Math.random() * H, r = Math.random() * 7 + 2
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#dbeafe" opacity="0.18"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#e0f2fe" fill-opacity="0.85" text-anchor="middle">${esc(t)}</text>`,

  water: (t) => EFFECTS.wetglass(t),

  watercolor: (t) => `
    <defs>
      <linearGradient id="wc" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f472b6"/><stop offset="35%" stop-color="#a78bfa"/>
        <stop offset="70%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#34d399"/>
      </linearGradient>
      <filter id="bl"><feGaussianBlur stdDeviation="2.2"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="#fffdf7"/>
    ${Array.from({ length: 22 }, () => {
      const x = Math.random() * W, y = Math.random() * H, r = Math.random() * 105 + 35
      const c = ['#f9a8d4', '#c4b5fd', '#93c5fd', '#6ee7b7', '#fde68a'][Math.floor(Math.random() * 5)]
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${c}" opacity="0.30" filter="url(#bl)"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#wc)" text-anchor="middle">${esc(t)}</text>`,

  floral: (t) => `
    <rect width="${W}" height="${H}" fill="#fff7fb"/>
    ${Array.from({ length: 34 }, () => {
      const x = Math.random() * W, y = Math.random() * H, s = Math.random() * 22 + 12
      const c = ['#f9a8d4', '#fbcfe8', '#fda4af', '#ddd6fe', '#bbf7d0'][Math.floor(Math.random() * 5)]
      return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="${s.toFixed(0)}" fill="${c}">❀</text>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#be185d" text-anchor="middle">${esc(t)}</text>`,

  zodiac: (t) => `
    <defs><radialGradient id="zb" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#1e1b4b"/><stop offset="100%" stop-color="#020617"/>
    </radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#zb)"/>
    ${Array.from({ length: 110 }, () => {
      const x = Math.random() * W, y = Math.random() * H
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(Math.random() * 1.7).toFixed(1)}" fill="#fef3c7" opacity="${(Math.random() * 0.9 + 0.1).toFixed(2)}"/>`
    }).join('')}
    ${Array.from({ length: 7 }, (_, i) => {
      const x1 = 180 + i * 140, y1 = 110 + (i % 3) * 90
      const x2 = 180 + (i + 1) * 140, y2 = 110 + ((i + 1) % 3) * 90
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fcd34d" stroke-width="1.3" opacity="0.55"/>
              <circle cx="${x1}" cy="${y1}" r="4" fill="#fde68a"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 60}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#fde68a" text-anchor="middle">${esc(t)}</text>`,

  sand: (t) => `
    <defs><linearGradient id="sb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fde9c8"/><stop offset="100%" stop-color="#d3a15f"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sb)"/>
    ${Array.from({ length: 900 }, () => {
      const x = Math.random() * W, y = Math.random() * H
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="0.9" fill="#a97d40" opacity="0.35"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#7c4a17" fill-opacity="0.82" text-anchor="middle">${esc(t)}</text>`,

  wood: (t) => `
    <defs><linearGradient id="wb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b5a2b"/><stop offset="100%" stop-color="#5c3317"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#wb)"/>
    ${Array.from({ length: 30 }, (_, i) =>
      `<rect x="0" y="${i * 17}" width="${W}" height="${Math.random() * 5 + 1.5}" fill="#4a2810" opacity="0.28"/>`
    ).join('')}
    <text x="${W / 2}" y="${H / 2 + 42}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#f5deb3" text-anchor="middle" stroke="#3b2410" stroke-width="2">${esc(t)}</text>`,

  crack: (t) => `
    <rect width="${W}" height="${H}" fill="#3f3f46"/>
    ${Array.from({ length: 26 }, () => {
      const x = Math.random() * W, y = Math.random() * H
      return `<path d="M${x.toFixed(0)},${y.toFixed(0)} l${(Math.random() * 110 - 55).toFixed(0)},${(Math.random() * 110 - 55).toFixed(0)} l${(Math.random() * 80 - 40).toFixed(0)},${(Math.random() * 80 - 40).toFixed(0)}"
        stroke="#18181b" stroke-width="${(Math.random() * 3 + 1).toFixed(1)}" fill="none" opacity="0.75"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 42}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#e4e4e7" text-anchor="middle" stroke="#27272a" stroke-width="2.5">${esc(t)}</text>`,

  scifi: (t) => `
    <defs>
      <linearGradient id="sf" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#3b82f6"/>
      </linearGradient>
      <filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="13"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="#030711"/>
    ${Array.from({ length: 16 }, (_, i) =>
      `<line x1="0" y1="${i * 32}" x2="${W}" y2="${i * 32}" stroke="#0ea5e9" stroke-width="0.6" opacity="0.16"/>`
    ).join('')}
    ${Array.from({ length: 20 }, (_, i) =>
      `<line x1="${i * 62}" y1="0" x2="${i * 62}" y2="${H}" stroke="#0ea5e9" stroke-width="0.6" opacity="0.16"/>`
    ).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#22d3ee" text-anchor="middle" filter="url(#g)" letter-spacing="6">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#sf)" text-anchor="middle" letter-spacing="6">${esc(t)}</text>`,

  thunder: (t) => `
    <defs><filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="15"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#050510"/>
    ${Array.from({ length: 7 }, () => {
      const x = Math.random() * W
      return `<path d="M${x.toFixed(0)},0 l${(Math.random() * 50 - 25).toFixed(0)},${(H / 3).toFixed(0)} l${(Math.random() * 40 - 20).toFixed(0)},${(H / 4).toFixed(0)} l${(Math.random() * 50 - 25).toFixed(0)},${(H / 2.5).toFixed(0)}"
        stroke="#a5f3fc" stroke-width="2.2" fill="none" opacity="0.5"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#38bdf8" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#f0f9ff" text-anchor="middle">${esc(t)}</text>`,

  sketch: (t) => `
    <rect width="${W}" height="${H}" fill="#faf9f6"/>
    ${Array.from({ length: 45 }, () =>
      `<line x1="${(Math.random() * W).toFixed(0)}" y1="${(Math.random() * H).toFixed(0)}"
             x2="${(Math.random() * W).toFixed(0)}" y2="${(Math.random() * H).toFixed(0)}"
             stroke="#d4d4d8" stroke-width="0.6" opacity="0.5"/>`
    ).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="none" text-anchor="middle" stroke="#3f3f46" stroke-width="2.2"
          stroke-dasharray="7,3">${esc(t)}</text>`,

  paper: (t) => `
    <rect width="${W}" height="${H}" fill="#f4f1ea"/>
    <text x="${W / 2 + 6}" y="${H / 2 + 46}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#c7c2b6" text-anchor="middle">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#2f2f2f" text-anchor="middle">${esc(t)}</text>`,

  glitter: (t) => `
    <defs><linearGradient id="gt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde68a"/><stop offset="50%" stop-color="#f9a8d4"/>
      <stop offset="100%" stop-color="#a5b4fc"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#12091b"/>
    ${Array.from({ length: 230 }, () => {
      const x = Math.random() * W, y = Math.random() * H
      const c = ['#fde68a', '#f9a8d4', '#a5b4fc', '#fff'][Math.floor(Math.random() * 4)]
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(Math.random() * 2.3).toFixed(1)}" fill="${c}" opacity="${(Math.random() * 0.9 + 0.1).toFixed(2)}"/>`
    }).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#gt)" text-anchor="middle">${esc(t)}</text>`,

  typography: (t) => `
    <defs><linearGradient id="ty" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f97316"/><stop offset="100%" stop-color="#db2777"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#111827"/>
    ${Array.from({ length: 7 }, (_, i) =>
      `<text x="${W / 2 + (7 - i) * 3}" y="${H / 2 + 40 + (7 - i) * 3}" font-family="${FONT}"
             font-size="${fit(t)}" font-weight="bold" fill="#1f2937" text-anchor="middle">${esc(t)}</text>`
    ).join('')}
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="url(#ty)" text-anchor="middle">${esc(t)}</text>`,

  slight: (t) => `
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="${W / 2 + 9}" y="${H / 2 + 49}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#000" fill-opacity="0.6" text-anchor="middle">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#f8fafc" text-anchor="middle">${esc(t)}</text>`,

  light: (t) => `
    <defs><radialGradient id="lb" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#020617"/>
    </radialGradient>
    <filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="20"/></filter></defs>
    <rect width="${W}" height="${H}" fill="url(#lb)"/>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#93c5fd" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t)}" font-weight="bold"
          fill="#ffffff" text-anchor="middle">${esc(t)}</text>`,

  letter: (t) => `
    <rect width="${W}" height="${H}" fill="#fff8f0"/>
    <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="#e8b4b8" stroke-width="3" rx="10"/>
    <text x="${W / 2}" y="140" font-family="${FONT}" font-size="52" fill="#e11d48" text-anchor="middle">♥</text>
    <text x="${W / 2}" y="${H / 2 + 55}" font-family="${FONT}" font-size="${fit(t, 100)}" font-style="italic"
          fill="#9f1239" text-anchor="middle">${esc(t)}</text>`,

  amongus: (t) => `
    <rect width="${W}" height="${H}" fill="#0b1021"/>
    ${Array.from({ length: 70 }, () =>
      `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="${(Math.random() * 1.6).toFixed(1)}" fill="#fff" opacity="0.7"/>`
    ).join('')}
    <g transform="translate(${W / 2 - 300},${H / 2 - 70})">
      <ellipse cx="0" cy="40" rx="52" ry="66" fill="#c51111"/>
      <rect x="-56" y="72" width="34" height="46" rx="12" fill="#c51111"/>
      <rect x="22" y="72" width="34" height="46" rx="12" fill="#c51111"/>
      <ellipse cx="18" cy="18" rx="34" ry="24" fill="#a5d8ff" stroke="#7fb2d8" stroke-width="4"/>
    </g>
    <text x="${W / 2 + 70}" y="${H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 110)}" font-weight="bold"
          fill="#fff" text-anchor="middle">${esc(t)}</text>`,

  angel: (t) => `
    <defs><radialGradient id="ab" cx="50%" cy="40%">
      <stop offset="0%" stop-color="#fffbe8"/><stop offset="100%" stop-color="#dbeafe"/>
    </radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#ab)"/>
    <text x="${W / 2}" y="${H / 2 - 60}" font-size="86" text-anchor="middle">😇</text>
    <text x="220" y="${H / 2 + 40}" font-size="120" opacity="0.55">🕊️</text>
    <text x="${W - 220}" y="${H / 2 + 40}" font-size="120" opacity="0.55">🕊️</text>
    <text x="${W / 2}" y="${H / 2 + 70}" font-family="${FONT}" font-size="${fit(t, 105)}" font-weight="bold"
          fill="#b45309" text-anchor="middle">${esc(t)}</text>`,

  /* two-line "logo" style effects */
  gaming: (t, t2 = '') => `
    <defs><linearGradient id="gm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
    <filter id="g" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="15"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#0a0118"/>
    <text x="${W / 2}" y="${t2 ? H / 2 - 5 : H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 120)}"
          font-weight="bold" fill="#a855f7" text-anchor="middle" filter="url(#g)">${esc(t)}</text>
    <text x="${W / 2}" y="${t2 ? H / 2 - 5 : H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 120)}"
          font-weight="bold" fill="url(#gm)" text-anchor="middle">${esc(t)}</text>
    ${t2 ? `<text x="${W / 2}" y="${H / 2 + 110}" font-family="${FONT}" font-size="${fit(t2, 74)}"
          fill="#e9d5ff" text-anchor="middle" letter-spacing="8">${esc(t2)}</text>` : ''}`,

  pubgtext: (t, t2 = '') => `
    <rect width="${W}" height="${H}" fill="#1a1a0d"/>
    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f5d020"/><stop offset="100%" stop-color="#c08a00"/>
    </linearGradient></defs>
    <text x="${W / 2}" y="${t2 ? H / 2 : H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 118)}"
          font-weight="bold" fill="url(#pg)" text-anchor="middle" stroke="#5c4400" stroke-width="2.5">${esc(t)}</text>
    ${t2 ? `<text x="${W / 2}" y="${H / 2 + 105}" font-family="${FONT}" font-size="${fit(t2, 70)}"
          fill="#fff3b0" text-anchor="middle" letter-spacing="10">${esc(t2)}</text>` : ''}`,

  valorant: (t, t2 = '') => `
    <rect width="${W}" height="${H}" fill="#0f1923"/>
    <text x="${W / 2}" y="${t2 ? H / 2 : H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 118)}"
          font-weight="bold" fill="#ff4655" text-anchor="middle" letter-spacing="5">${esc(t)}</text>
    ${t2 ? `<text x="${W / 2}" y="${H / 2 + 105}" font-family="${FONT}" font-size="${fit(t2, 68)}"
          fill="#ece8e1" text-anchor="middle" letter-spacing="12">${esc(t2)}</text>` : ''}`,

  codtext: (t, t2 = '') => `
    <rect width="${W}" height="${H}" fill="#141414"/>
    ${Array.from({ length: 20 }, (_, i) =>
      `<line x1="0" y1="${i * 26}" x2="${W}" y2="${i * 26}" stroke="#2a2a2a" stroke-width="1"/>`
    ).join('')}
    <text x="${W / 2}" y="${t2 ? H / 2 : H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 116)}"
          font-weight="bold" fill="#d9d9d9" text-anchor="middle" stroke="#000" stroke-width="2">${esc(t)}</text>
    ${t2 ? `<text x="${W / 2}" y="${H / 2 + 105}" font-family="${FONT}" font-size="${fit(t2, 66)}"
          fill="#8a8a8a" text-anchor="middle" letter-spacing="9">${esc(t2)}</text>` : ''}`,

  lolwlp: (t, t2 = '') => `
    <defs><linearGradient id="lo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c8aa6e"/><stop offset="100%" stop-color="#785a28"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#010a13"/>
    <text x="${W / 2}" y="${t2 ? H / 2 : H / 2 + 40}" font-family="${FONT}" font-size="${fit(t, 116)}"
          font-weight="bold" fill="url(#lo)" text-anchor="middle" letter-spacing="4">${esc(t)}</text>
    ${t2 ? `<text x="${W / 2}" y="${H / 2 + 105}" font-family="${FONT}" font-size="${fit(t2, 66)}"
          fill="#cdbe91" text-anchor="middle" letter-spacing="10">${esc(t2)}</text>` : ''}`,

  blackpink: (t) => `
    <rect width="${W}" height="${H}" fill="#000"/>
    <rect x="50" y="${H / 2 - 100}" width="${W - 100}" height="200" fill="none" stroke="#ff2d87" stroke-width="6"/>
    <text x="${W / 2}" y="${H / 2 + 38}" font-family="${FONT}" font-size="${fit(t, 112)}" font-weight="bold"
          fill="#ff2d87" text-anchor="middle" letter-spacing="7">${esc(t)}</text>`
}

/* aliases so every original menu name resolves to something */
EFFECTS.pubglogo = EFFECTS.pubgtext
EFFECTS.neon3d = EFFECTS.neonlight
EFFECTS.bear = EFFECTS.floral

/**
 * Render an effect to a PNG buffer.
 * @param {string} name effect key
 * @param {string} text primary text
 * @param {string} text2 optional second line for logo effects
 */
export async function renderEffect(name, text, text2 = '') {
  const fn = EFFECTS[name]
  if (!fn) throw new Error(`Unknown effect: ${name}`)
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${fn(text, text2)}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export const effectList = () => Object.keys(EFFECTS).sort()
export const hasEffect = (n) => Object.hasOwn(EFFECTS, n)
export const TWO_LINE = ['gaming', 'pubgtext', 'pubglogo', 'valorant', 'codtext', 'lolwlp']

export default { renderEffect, effectList, hasEffect, TWO_LINE }
