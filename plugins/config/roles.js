import {
  ROLES,
  ROLE_NAMES,
  LOCKED,
  EDITOR_COMMANDS,
  MOD_COMMANDS,
  getRole,
  setRole,
  delRole,
  listRoles
} from '../../src/lib/roles.js'
import { toJid } from '../../src/lib/utils.js'

/**
 * Staff roles — hand out real responsibility without handing over the bot.
 * See src/lib/roles.js for the ladder and what each rung unlocks.
 */

const targetOf = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /\d{7,}/.test(args[0])) return toJid(args[0])
  return null
}

const numberOf = (jid) => String(jid).split('@')[0].split(':')[0]

const ladder = () =>
  Object.entries(ROLES)
    .sort((a, b) => b[1].level - a[1].level)
    .map(([name, r]) => `${r.emoji} *${r.label}* \`${name}\``)
    .join('\n')

export default [
  {
    name: 'setrole',
    alias: ['addrole', 'promoteuser', 'makeeditor'],
    category: 'CONFIG',
    desc: 'Give someone a staff role',
    usage: '.setrole @user editor',
    owner: true,
    async run({ m, args, prefix }) {
      const role = (args.find((a) => ROLE_NAMES.includes(a.toLowerCase())) || '').toLowerCase()
      const target = targetOf(m, args.filter((a) => !ROLE_NAMES.includes(a.toLowerCase())))

      if (!target || !role) {
        return m.reply(
          `👥 *Usage:* ${prefix}setrole @user <role>\n\n` +
            `*Roles*\n${ladder()}\n\n` +
            `Example: *${prefix}setrole @user editor*\n` +
            `See what each one can do: *${prefix}rolehelp*`
        )
      }

      const number = numberOf(target)
      await setRole(number, role, m.senderNumber)
      const r = ROLES[role]
      await m.reply({
        text:
          `${r.emoji} @${number} is now *${r.label}*.\n\n` +
          `_Remove it with ${prefix}delrole @user._`,
        mentions: [target]
      })
    }
  },
  {
    name: 'delrole',
    alias: ['removerole', 'demoteuser'],
    category: 'CONFIG',
    desc: 'Take a staff role away',
    usage: '.delrole @user',
    owner: true,
    async run({ m, args, prefix }) {
      const target = targetOf(m, args)
      if (!target) return m.reply(`📝 Tag or reply to the person. Usage: ${prefix}delrole @user`)
      const number = numberOf(target)
      const had = await getRole(number)
      if (had === 'user') return m.reply(`ℹ️ ${number} has no role to remove.`)
      await delRole(number)
      await m.reply({ text: `♻️ @${number} is back to a normal user (was ${ROLES[had].label}).`, mentions: [target] })
    }
  },
  {
    name: 'roles',
    alias: ['staff', 'rolelist', 'team'],
    category: 'CONFIG',
    desc: 'Everyone with a staff role',
    usage: '.roles',
    async run({ m, prefix }) {
      const rows = await listRoles()
      if (!rows.length) {
        return m.reply(`👥 No staff yet.\n\nAdd someone with *${prefix}setrole @user editor*`)
      }
      const mentions = rows.map((r) => `${r.number}@s.whatsapp.net`)
      const body = rows.map((r) => `${r.emoji} *${r.label}* — @${r.number}`).join('\n')
      await m.reply({
        text: `╭━━━〔 *THE TEAM* 〕━━━╮\n${body}\n╰━━━━━━━━━━━━━━━╯\n\n_${rows.length} member${rows.length === 1 ? '' : 's'} · ${prefix}rolehelp explains each role_`,
        mentions
      })
    }
  },
  {
    name: 'myrole',
    alias: ['whoami', 'rank2'],
    category: 'USER',
    desc: 'What role you hold',
    usage: '.myrole',
    async run({ m, prefix }) {
      const r = ROLES[m.role] || ROLES.user
      const perks =
        m.role === 'owner'
          ? 'Everything. It is your bot.'
          : m.role === 'admin'
            ? 'Every command except credentials, code and the account itself.'
            : m.role === 'editor'
              ? 'Custom commands, autoreplies, welcome/goodbye text — plus moderation.'
              : m.role === 'mod'
                ? 'Ban, warn, kick, mute and group locks, without being a WhatsApp admin.'
                : m.role === 'vip'
                  ? 'Half cooldowns, and I answer you even in private mode.'
                  : `Nothing special yet — invite people with *${prefix}affiliate* to earn VIP.`
      await m.reply(
        `╭━━━〔 *YOUR ROLE* 〕━━━╮\n` +
          `┃ ${r.emoji} *${r.label}*\n` +
          `┃ 📊 Level: ${r.level}/100\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n${perks}`
      )
    }
  },
  {
    name: 'rolehelp',
    alias: ['roleinfo', 'perms'],
    category: 'CONFIG',
    desc: 'What each staff role can do',
    usage: '.rolehelp',
    async run({ m, prefix }) {
      await m.reply(
        `╭━━━〔 *ROLES* 〕━━━╮\n` +
          `┃ 👑 *Owner* — you. Cannot be granted.\n` +
          `┃ 🛡️ *Admin* — everything except the locked list.\n` +
          `┃ ✏️ *Editor* — bot content + moderation.\n` +
          `┃ 🔨 *Moderator* — moderation only.\n` +
          `┃ 💎 *VIP* — perks, no powers.\n` +
          `┃ 👤 *User* — the default.\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n` +
          `✏️ *Editor unlocks*\n${[...EDITOR_COMMANDS].join(', ')}\n\n` +
          `🔨 *Moderator unlocks*\n${[...MOD_COMMANDS].join(', ')}\n` +
          `_Moderators also pass group-admin checks without being admins._\n\n` +
          `💎 *VIP perks*\nHalf cooldowns · answered in private mode · earned automatically at the *${prefix}affiliate* milestone\n\n` +
          `🔒 *Owner only, never delegated*\n${[...LOCKED].join(', ')}\n\n` +
          `Grant: *${prefix}setrole @user editor* · Revoke: *${prefix}delrole @user*`
      )
    }
  }
]
