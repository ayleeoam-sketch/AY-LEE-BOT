import os from 'os'
import fs from 'fs'
import path from 'path'
import { ROOT } from '../../src/config.js'
import { categories, pluginCount } from '../../src/lib/pluginLoader.js'
import { font, uptime, formatBytes } from '../../src/lib/utils.js'
import { getVar } from '../../src/lib/vars.js'
import { CREATOR, creatorPromo } from '../../src/branding.js'

/**
 * Auto-generated menu.
 * Every plugin registers its own category, so this list grows by itself as
 * plugins are added - nothing here needs editing when you add a command.
 */

const header = (config) => `\`\`\`┌────═━┈ ${config.botName} ┈━═────┐
 ✇ ▸ Creator: ${CREATOR.name}
 ✇ ▸ Number: ${CREATOR.number}
 ✇ ▸ User: ${getVar('USER_TAG')}
 ✇ ▸ Plugins: ${pluginCount()}
 ✇ ▸ Uptime: ${uptime()}
 ✇ ▸ Memory: ${formatBytes(os.totalmem() - os.freemem())}
 ✇ ▸ Version: ${config.version}
 ✇ ▸ Platform: ${config.platform}
└───────═━┈┈━═──────┘\`\`\``

/**
 * Send the menu as an image with the text as its caption, the way most
 * WhatsApp bots present it.
 *
 * The image is resolved in this order, so the menu never fails to send:
 *   1. MENU_IMAGE  - a URL or a local path you set in .env / .setvar
 *   2. assets/menu.jpg - shipped with the bot
 *   3. the bot's own profile picture
 *   4. no image at all - fall back to a plain text reply
 *
 * WhatsApp caps a caption around 1024 characters before it collapses behind
 * "Read more". The full menu is far longer than that, which is fine - the
 * reference bot behaves the same way - but a category menu stays short.
 */
async function sendMenu(sock, m, caption, config) {
  let image = null

  const source = (getVar('MENU_IMAGE') || '').trim()
  try {
    if (/^https?:\/\//i.test(source)) {
      const { getBuffer } = await import('../../src/lib/api.js')
      image = await getBuffer(source, { timeout: 20_000 })
    } else if (source && fs.existsSync(source)) {
      image = fs.readFileSync(source)
    }
  } catch {}

  if (!image) {
    const bundled = path.join(ROOT, 'assets', 'menu.jpg')
    if (fs.existsSync(bundled)) {
      try {
        image = fs.readFileSync(bundled)
      } catch {}
    }
  }

  if (!image) {
    try {
      const { getBuffer } = await import('../../src/lib/api.js')
      const url = await sock.profilePictureUrl(m.botJid, 'image')
      image = await getBuffer(url, { timeout: 15_000 })
    } catch {}
  }

  if (image && image.length > 1000) {
    try {
      return await m.reply({ image, caption })
    } catch {
      /* sending the image failed - fall through to text */
    }
  }
  return m.reply(caption)
}

/** Renders one category block in the style you specified. */
function block(name, plugins) {
  const lines = plugins
    .filter((p) => !p.hidden)
    .map((p) => `│ ${font.italic(p.name)}`)
    .join('\n')
  if (!lines) return ''
  return (
    `\n ┏ ${font.mono(name)} ┓\n` +
    `┍   ─┉─ • ─┉─    ┑ \n` +
    `${lines}\n` +
    `┕    ─┉─ • ─┉─   ┙ \n`
  )
}

/** Order categories so the important ones surface first. */
const ORDER = [
  'HELP', 'AI', 'ANIME', 'FUN', 'DOWNLOADER', 'CONVERTER', 'SEARCH',
  'ECONOMY', 'TEXTMAKER', 'GAME', 'GROUP', 'TOOLS', 'IMAGE', 'IMAGE-MEME',
  'BOT', 'PROCESS', 'MISC', 'UTILITIES', 'PLUGINS', 'CONFIG', 'USER',
  'PRIVACY', 'AUTOREPLY'
]

const sortCategories = () => {
  const keys = [...categories.keys()]
  return keys.sort((a, b) => {
    const ia = ORDER.indexOf(a)
    const ib = ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

export default {
  name: 'menu',
  alias: ['help', 'list', 'commands', 'allmenu'],
  category: 'HELP',
  desc: 'Show every command, or one category',
  usage: '.menu [category]',
  cooldown: 3,

  async run({ sock, m, text, config, prefix }) {
    /* .menu <category> -> just that block */
    if (text) {
      const query = text.trim().toUpperCase()

      // a category?
      if (categories.has(query)) {
        return sendMenu(
          sock,
          m,
          header(config) + block(query, categories.get(query)) + `\n${creatorPromo(prefix)}`,
          config
        )
      }

      // a single command? show its help card
      const all = [...categories.values()].flat()
      const cmd = all.find(
        (p) => p.name === text.toLowerCase() || (p.alias || []).includes(text.toLowerCase())
      )
      if (cmd) {
        return m.reply(
          `╭─── *${cmd.name.toUpperCase()}* ───\n` +
            `│ 📁 Category: ${cmd.category}\n` +
            `│ 📝 ${cmd.desc || 'No description'}\n` +
            `│ 💡 Usage: ${cmd.usage || prefix + cmd.name}\n` +
            (cmd.alias?.length ? `│ 🔗 Aliases: ${cmd.alias.join(', ')}\n` : '') +
            (cmd.cooldown ? `│ ⏳ Cooldown: ${cmd.cooldown}s\n` : '') +
            (cmd.owner ? `│ 👑 Owner only\n` : '') +
            (cmd.admin ? `│ 🛡️ Admin only\n` : '') +
            (cmd.group ? `│ 👥 Groups only\n` : '') +
            `╰────────────────\n\n` +
            creatorPromo(prefix)
        )
      }

      return m.reply(
        `❌ No category or command called *${text}*.\n\nAvailable categories:\n${sortCategories()
          .map((c) => `• ${c}`)
          .join('\n')}\n\n${creatorPromo(prefix)}`
      )
    }

    /* full menu */
    let out = header(config)
    out += '\n\u200e'.repeat(1)
    for (const cat of sortCategories()) {
      out += block(cat, categories.get(cat))
    }
    out += `\n${creatorPromo(prefix)}`

    return sendMenu(sock, m, out, config)
  }
}
