import { dbStats, sweep, compact, human } from '../../src/lib/cleanup.js'
import { isMongo, backend } from '../../src/lib/database.js'
import { getVar, setVar } from '../../src/lib/vars.js'
import config from '../../src/config.js'

/**
 * Storage tools. Atlas M0 is 512 MB and gives no warning before it stops
 * accepting writes, so the owner needs to see the number and be able to act
 * on it from chat.
 */

export default [
  {
    name: 'dbsize',
    alias: ['dbstats', 'storage', 'dbinfo2'],
    category: 'BOT',
    desc: 'How much database space is used, and by what',
    usage: '.dbsize',
    owner: true,
    cooldown: 20,
    async run({ m, prefix }) {
      await m.react('⏳')
      const s = await dbStats()

      const rows = s.collections
        .slice(0, 10)
        .map((c) => `┃ ${c.name.padEnd(12).slice(0, 12)} ${human(c.bytes).padStart(9)}${c.count !== null ? ` · ${c.count}` : ''}`)
        .join('\n')

      const bar = s.mongo
        ? (() => {
            const filled = Math.min(18, Math.round((s.pct / 100) * 18))
            return `${'█'.repeat(filled)}${'░'.repeat(18 - filled)} ${s.pct}%`
          })()
        : ''

      await m.reply(
        `╭━━━〔 🗄️ *STORAGE* 〕━━━╮\n` +
          `┃ 📦 Backend: *${backend()}*\n` +
          `┃ 📊 Used: *${human(s.bytes)}*${s.mongo ? ` of 512 MB` : ''}\n` +
          (bar ? `┃ ${bar}\n` : '') +
          `┃ 🏷️ Database: ${config.mongoDb}\n` +
          `╰━━━━━━━━━━━━━━━━━╯\n\n` +
          `*Biggest collections*\n${rows || '_empty_'}\n\n` +
          (s.mongo && s.pct >= 80
            ? `⚠️ *Filling up.* Run *${prefix}dbclean deep*, or move to your own cluster with *${prefix}setmongo <uri>*.\n\n`
            : '') +
          `_Clean spent records: ${prefix}dbclean · preview first: ${prefix}dbclean dry_`
      )
      await m.react('✅')
    }
  },
  {
    name: 'dbclean',
    alias: ['cleandb', 'vacuum', 'gc'],
    category: 'BOT',
    desc: 'Delete spent records to free database space',
    usage: '.dbclean  |  .dbclean dry  |  .dbclean deep',
    owner: true,
    cooldown: 60,
    async run({ m, args, prefix }) {
      const mode = (args[0] || '').toLowerCase()
      const dry = mode === 'dry' || mode === 'preview'
      const deep = mode === 'deep' || mode === 'hard'

      await m.react('🧹')
      const before = await dbStats()
      const res = await sweep({ deep, dry })

      const lines = Object.entries(res.removed)
        .map(([k, v]) => `┃ ${dry ? '•' : '🗑️'} ${k}: *${v}*`)
        .join('\n')

      if (!res.total) {
        await m.react('✅')
        return m.reply(
          `✨ *Nothing to clean.* Everything stored is still in use.\n\n` +
            `Used: *${human(before.bytes)}*${before.mongo ? ` of 512 MB (${before.pct}%)` : ''}\n\n` +
            (deep ? '' : `_Also try *${prefix}dbclean deep* to prune spent WhatsApp pre-keys._`)
        )
      }

      let after = before
      if (!dry) {
        if (deep) await compact()
        after = await dbStats()
      }

      await m.reply(
        `╭━━━〔 🧹 *${dry ? 'PREVIEW' : 'CLEANED'}* 〕━━━╮\n${lines}\n` +
          `┃ ━━━━━━━━━━━━━\n` +
          `┃ 📊 Total: *${res.total}* records\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n` +
          (dry
            ? `_Nothing was deleted. Run *${prefix}dbclean* to do it for real._`
            : `Storage: *${human(before.bytes)}* → *${human(after.bytes)}*` +
              (after.mongo ? ` (${after.pct}% of 512 MB)` : '') +
              `\n\n_Kept: balances, roles, settings, group config and your login. ` +
              `Removed only records that were already spent.` +
              (res.note.length ? ` ${res.note.join('; ')}.` : '') +
              `_`)
      )
      await m.react('✅')
    }
  },
  {
    name: 'dbkeep',
    alias: ['retention', 'setretention'],
    category: 'BOT',
    desc: 'How many days of history to keep',
    usage: '.dbkeep 90',
    owner: true,
    async run({ m, args, prefix }) {
      const n = parseInt(args[0])
      if (!Number.isFinite(n) || n < 7 || n > 3650) {
        return m.reply(
          `🗓️ *Usage:* ${prefix}dbkeep <days>\n\n` +
            `Currently keeping *${getVar('DB_RETAIN_DAYS')}* days of class attendance and AFK history.\n` +
            `Minimum 7. Balances, roles and settings are never touched by age.\n\n` +
            `Auto-clean is *${String(getVar('DB_AUTOCLEAN')) === 'false' ? 'off' : 'on'}* ` +
            `(every 6h). Toggle: *${prefix}setvar DB_AUTOCLEAN false*`
        )
      }
      await setVar('DB_RETAIN_DAYS', n)
      await m.reply(`🗓️ Keeping *${n}* days of history. Next sweep applies it — or run *${prefix}dbclean* now.`)
    }
  }
]
