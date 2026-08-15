import { toJid } from '../../src/lib/utils.js'
import DB from '../../src/lib/database.js'
import { invalidateCaches } from '../../src/handler.js'

const targetOf = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /\d{7,}/.test(args[0])) return toJid(args[0])
  return null
}

export default [
  {
    name: 'ban',
    category: 'BOT',
    desc: 'Block a user or group from using the bot',
    usage: '.ban @user',
    owner: true,
    async run({ m, args }) {
      const target = args[0] === 'group' ? m.chat : targetOf(m, args)
      if (!target) return m.reply('📝 Tag someone, or use .ban group to ban this whole chat.')
      await DB.banned.set({ id: target }, { at: Date.now() })
      invalidateCaches()
      await m.reply(`🚫 Banned \`${target.split('@')[0]}\` from using the bot.`)
    }
  },
  {
    name: 'unban',
    category: 'BOT',
    desc: 'Unblock a user or group',
    usage: '.unban @user',
    owner: true,
    async run({ m, args }) {
      const target = args[0] === 'group' ? m.chat : targetOf(m, args)
      if (!target) return m.reply('📝 Tag someone, or use .unban group.')
      await DB.banned.delete({ id: target })
      invalidateCaches()
      await m.reply(`✅ Unbanned \`${target.split('@')[0]}\`.`)
    }
  },
  {
    name: 'banlist',
    category: 'BOT',
    desc: 'Show everyone banned from the bot',
    usage: '.banlist',
    owner: true,
    async run({ m }) {
      const rows = await DB.banned.all()
      if (!rows.length) return m.reply('✅ Nobody is banned.')
      await m.reply(`🚫 *Banned (${rows.length}):*\n${rows.map((r) => `• ${r.id.split('@')[0]}`).join('\n')}`)
    }
  },
  {
    name: 'setsudo',
    alias: ['addsudo'],
    category: 'CONFIG',
    desc: 'Give someone owner-level access',
    usage: '.setsudo @user',
    owner: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag or reply to the person to make sudo.')
      const number = target.split('@')[0].split(':')[0]
      await DB.sudo.set({ number }, { at: Date.now() })
      invalidateCaches()
      await m.reply(`👑 @${number} now has sudo access.`, { mentions: [target] })
    }
  },
  {
    name: 'delsudo',
    alias: ['rmsudo'],
    category: 'CONFIG',
    desc: 'Revoke sudo access',
    usage: '.delsudo @user',
    owner: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag or reply to the person.')
      const number = target.split('@')[0].split(':')[0]
      await DB.sudo.delete({ number })
      invalidateCaches()
      await m.reply(`✅ Sudo access revoked for ${number}.`)
    }
  },
  {
    name: 'getsudo',
    alias: ['sudolist'],
    category: 'CONFIG',
    desc: 'List sudo users',
    usage: '.getsudo',
    owner: true,
    async run({ m, config }) {
      const rows = await DB.sudo.all()
      await m.reply(
        `👑 *Owners (.env):*\n${config.ownerNumbers.map((n) => `• ${n}`).join('\n') || '• none'}\n\n` +
          `🛡️ *Sudo users:*\n${rows.map((r) => `• ${r.number}`).join('\n') || '• none'}`
      )
    }
  },
  {
    name: 'restart',
    category: 'PROCESS',
    desc: 'Restart the bot process',
    usage: '.restart',
    owner: true,
    async run({ m }) {
      await m.reply('♻️ Restarting... I will be back in a few seconds.')
      setTimeout(() => process.exit(0), 1500) // Pterodactyl/pm2 restarts it
    }
  },
  {
    name: 'shutdown',
    category: 'PROCESS',
    desc: 'Stop the bot completely',
    usage: '.shutdown',
    owner: true,
    async run({ m }) {
      await m.reply('🛑 Shutting down. Start me again from your panel.')
      setTimeout(() => process.exit(1), 1500)
    }
  },
  {
    name: 'jid',
    category: 'USER',
    desc: 'Show the JID of this chat or a tagged user',
    usage: '.jid',
    async run({ m, args }) {
      const target = targetOf(m, args)
      await m.reply(
        `🆔 *Chat:* \`${m.chat}\`\n` +
          `👤 *You:* \`${m.sender}\`` +
          (target ? `\n🎯 *Target:* \`${target}\`` : '')
      )
    }
  }
]
