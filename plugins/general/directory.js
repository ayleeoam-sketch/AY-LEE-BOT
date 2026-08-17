/**
 * Command directory - one message that maps the whole bot.
 *
 *   .cmds      -> every category with what it does + how to open it
 *   .menu <category>  -> the actual command list for one section
 *   .menu <command>   -> how to use a single command
 *
 * This is the answer to "the bot has 500+ commands, how does anyone know?".
 * Auto-generated from the loaded plugins, so it never needs editing when a
 * new category is added.
 */
import { categories, pluginCount } from '../../src/lib/pluginLoader.js'
import { getVar } from '../../src/lib/vars.js'
import { creatorPromo } from '../../src/branding.js'

/** Emoji + one-liner per category. Anything missing falls back automatically. */
const META = {
  HELP: { e: '📚', about: 'menus & directories' },
  SPORTS: { e: '⚽', about: 'football predictions' },
  ECONOMY: { e: '💰', about: 'coins, jobs, casino' },
  FUN: { e: '🎮', about: 'games, gifs, reactions' },
  DOWNLOADER: { e: '🎵', about: 'youtube, tiktok, music' },
  AI: { e: '🤖', about: 'chat & image AI' },
  TEXTMAKER: { e: '🎨', about: 'text effects & stickers' },
  CONVERTER: { e: '🔧', about: 'stickers, audio, video' },
  GROUP: { e: '👥', about: 'group admin tools' },
  SEARCH: { e: '🔍', about: 'search the web' },
  UTILITIES: { e: '🛠️', about: 'handy everyday tools' },
  IMAGE: { e: '📸', about: 'photo effects' },
  'IMAGE-MEME': { e: '😂', about: 'meme makers' },
  GAME: { e: '🎲', about: 'play with friends' },
  USER: { e: '👤', about: 'profile & personal' },
  TOOLS: { e: '🧰', about: 'afk, reminders, snipe' },
  CONFIG: { e: '⚙️', about: 'bot settings' },
  BOT: { e: '🛡️', about: 'bot management' },
  PRIVACY: { e: '🔒', about: 'who sees what' },
  AUTOREPLY: { e: '📢', about: 'auto replies & filters' },
  ANIME: { e: '🌸', about: 'anime info & gifs' },
  MISC: { e: '✨', about: 'odds & ends' },
  PLUGINS: { e: '🧩', about: 'manage plugins' },
  PROCESS: { e: '🔄', about: 'restart & status' }
}

/** Categories the directory surfaces first - the rest append alphabetically. */
const ORDER = [
  'SPORTS', 'ECONOMY', 'FUN', 'DOWNLOADER', 'AI', 'TEXTMAKER', 'CONVERTER',
  'GROUP', 'SEARCH', 'UTILITIES', 'IMAGE-MEME', 'IMAGE', 'GAME', 'USER',
  'TOOLS', 'CONFIG', 'BOT', 'PRIVACY', 'AUTOREPLY', 'ANIME', 'MISC',
  'PLUGINS', 'PROCESS', 'HELP'
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

/** Owner-only commands, auto-collected from every loaded plugin. */
const OWNER_FIRST = [
  'ban', 'unban', 'setpp', 'setname', 'bio', 'block', 'unblock', 'broadcast',
  'setvar', 'clone', 'unclone', 'predkey', 'setmongo', 'restart', 'shutdown',
  'addsudo', 'delsudo', 'school', 'setcmd', 'delcmd'
]

function ownerCommands(limit = 14) {
  const names = [
    ...new Set(
      [...categories.values()].flat().filter((p) => p.owner && !p.hidden).map((p) => p.name)
    )
  ].sort()
  const prio = OWNER_FIRST.filter((n) => names.includes(n))
  const rest = names.filter((n) => !OWNER_FIRST.includes(n))
  const ordered = [...prio, ...rest]
  return { shown: ordered.slice(0, limit), rest: ordered.length - ordered.slice(0, limit).length }
}

export default [
  {
    name: 'cmds',
    alias: ['categories', 'directory', 'allcmds', 'guide'],
    category: 'HELP',
    desc: 'One message mapping every category of the bot',
    usage: '.cmds',
    cooldown: 3,
    async run({ m, prefix }) {
      const total = pluginCount()
      const lines = []

      lines.push(`📚 *COMMAND DIRECTORY* — ${getVar('BOT_NAME') || 'VENOM MD BOT'}`)
      lines.push(`${categories.size} categories · ${total} commands · all in one place`)
      lines.push('')
      lines.push('┌─── ⭐ *START HERE* ───')
      lines.push(`│ ${prefix}menu            → the full command list`)
      lines.push(`│ ${prefix}menu <category> → open one section`)
      lines.push(`│ ${prefix}menu <command>  → how to use one command`)
      lines.push(`│ ${prefix}cmds            → this directory`)
      lines.push(`│ ${prefix}pred            → today's football picks`)
      lines.push(`│ ${prefix}ping            → check the bot`)
      lines.push('└─────────────────────')
      lines.push('')

      for (const name of sortCategories()) {
        const plugins = categories.get(name).filter((p) => !p.hidden)
        const meta = META[name] || {
          e: '📁',
          about: plugins[0]?.desc || 'commands'
        }
        lines.push(`${meta.e} *${name}* (${plugins.length}) → ${prefix}menu ${name.toLowerCase()}`)
        lines.push(`   ${meta.about}`)
        lines.push('')
      }

      const owner = ownerCommands()
      lines.push(`👑 *OWNER ONLY* (${owner.shown.length + owner.rest}) — runs only for the bot owner:`)
      lines.push(owner.shown.map((n) => `${prefix}${n}`).join('  '))
      if (owner.rest > 0) lines.push(`   +${owner.rest} more in their categories above`)
      lines.push('')
      lines.push(creatorPromo(prefix))

      return m.reply(lines.join('\n'))
    }
  }
]
