import { spawn } from 'child_process'
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
      /*
       * Restart safely whether or not a supervisor is present.
       *
       * process.exit() alone assumes something (pm2, Pterodactyl, Docker
       * restart policy, systemd) will bring the bot back. Run with a plain
       * `node index.js` and the bot simply dies - which is exactly what
       * happened in testing. Detect that case and re-spawn ourselves.
       */
      const managed =
        !!process.env.PM2_HOME ||
        !!process.env.pm_id ||
        !!process.env.P_SERVER_UUID || // Pterodactyl
        !!process.env.KUBERNETES_SERVICE_HOST ||
        process.env.RESTART_POLICY === 'supervisor'

      await m.reply(
        managed
          ? '♻️ Restarting... I will be back in a few seconds.'
          : '♻️ Restarting myself (no process manager detected)...'
      )

      setTimeout(() => {
        if (managed) {
          // the supervisor sees the exit and starts a fresh process
          process.exit(0)
        } else {
          // no supervisor: detach a replacement before we go
          try {
            spawn(process.argv[0], process.argv.slice(1), {
              cwd: process.cwd(),
              detached: true,
              stdio: 'ignore',
              env: process.env
            }).unref()
          } catch (e) {
            console.error('Self-restart failed:', e.message)
          }
          process.exit(0)
        }
      }, 1500)
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
