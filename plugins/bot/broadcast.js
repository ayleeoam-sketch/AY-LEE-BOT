import config from '../../src/config.js'
import DB from '../../src/lib/database.js'
import { backend } from '../../src/lib/database.js'
import { pluginCount } from '../../src/lib/pluginLoader.js'
import { getVar } from '../../src/lib/vars.js'
import { toJid } from '../../src/lib/utils.js'
import { getJson } from '../../src/lib/api.js'
import { fmtDuration } from '../../src/lib/downloader.js'

/**
 * Owner reach + housekeeping: the commands every mature bot ends up needing
 * once it is in more than a handful of groups.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const numberOf = (jid) => String(jid).split('@')[0].split(':')[0]

export default [
  {
    name: 'broadcast',
    alias: ['bc', 'bcast'],
    category: 'BOT',
    desc: 'Send a message to every group the bot is in',
    usage: '.broadcast Server maintenance at 10pm',
    owner: true,
    cooldown: 60,
    async run({ sock, m, text, prefix }) {
      if (!text) {
        return m.reply(
          `📢 *Usage:* ${prefix}broadcast <message>\n\n` +
            `Goes to every group I am in, with a header so nobody thinks it is spam from a member.\n\n` +
            `_Sent one at a time with a pause — blasting them in parallel is how numbers get banned._`
        )
      }

      const groups = Object.values(await sock.groupFetchAllParticipating())
      if (!groups.length) return m.reply('📭 I am not in any groups yet.')

      await m.reply(`📢 Broadcasting to *${groups.length}* group${groups.length === 1 ? '' : 's'}...`)

      const body =
        `╭━━━〔 *${config.botName}* 〕━━━╮\n` +
        `┃ 📢 *BROADCAST*\n` +
        `╰━━━━━━━━━━━━━━━╯\n\n${text}\n\n_Sent by the bot owner._`

      let ok = 0
      let failed = 0
      for (const g of groups) {
        try {
          await sock.sendMessage(g.id, { text: body })
          ok++
        } catch {
          failed++
        }
        await sleep(1500) // WhatsApp rate-limits bursts, and bans for them
      }

      await m.reply(`✅ Delivered to *${ok}* group${ok === 1 ? '' : 's'}${failed ? `, failed on *${failed}*` : ''}.`)
    }
  },
  {
    name: 'grouplist',
    alias: ['listgc', 'mygroups', 'gclist'],
    category: 'BOT',
    desc: 'Every group the bot is in',
    usage: '.grouplist',
    owner: true,
    cooldown: 20,
    async run({ sock, m }) {
      const groups = Object.values(await sock.groupFetchAllParticipating())
      if (!groups.length) return m.reply('📭 I am not in any groups.')

      const rows = groups
        .sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0))
        .map((g, i) => {
          const admin = g.participants?.find((p) => p.id === sock.user?.id?.split(':')[0] + '@s.whatsapp.net')
          return (
            `*${i + 1}.* ${g.subject}\n` +
            `   👥 ${g.participants?.length || 0} members${admin?.admin ? ' · 🛡️ I am admin' : ''}`
          )
        })

      const total = groups.reduce((n, g) => n + (g.participants?.length || 0), 0)
      await m.reply(
        `╭━━━〔 *GROUPS* 〕━━━╮\n┃ 📊 ${groups.length} groups · ${total.toLocaleString()} members\n╰━━━━━━━━━━━━━━╯\n\n` +
          rows.join('\n\n').slice(0, 3500)
      )
    }
  },
  {
    name: 'ison',
    alias: ['onwa', 'checknum', 'isreg'],
    category: 'TOOLS',
    desc: 'Check whether a number is on WhatsApp',
    usage: '.ison 2348012345678',
    cooldown: 5,
    async run({ sock, m, args, prefix }) {
      const raw = (args[0] || '').replace(/[^0-9]/g, '')
      if (!raw || raw.length < 7) return m.reply(`📝 Usage: ${prefix}ison 2348012345678`)
      try {
        const [res] = await sock.onWhatsApp(toJid(raw))
        await m.reply(
          res?.exists
            ? `✅ *${raw}* is on WhatsApp.\n\n┃ 🆔 ${res.jid.split('@')[0]}`
            : `❌ *${raw}* is not registered on WhatsApp.`
        )
      } catch (e) {
        await m.reply(`❌ Could not check: ${e.message}`)
      }
    }
  },
  {
    name: 'alive',
    alias: ['online?', 'heartbeat'],
    category: 'BOT',
    desc: 'Quick health card',
    usage: '.alive',
    cooldown: 5,
    async run({ m }) {
      const up = Math.floor((Date.now() - config.startTime) / 1000)
      const mem = process.memoryUsage().heapUsed / 1048576
      await m.reply(
        `╭━━━〔 *${config.botName}* 〕━━━╮\n` +
          `┃ ✅ Alive and listening\n` +
          `┃ ⏱️ Uptime: ${fmtDuration(up)}\n` +
          `┃ 🔌 Plugins: ${pluginCount()}\n` +
          `┃ 🗄️ Storage: ${backend()}\n` +
          `┃ 🧠 Memory: ${mem.toFixed(0)} MB\n` +
          `┃ 🌐 Mode: ${getVar('MODE')}\n` +
          `┃ 📦 ${config.version}\n` +
          `╰━━━━━━━━━━━━━━━━╯`
      )
    }
  },
  {
    name: 'fetch',
    alias: ['get', 'curl'],
    category: 'TOOLS',
    desc: 'Fetch a URL and show what it returns',
    usage: '.fetch https://api.github.com/repos/nodejs/node',
    owner: true,
    cooldown: 10,
    async run({ m, args, prefix }) {
      const url = (args[0] || '').trim()
      if (!/^https?:\/\//i.test(url)) return m.reply(`📝 Usage: ${prefix}fetch https://example.com/api`)
      try {
        const data = await getJson(url)
        const out = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        await m.reply(`🌐 *${url}*\n\n\`\`\`${out.slice(0, 3000)}\`\`\``)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'backup',
    alias: ['exportdb', 'dbdump'],
    category: 'BOT',
    desc: 'Export the bot database as a JSON file',
    usage: '.backup',
    owner: true,
    cooldown: 60,
    async run({ m }) {
      await m.react('⏳')
      const dump = {}
      const names = ['vars', 'users', 'groups', 'warns', 'notes', 'banned', 'sudo', 'afk',
        'mods', 'filters', 'customcmd', 'roles', 'referrals', 'tasks']

      for (const name of names) {
        try {
          dump[name] = await DB[name].all()
        } catch {
          dump[name] = []
        }
      }
      // never export the WhatsApp session - that IS the account
      const json = JSON.stringify({ botId: config.botId, at: new Date().toISOString(), data: dump }, null, 2)
      const rows = Object.entries(dump).map(([k, v]) => `┃ ${k}: ${v.length}`).join('\n')

      await m.reply({
        document: Buffer.from(json),
        mimetype: 'application/json',
        fileName: `venom-backup-${new Date().toISOString().slice(0, 10)}.json`,
        caption:
          `╭━━━〔 *BACKUP* 〕━━━╮\n${rows}\n╰━━━━━━━━━━━━━━╯\n\n` +
          `_Session keys are deliberately excluded — a backup should never be able to log in as you._`
      })
      await m.react('✅')
    }
  }
]
