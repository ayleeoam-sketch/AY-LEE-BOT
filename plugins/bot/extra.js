import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import fs from 'fs'
import path from 'path'
import DB from '../../src/lib/database.js'
import { ROOT } from '../../src/config.js'
import { uptime, formatBytes, toJid } from '../../src/lib/utils.js'
import { pluginCount } from '../../src/lib/pluginLoader.js'
import { isMongo } from '../../src/lib/database.js'

const execFileAsync = promisify(execFile)

export default [
  {
    name: 'repo',
    alias: ['script', 'sc', 'github-repo'],
    category: 'BOT',
    desc: 'Show the bot source repository',
    usage: '.repo',
    async run({ m, config }) {
      let pkg = {}
      try { pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) } catch {}
      const { CREATOR } = await import('../../src/branding.js')
      await m.reply(
        `╭━━━〔 *${config.botName}* 〕━━━╮\n` +
          `┃ 📦 Version: ${pkg.version || config.version}\n` +
          `┃ 👤 Creator: ${CREATOR.name}\n` +
          `┃ 🔌 Plugins: ${pluginCount()}\n` +
          `┃ ⚙️ Engine: Baileys v7\n` +
          `┃ 📜 License: ${pkg.license || 'MIT'}\n` +
          `╰━━━━━━━━━━━━━━━━━╯\n\n` +
          `⭐ ${CREATOR.repo}\n` +
          `👥 ${CREATOR.group}\n` +
          `Want your own? *.owner* then *.pair*`
      )
    }
  },
  {
    name: 'update',
    alias: ['gitpull'],
    category: 'BOT',
    desc: 'Pull the latest code from git',
    usage: '.update',
    owner: true,
    async run({ m }) {
      if (!fs.existsSync(path.join(ROOT, '.git'))) {
        return m.reply('❌ This is not a git checkout, so there is nothing to pull.\n\n_Clone the repo with git to enable updates._')
      }
      await m.reply('⏳ Pulling the latest changes...')
      try {
        const { stdout } = await execFileAsync('git', ['pull'], { cwd: ROOT, timeout: 60_000 })
        const clean = stdout.trim().slice(0, 1200)
        if (/Already up to date/i.test(clean)) return m.reply('✅ Already up to date.')
        await m.reply(`✅ Updated:\n\n\`\`\`${clean}\`\`\`\n\n♻️ Run *.restart* to load the new code.`)
      } catch (e) {
        await m.reply(`❌ Update failed:\n\`\`\`${String(e.message).slice(0, 500)}\`\`\``)
      }
    }
  },
  {
    name: 'p-status',
    alias: ['pstatus', 'process'],
    category: 'PROCESS',
    desc: 'Show process and system health',
    usage: '.p-status',
    owner: true,
    async run({ m }) {
      const mem = process.memoryUsage()
      const load = os.loadavg()
      await m.reply(
        `╭━━━〔 *PROCESS STATUS* 〕━━━╮\n` +
          `┃ 🆔 PID: ${process.pid}\n` +
          `┃ ⏱️ Bot uptime: ${uptime()}\n` +
          `┃ 🖥️ System uptime: ${Math.floor(os.uptime() / 3600)}h\n` +
          `┃ 🧠 Heap used: ${formatBytes(mem.heapUsed)}\n` +
          `┃ 📦 Heap total: ${formatBytes(mem.heapTotal)}\n` +
          `┃ 🗃️ RSS: ${formatBytes(mem.rss)}\n` +
          `┃ 💾 Free RAM: ${formatBytes(os.freemem())}\n` +
          `┃ 📊 Load: ${load.map((l) => l.toFixed(2)).join(' ')}\n` +
          `┃ 🟢 Node: ${process.version}\n` +
          `┃ 🗄️ DB: ${isMongo() ? 'MongoDB' : 'local JSON'}\n` +
          `╰━━━━━━━━━━━━━━━━━╯`
      )
    }
  },
  {
    name: 'ignore',
    category: 'BOT',
    desc: 'Make the bot ignore a user',
    usage: '.ignore @user',
    owner: true,
    async run({ m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Tag or reply to the person to ignore.')
      await DB.banned.set({ id: target }, { at: Date.now(), reason: 'ignored' })
      const { invalidateCaches } = await import('../../src/handler.js')
      invalidateCaches()
      await m.reply(`🙉 Now ignoring ${target.split('@')[0]}.`)
    }
  },
  {
    name: 'allow',
    alias: ['unignore'],
    category: 'BOT',
    desc: 'Stop ignoring a user',
    usage: '.allow @user',
    owner: true,
    async run({ m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Tag or reply to the person.')
      await DB.banned.delete({ id: target })
      const { invalidateCaches } = await import('../../src/handler.js')
      invalidateCaches()
      await m.reply(`✅ No longer ignoring ${target.split('@')[0]}.`)
    }
  },
  {
    name: 'mute-user',
    alias: ['muteuser'],
    category: 'BOT',
    desc: 'Delete everything a user posts in this group',
    usage: '.mute-user @user',
    group: true,
    admin: true,
    async run({ m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Tag or reply to the person to mute.')
      if (target === m.botJid) return m.reply('🙃 I will not mute myself.')
      const row = (await DB.groups.findOne({ id: m.chat })) || {}
      const muted = [...new Set([...(row.muted || []), target])]
      await DB.groups.set({ id: m.chat }, { muted })
      await m.reply({ text: `🔇 @${target.split('@')[0]} is muted. Their messages will be deleted.`, mentions: [target] })
    },

    async before({ sock, m }) {
      if (!m.isGroup || m.fromMe || m.isSudo) return false
      const row = await DB.groups.findOne({ id: m.chat })
      if (!row?.muted?.includes(m.sender)) return false
      if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
      return true
    }
  },
  {
    name: 'unmute-user',
    alias: ['unmuteuser'],
    category: 'BOT',
    desc: 'Stop deleting a muted user\'s messages',
    usage: '.unmute-user @user',
    group: true,
    admin: true,
    async run({ m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : null)
      if (!target) return m.reply('📝 Tag or reply to the person.')
      const row = (await DB.groups.findOne({ id: m.chat })) || {}
      const muted = (row.muted || []).filter((j) => j !== target)
      await DB.groups.set({ id: m.chat }, { muted })
      await m.reply({ text: `🔊 @${target.split('@')[0]} is unmuted.`, mentions: [target] })
    }
  },
  {
    name: 'bot',
    alias: ['botstatus'],
    category: 'BOT',
    desc: 'Quick health summary',
    usage: '.bot',
    async run({ m, config }) {
      await m.reply(
        `🤖 *${config.botName}* is online\n\n` +
          `⏱️ Uptime: ${uptime()}\n` +
          `🔌 Plugins: ${pluginCount()}\n` +
          `⚙️ Prefix: ${config.prefix}\n` +
          `🟢 Node: ${process.version}`
      )
    }
  }
]
