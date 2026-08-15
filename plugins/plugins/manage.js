import fs from 'fs'
import path from 'path'
import axios from 'axios'
import config from '../../src/config.js'
import { loadPlugins, categories, commands, pluginCount } from '../../src/lib/pluginLoader.js'

/**
 * Install / remove / hot-reload plugins while the bot is running.
 * No restart needed - the loader re-imports with a cache-busting query.
 */
export default [
  {
    name: 'plugin',
    alias: ['install', 'addplugin'],
    category: 'PLUGINS',
    desc: 'Install a plugin from a raw URL (pastebin/github raw)',
    usage: '.plugin <category>/<name> <raw-url>',
    owner: true,
    async run({ m, args }) {
      if (args.length < 2) {
        return m.reply('📝 Usage: .plugin fun/joke https://raw.githubusercontent.com/.../joke.js')
      }
      const [target, url] = args
      if (!/^https?:\/\//.test(url)) return m.reply('❌ Second argument must be a raw URL.')

      try {
        const { data } = await axios.get(url, { timeout: 20000, responseType: 'text' })
        if (!/export\s+default/.test(data)) {
          return m.reply('❌ That file does not look like a plugin (no `export default`).')
        }
        const rel = target.endsWith('.js') ? target : `${target}.js`
        const dest = path.join(config.pluginDir, rel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, data)

        await loadPlugins()
        await m.reply(`✅ Installed *${rel}*\n🔌 Plugins now loaded: ${pluginCount()}`)
      } catch (e) {
        await m.reply(`❌ Install failed: ${e.message}`)
      }
    }
  },
  {
    name: 'delplugin',
    alias: ['uninstall', 'rmplugin'],
    category: 'PLUGINS',
    desc: 'Delete an installed plugin file',
    usage: '.delplugin <category>/<name>',
    owner: true,
    async run({ m, args }) {
      if (!args[0]) return m.reply('📝 Usage: .delplugin fun/joke')
      const rel = args[0].endsWith('.js') ? args[0] : `${args[0]}.js`
      const target = path.join(config.pluginDir, rel)
      if (!fs.existsSync(target)) return m.reply(`❌ Not found: ${rel}`)
      fs.unlinkSync(target)
      await loadPlugins()
      await m.reply(`🗑️ Removed *${rel}*\n🔌 Plugins now loaded: ${pluginCount()}`)
    }
  },
  {
    name: 'plugins',
    alias: ['listplugins'],
    category: 'PLUGINS',
    desc: 'List every loaded plugin file by category',
    usage: '.plugins',
    owner: true,
    async run({ m }) {
      let out = `🔌 *${pluginCount()} plugins loaded*\n`
      for (const [cat, list] of categories) {
        out += `\n*${cat}* (${list.length})\n${list.map((p) => `  • ${p.name}`).join('\n')}\n`
      }
      await m.reply(out)
    }
  },
  {
    name: 'reload',
    alias: ['rl', 'refresh'],
    category: 'PLUGINS',
    desc: 'Hot-reload all plugins without restarting',
    usage: '.reload',
    owner: true,
    async run({ m }) {
      const before = pluginCount()
      await loadPlugins()
      await m.reply(`♻️ Reloaded.\nBefore: ${before} plugins\nAfter: ${pluginCount()} plugins`)
    }
  }
]
