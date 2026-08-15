import { setVar, delVar, allVars, getVar, SCHEMA } from '../../src/lib/vars.js'

/**
 * Runtime configuration without touching .env or redeploying.
 * Values are persisted in MongoDB so they survive restarts.
 */
export default [
  {
    name: 'setvar',
    alias: ['set'],
    category: 'CONFIG',
    desc: 'Change a setting at runtime',
    usage: '.setvar KEY value   (e.g. .setvar MODE private)',
    owner: true,
    async run({ m, args }) {
      if (args.length < 2) {
        return m.reply(
          `📝 *Usage:* .setvar KEY value\n\n*Available keys:*\n` +
            Object.entries(SCHEMA)
              .map(([k, v]) => `• ${k} (${v.type === 'enum' ? v.values.join('/') : v.type})`)
              .join('\n')
        )
      }
      const [key, ...rest] = args
      try {
        const value = await setVar(key, rest.join(' '))
        await m.reply(`✅ *${key.toUpperCase()}* set to *${value}*`)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'getvar',
    alias: ['get'],
    category: 'CONFIG',
    desc: 'Read one setting',
    usage: '.getvar KEY',
    owner: true,
    async run({ m, args }) {
      if (!args[0]) return m.reply('📝 Usage: .getvar KEY')
      const value = getVar(args[0])
      if (value === undefined) return m.reply(`❌ Unknown var: ${args[0].toUpperCase()}`)
      await m.reply(`🔧 *${args[0].toUpperCase()}* = *${value}*`)
    }
  },
  {
    name: 'delvar',
    alias: ['unset'],
    category: 'CONFIG',
    desc: 'Reset a setting back to its .env default',
    usage: '.delvar KEY',
    owner: true,
    async run({ m, args }) {
      if (!args[0]) return m.reply('📝 Usage: .delvar KEY')
      await delVar(args[0])
      await m.reply(`♻️ *${args[0].toUpperCase()}* reset to its .env default (${getVar(args[0])})`)
    }
  },
  {
    name: 'allvar',
    alias: ['vars', 'listvar', 'settings'],
    category: 'CONFIG',
    desc: 'Show every setting and where it comes from',
    usage: '.allvar',
    owner: true,
    async run({ m }) {
      const rows = allVars()
        .map((v) => `│ ${v.source === 'db' ? '🔵' : '⚪'} ${v.key}: *${v.value}*`)
        .join('\n')
      await m.reply(
        `╭─── *BOT SETTINGS* ───\n${rows}\n╰──────────────\n\n🔵 = changed at runtime  ⚪ = from .env\nChange with: .setvar KEY value`
      )
    }
  },
  {
    name: 'mode',
    category: 'CONFIG',
    desc: 'Switch between public / private / group / inbox',
    usage: '.mode public',
    owner: true,
    async run({ m, args }) {
      if (!args[0]) return m.reply(`🌐 Current mode: *${getVar('MODE')}*\n\nUsage: .mode public|private|group|inbox`)
      try {
        const value = await setVar('MODE', args[0])
        await m.reply(`✅ Mode switched to *${value}*`)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
