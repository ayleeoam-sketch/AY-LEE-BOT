import config from '../config.js'

/** 23 hours 35 minutes 50 seconds */
export function runtime(ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts = []
  if (d) parts.push(`${d} day${d > 1 ? 's' : ''}`)
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`)
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`)
  parts.push(`${sec} second${sec !== 1 ? 's' : ''}`)
  return parts.join(' ')
}

export const uptime = () => runtime(Date.now() - config.startTime)

/** 20.5 GB */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(decimals))} ${sizes[i]}`
}

/* Unicode font maps used by the menu */
const NORMAL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const ITALIC = '𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡0123456789'
const BOLD = '𝙖𝙗𝙘𝙙𝙚𝙛𝙜𝙝𝙞𝙟𝙠𝙡𝙢𝙣𝙤𝙥𝙦𝙧𝙨𝙩𝙪𝙫𝙬𝙭𝙮𝙯𝘼𝘽𝘾𝘿𝙀𝙁𝙂𝙃𝙄𝙅𝙆𝙇𝙈𝙉𝙊𝙋𝙌𝙍𝙎𝙏𝙐𝙑𝙒𝙓𝙔𝙕0123456789'
const MONO = '𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿'
const SERIF_BOLD_ITALIC = '𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁0123456789'

function convert(text, target) {
  const chars = [...target]
  return [...String(text)]
    .map((c) => {
      const i = NORMAL.indexOf(c)
      return i === -1 ? c : chars[i]
    })
    .join('')
}

export const font = {
  italic: (t) => convert(t, ITALIC),
  bold: (t) => convert(t, BOLD),
  mono: (t) => convert(t, MONO),
  fancy: (t) => convert(t, SERIF_BOLD_ITALIC)
}

/** Random element of an array. */
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/** Sleep. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 1234567 -> 1,234,567 */
export const comma = (n) => Number(n || 0).toLocaleString('en-US')

/** Digits-only number -> jid */
export const toJid = (number) => `${String(number).replace(/[^0-9]/g, '')}@s.whatsapp.net`

/** Extract urls from text */
export const urlsIn = (text) => String(text || '').match(/https?:\/\/[^\s]+/gi) || []

export default { runtime, uptime, formatBytes, font, pick, sleep, comma, toJid, urlsIn }
