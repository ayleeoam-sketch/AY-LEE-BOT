import os from 'os'
import { uptime, formatBytes } from '../../src/lib/utils.js'
import { pluginCount } from '../../src/lib/pluginLoader.js'
import { isMongo } from '../../src/lib/database.js'

export default [
  {
    name: 'uptime',
    alias: ['runtime'],
    category: 'BOT',
    desc: 'How long the bot has been running',
    usage: '.uptime',
    cooldown: 3,
    async run({ m }) {
      await m.reply(`⏱️ *Uptime:* ${uptime()}`)
    }
  },
  {
    name: 'stats',
    alias: ['status', 'botinfo'],
    category: 'BOT',
    desc: 'Full bot and server statistics',
    usage: '.stats',
    cooldown: 5,
    async run({ m, config }) {
      const used = os.totalmem() - os.freemem()
      await m.reply(
        `╭━━━〔 *${config.botName} STATS* 〕━━━╮\n` +
          `┃ 🤖 Version: ${config.version}\n` +
          `┃ 🔌 Plugins: ${pluginCount()}\n` +
          `┃ ⏱️ Uptime: ${uptime()}\n` +
          `┃ 💾 RAM: ${formatBytes(used)} / ${formatBytes(os.totalmem())}\n` +
          `┃ 🧠 Heap: ${formatBytes(process.memoryUsage().heapUsed)}\n` +
          `┃ 🖥️ Platform: ${os.platform()} ${os.arch()}\n` +
          `┃ ⚙️ CPU: ${os.cpus()[0]?.model?.slice(0, 28) || 'unknown'}\n` +
          `┃ 🔢 Cores: ${os.cpus().length}\n` +
          `┃ 🟢 Node: ${process.version}\n` +
          `┃ 🗄️ Database: ${isMongo() ? 'MongoDB' : 'Local JSON'}\n` +
          `┃ 👑 Owner: ${config.ownerName}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━╯`
      )
    }
  },
  {
    name: 'owner',
    alias: ['creator'],
    category: 'BOT',
    desc: 'Contact card of the bot owner',
    usage: '.owner',
    cooldown: 5,
    async run({ sock, m, config }) {
      const number = config.ownerNumbers[0]
      if (!number) return m.reply('⚠️ No owner number configured in .env')
      await sock.sendMessage(
        m.chat,
        {
          contacts: {
            displayName: config.ownerName,
            contacts: [
              {
                vcard:
                  `BEGIN:VCARD\nVERSION:3.0\n` +
                  `FN:${config.ownerName}\n` +
                  `ORG:${config.botName}\n` +
                  `TEL;type=CELL;type=VOICE;waid=${number}:+${number}\n` +
                  `END:VCARD`
              }
            ]
          }
        },
        { quoted: m.raw }
      )
    }
  }
]
