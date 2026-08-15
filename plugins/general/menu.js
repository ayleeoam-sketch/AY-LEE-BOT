import os from 'os'
import { categories, pluginCount } from '../../src/lib/pluginLoader.js'
import { font, uptime, formatBytes } from '../../src/lib/utils.js'
import { getVar } from '../../src/lib/vars.js'

/**
 * Auto-generated menu.
 * Every plugin registers its own category, so this list grows by itself as
 * plugins are added - nothing here needs editing when you add a command.
 */

const header = (config) => `\`\`\`┌────═━┈ ${config.botName} ┈━═────┐
 ✇ ▸ Owner: ${config.ownerName}
 ✇ ▸ User: ${getVar('USER_TAG')}
 ✇ ▸ Plugins: ${pluginCount()}
 ✇ ▸ Uptime: ${uptime()}
 ✇ ▸ Memory: ${formatBytes(os.totalmem() - os.freemem())}
 ✇ ▸ Version: ${config.version}
 ✇ ▸ Platform: ${config.platform}
└───────═━┈┈━═──────┘\`\`\``

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

  async run({ m, text, config, prefix }) {
    /* .menu <category> -> just that block */
    if (text) {
      const query = text.trim().toUpperCase()

      // a category?
      if (categories.has(query)) {
        return m.reply(header(config) + block(query, categories.get(query)))
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
            `╰────────────────`
        )
      }

      return m.reply(
        `❌ No category or command called *${text}*.\n\nAvailable categories:\n${sortCategories()
          .map((c) => `• ${c}`)
          .join('\n')}`
      )
    }

    /* full menu */
    let out = header(config)
    out += '\n\u200e'.repeat(1)
    for (const cat of sortCategories()) {
      out += block(cat, categories.get(cat))
    }
    out += `\nTip: Use ${prefix}menu [category] for specific commands`

    return m.reply(out)
  }
}
