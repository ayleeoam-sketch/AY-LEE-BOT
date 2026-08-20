import { toJid } from '../../src/lib/utils.js'

/** Resolve who a moderation command is aimed at: mention, reply, or number. */
const resolveTarget = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /\d{7,}/.test(args[0])) return toJid(args[0])
  return null
}

export default [
  {
    name: 'kick',
    alias: ['remove'],
    category: 'GROUP',
    desc: 'Remove a member from the group',
    usage: '.kick @user',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m, args }) {
      const target = resolveTarget(m, args)
      if (!target) {
        return m.reply('📝 Tag, reply to, or give the number of the person to kick.')
      }

      if (target === m.botJid) {
        return m.reply('🙃 I am not kicking myself.')
      }

      try {
        await sock.groupParticipantsUpdate(
          m.chat,
          [target],
          'remove'
        )

        await m.reply(
          `✅ Removed @${target.split('@')[0]}`,
          { mentions: [target] }
        )
      } catch (e) {
        await m.reply(
          `❌ Could not remove that user: ${e.message}`
        )
      }
    }
  },

  {
    name: 'add',
    category: 'GROUP',
    desc: 'Add a member to the group',
    usage: '.add 2348012345678',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m, args }) {
      const target = resolveTarget(m, args)

      if (!target) {
        return m.reply('📝 Usage: .add 2348012345678')
      }

      try {
        const [res] = await sock.groupParticipantsUpdate(
          m.chat,
          [target],
          'add'
        )

        if (res?.status === '200') {
          return m.reply(
            `✅ Added @${target.split('@')[0]}`,
            { mentions: [target] }
          )
        }

        await m.reply(
          `⚠️ Could not add them (status ${res?.status}). They may have privacy settings blocking it.`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },

  {
    name: 'promote',
    category: 'GROUP',
    desc: 'Make a member group admin',
    usage: '.promote @user',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m, args }) {
      const target = resolveTarget(m, args)

      if (!target) {
        return m.reply('📝 Tag or reply to the person to promote.')
      }

      await sock.groupParticipantsUpdate(
        m.chat,
        [target],
        'promote'
      )

      await m.reply(
        `👑 Promoted @${target.split('@')[0]} to admin`,
        { mentions: [target] }
      )
    }
  },

  {
    name: 'adminall',
    alias: ['alladmin', 'promoteall'],
    category: 'GROUP',
    desc: 'Promote all group members to admin',
    usage: '.adminall',
    group: true,
    owner: true,
    botAdmin: true,
    async run({ sock, m }) {
      const members = m.participants || []

      const targets = members
        .filter(
          (p) =>
            !p.admin &&
            p.id !== m.botJid
        )
        .map((p) => p.id)

      if (!targets.length) {
        return m.reply(
          '✅ Everyone is already an admin.'
        )
      }

      await m.reply(
        `⏳ Promoting ${targets.length} member(s) to admin...`
      )

      try {
        await sock.groupParticipantsUpdate(
          m.chat,
          targets,
          'promote'
        )

        await m.reply(
          `👑 Done!\n\nPromoted ${targets.length} member(s) to admin.`
        )
      } catch (e) {
        await m.reply(
          `❌ Could not promote all members: ${e.message}`
        )
      }
    }
  },

  {
    name: 'demote',
    category: 'GROUP',
    desc: 'Remove admin rights from a member',
    usage: '.demote @user',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m, args }) {
      const target = resolveTarget(m, args)

      if (!target) {
        return m.reply('📝 Tag or reply to the person to demote.')
      }

      await sock.groupParticipantsUpdate(
        m.chat,
        [target],
        'demote'
      )

      await m.reply(
        `⬇️ Demoted @${target.split('@')[0]}`,
        { mentions: [target] }
      )
    }
  },

  {
    name: 'mute',
    alias: ['close'],
    category: 'GROUP',
    desc: 'Only admins can send messages',
    usage: '.mute',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      await sock.groupSettingUpdate(
        m.chat,
        'announcement'
      )

      await m.reply(
        '🔇 Group muted - only admins can send messages now.'
      )
    }
  },

  {
    name: 'unmute',
    alias: ['open'],
    category: 'GROUP',
    desc: 'Let everyone send messages again',
    usage: '.unmute',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      await sock.groupSettingUpdate(
        m.chat,
        'not_announcement'
      )

      await m.reply(
        '🔊 Group unmuted - everyone can send messages.'
      )
    }
  },

  {
    name: 'tagall',
    alias: ['everyone', 'all'],
    category: 'GROUP',
    desc: 'Mention every member',
    usage: '.tagall [message]',
    group: true,
    admin: true,
    cooldown: 30,
    async run({ sock, m, text }) {
      const members = m.participants.map(
        (p) => p.id
      )

      if (!members.length) {
        return m.reply(
          '❌ Could not read the member list.'
        )
      }

      const body =
        `📢 *ATTENTION EVERYONE*\n` +
        (text ? `💬 ${text}\n` : '') +
        `👥 ${members.length} members\n\n` +
        members
          .map(
            (j) => `➤ @${j.split('@')[0]}`
          )
          .join('\n')

      await sock.sendMessage(
        m.chat,
        {
          text: body,
          mentions: members
        },
        {
          quoted: m.raw
        }
      )
    }
  },

  {
    name: 'ginfo',
    alias: ['groupinfo'],
    category: 'GROUP',
    desc: 'Show group information',
    usage: '.ginfo',
    group: true,
    async run({ m }) {
      const g = m.groupMetadata

      if (!g) {
        return m.reply(
          '❌ Could not fetch group metadata.'
        )
      }

      const admins = m.participants.filter(
        (p) => p.admin
      ).length

      await m.reply(
        `╭━━━〔 *GROUP INFO* 〕━━━╮\n` +
        `┃ 📛 Name: ${g.subject}\n` +
        `┃ 🆔 ID: ${g.id}\n` +
        `┃ 👥 Members: ${m.participants.length}\n` +
        `┃ 🛡️ Admins: ${admins}\n` +
        `┃ 🔒 Locked: ${g.announce ? 'yes (admins only)' : 'no'}\n` +
        `┃ ✏️ Edit info: ${g.restrict ? 'admins only' : 'everyone'}\n` +
        `┃ 📅 Created: ${
          g.creation
            ? new Date(
                g.creation * 1000
              ).toLocaleDateString()
            : 'unknown'
        }\n` +
        `╰━━━━━━━━━━━━━━━━━╯\n` +
        (
          g.desc
            ? `\n📄 *Description:*\n${g.desc}`
            : ' '
        )
      )
    }
  },

  {
    name: 'gname',
    alias: ['setgroupname', 'gsubject'],
    category: 'GROUP',
    desc: 'Change the group name',
    usage: '.gname New Name',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m, text }) {
      if (!text) {
        return m.reply(
          '📝 Usage: .gname New Group Name'
        )
      }

      await sock.groupUpdateSubject(
        m.chat,
        text
      )

      await m.reply(
        `✅ Group name changed to *${text}*`
      )
    }
  },

  {
    name: 'gdesc',
    category: 'GROUP',
    desc: 'Change the group description',
    usage: '.gdesc New description',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m, text }) {
      if (!text) {
        return m.reply(
          '📝 Usage: .gdesc Your new description'
        )
      }

      await sock.groupUpdateDescription(
        m.chat,
        text
      )

      await m.reply(
        '✅ Group description updated.'
      )
    }
  },

  {
    name: 'leave',
    alias: ['left'],
    category: 'GROUP',
    desc: 'Make the bot leave this group',
    usage: '.leave',
    group: true,
    owner: true,
    async run({ sock, m }) {
      await m.reply(
        '👋 Leaving this group. Goodbye!'
      )

      await sock.groupLeave(m.chat)
    }
  },

  {
    name: 'invite',
    alias: ['link'],
    category: 'GROUP',
    desc: 'Get the group invite link',
    usage: '.invite',
    group: true,
    admin: true,
    botAdmin: true,
    async run({ sock, m }) {
      const code =
        await sock.groupInviteCode(
          m.chat
        )

      await m.reply(
        `🔗 *${m.groupName}*\nhttps://chat.whatsapp.com/${code}`
      )
    }
  }
]
