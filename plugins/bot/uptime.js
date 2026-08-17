import os from 'os'
import { uptime, formatBytes } from '../../src/lib/utils.js'
import { pluginCount } from '../../src/lib/pluginLoader.js'
import { backend } from '../../src/lib/database.js'
import { CREATOR } from '../../src/branding.js'

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
          `┃ 🗄️ Database: ${backend()}\n` +
          `┃ 👑 Owner: ${config.ownerName}\n` +
          `╰━━━━━━━━━━━━━━━━━━━━╯`
      )
    }
  },
  {
    name: 'owner',
    alias: ['creator'],
    category: 'BOT',
    desc: 'Contact the original VENOM MD creator and get your own bot',
    usage: '.owner',
    cooldown: 5,
    async run({ sock, m, config }) {
      await m.reply(
        `👑 *ORIGINAL VENOM MD CREATOR*\n\n` +
          `👤 ${CREATOR.name}\n` +
          `📞 +${CREATOR.number}\n` +
          `🔗 https://wa.me/${CREATOR.number}\n\n` +
          `🤖 Want your own VENOM MD bot? Contact the creator using the card below.`
      )
      await sock.sendMessage(
        m.chat,
        {
          contacts: {
            displayName: CREATOR.name,
            contacts: [
              {
                vcard:
                  `BEGIN:VCARD\nVERSION:3.0\n` +
                  `FN:${CREATOR.name}\n` +
                  `ORG:${config.botName} - Original Creator\n` +
                  `TEL;type=CELL;type=VOICE;waid=${CREATOR.number}:+${CREATOR.number}\n` +
                  `URL:${CREATOR.github}\n` +
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
