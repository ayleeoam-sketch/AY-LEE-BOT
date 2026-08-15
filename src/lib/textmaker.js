import axios from 'axios'
import { URLSearchParams } from 'url'

/**
 * ephoto360 / textpro.me text-effect generator.
 *
 * Both sites share the same Laravel form flow:
 *   1. GET the effect page  -> csrf token + build_server + session cookie
 *   2. POST /effect/create-image with the token and the user's text
 *   3. the JSON response gives an image path on the build server
 *
 * There is no public API, so this scrapes the form. It is the only way to
 * offer these effects - if a site changes its markup, the helper throws a
 * clear error and the plugin reports it rather than crashing.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const pick = (html, name) =>
  html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ||
  html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`))?.[1] ||
  null

/**
 * Render a text effect.
 * @param {string} pageUrl full effect page url
 * @param {string[]} texts one entry per input the effect needs
 * @returns {Promise<string>} direct image url
 */
export async function makeText(pageUrl, texts) {
  const origin = new URL(pageUrl).origin

  /* 1. load the form */
  const page = await axios.get(pageUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    timeout: 30_000
  })
  const html = String(page.data)
  const cookies = (page.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')

  const token = pick(html, 'token')
  const buildServer = pick(html, 'build_server')
  const buildServerId = pick(html, 'build_server_id')
  if (!token || !buildServer) {
    throw new Error('The effect site changed its layout - this effect is temporarily unavailable.')
  }

  /* the page declares which radio/select options the effect expects */
  const submit = pick(html, 'submit') || 'Go'

  /* 2. submit the form */
  const form = new URLSearchParams()
  for (const t of texts) form.append('text[]', t)
  form.append('token', token)
  form.append('build_server', buildServer)
  if (buildServerId) form.append('build_server_id', buildServerId)
  form.append('submit', submit)

  const res = await axios.post(`${origin}/effect/create-image`, form.toString(), {
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: origin,
      Referer: pageUrl,
      Cookie: cookies
    },
    timeout: 45_000
  })

  const data = res.data
  /* the response shape differs slightly between the two sites */
  const image =
    data?.fullsize_image ||
    data?.image ||
    (data?.session_id && data?.name ? `${data.session_id}/${data.name}` : null)

  if (!image) {
    throw new Error('The effect site did not return an image. Try again in a moment.')
  }

  return /^https?:/.test(image) ? image : `${buildServer}${image}`
}

/** Every effect, keyed by the command name from the original menu. */
export const EFFECTS = {
  /* ---- ephoto360 ---- */
  neonlight: { url: 'https://en.ephoto360.com/create-glowing-neon-light-text-effect-online-free-706.html', inputs: 1 },
  typography: { url: 'https://en.ephoto360.com/create-a-3d-typography-text-effect-online-585.html', inputs: 1 },
  wetglass: { url: 'https://en.ephoto360.com/write-text-on-wet-glass-online-589.html', inputs: 1 },
  light: { url: 'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-676.html', inputs: 1 },
  pubgtext: { url: 'https://en.ephoto360.com/create-pubg-battlegrounds-logo-online-534.html', inputs: 2 },
  pubglogo: { url: 'https://en.ephoto360.com/create-pubg-battlegrounds-logo-online-534.html', inputs: 2 },
  valorant: { url: 'https://en.ephoto360.com/make-a-valorant-logo-with-the-online-avatar-generator-788.html', inputs: 2 },
  codtext: { url: 'https://en.ephoto360.com/create-a-cod-mobile-logo-online-772.html', inputs: 2 },
  lolwlp: { url: 'https://en.ephoto360.com/create-league-of-legends-logo-online-free-774.html', inputs: 2 },
  amongus: { url: 'https://en.ephoto360.com/create-among-us-logo-online-free-762.html', inputs: 1 },
  angel: { url: 'https://en.ephoto360.com/write-text-on-wings-of-an-angel-online-663.html', inputs: 1 },
  green: { url: 'https://en.ephoto360.com/create-a-green-brush-text-effect-online-free-1050.html', inputs: 1 },
  neontext: { url: 'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html', inputs: 1 },
  glow: { url: 'https://en.ephoto360.com/create-glowing-text-effects-online-free-793.html', inputs: 1 },
  lightb: { url: 'https://en.ephoto360.com/light-effect-text-online-generator-701.html', inputs: 1 },
  glitter: { url: 'https://en.ephoto360.com/write-glitter-text-online-free-577.html', inputs: 1 },
  watercolor: { url: 'https://en.ephoto360.com/watercolor-text-effect-online-538.html', inputs: 1 },
  paper: { url: 'https://en.ephoto360.com/create-3d-paper-cut-out-text-effect-online-570.html', inputs: 1 },
  glitch: { url: 'https://en.ephoto360.com/create-a-cyberpunk-style-glitch-text-effect-online-680.html', inputs: 2 },
  metal: { url: 'https://en.ephoto360.com/create-a-3d-metal-text-effect-online-free-599.html', inputs: 1 },
  galaxy: { url: 'https://en.ephoto360.com/create-galaxy-style-text-effect-online-free-679.html', inputs: 1 },
  blue: { url: 'https://en.ephoto360.com/create-a-blue-neon-text-effect-online-1049.html', inputs: 1 },
  galaxyw: { url: 'https://en.ephoto360.com/galaxy-style-wallpaper-with-your-name-812.html', inputs: 1 },
  glossy: { url: 'https://en.ephoto360.com/create-a-glossy-3d-text-effect-online-565.html', inputs: 1 },
  glass2: { url: 'https://en.ephoto360.com/create-a-3d-glass-text-effect-online-free-1035.html', inputs: 1 },
  glow2: { url: 'https://en.ephoto360.com/create-neon-glow-text-effects-online-free-724.html', inputs: 1 },
  wood: { url: 'https://en.ephoto360.com/create-a-3d-wooden-text-effect-online-free-1051.html', inputs: 1 },
  slight: { url: 'https://en.ephoto360.com/create-shadow-light-text-effect-online-free-1041.html', inputs: 1 },
  sketch: { url: 'https://en.ephoto360.com/create-a-pencil-sketch-text-effect-online-free-1040.html', inputs: 1 },
  zodiac: { url: 'https://en.ephoto360.com/create-a-zodiac-constellation-text-effect-online-free-1030.html', inputs: 1 },
  floral: { url: 'https://en.ephoto360.com/create-a-floral-text-effect-online-free-1029.html', inputs: 1 },
  hacker: { url: 'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-technology-643.html', inputs: 1 },
  neondvl: { url: 'https://en.ephoto360.com/create-a-neon-devil-wings-text-effect-online-free-1014.html', inputs: 1 },
  crack: { url: 'https://en.ephoto360.com/create-a-cracked-stone-text-effect-online-free-1027.html', inputs: 1 },
  scifi: { url: 'https://en.ephoto360.com/create-a-sci-fi-text-effect-online-free-1026.html', inputs: 1 },
  sand: { url: 'https://en.ephoto360.com/write-names-on-the-sand-online-free-1025.html', inputs: 1 },
  letter: { url: 'https://en.ephoto360.com/write-text-on-a-love-letter-online-free-1024.html', inputs: 1 },
  gaming: { url: 'https://en.ephoto360.com/create-a-gaming-logo-online-free-1013.html', inputs: 2 },

  /* ---- textpro.me ---- */
  thunder: { url: 'https://textpro.me/create-a-thunder-text-effect-online-free-1088.html', inputs: 1 },
  matrix: { url: 'https://textpro.me/matrix-style-text-effect-online-884.html', inputs: 1 },
  steel: { url: 'https://textpro.me/create-a-3d-steel-text-effect-online-free-1006.html', inputs: 1 },
  fire: { url: 'https://textpro.me/create-burning-fire-text-effect-online-free-1043.html', inputs: 1 },
  blackpink: { url: 'https://textpro.me/create-blackpink-logo-style-online-1001.html', inputs: 1 },
  bear: { url: 'https://textpro.me/create-a-cute-bear-text-effect-online-1076.html', inputs: 1 },
  neon3d: { url: 'https://textpro.me/create-3d-neon-light-text-effect-online-1074.html', inputs: 1 }
}

export const effectNames = () => Object.keys(EFFECTS)
