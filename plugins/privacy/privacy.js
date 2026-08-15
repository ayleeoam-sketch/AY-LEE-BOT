/**
 * WhatsApp privacy settings, driven through Baileys' privacy API.
 * These change the BOT account's own privacy - owner only.
 */

const VALUES = ['all', 'contacts', 'contact_blacklist', 'none']
const PP_VALUES = ['all', 'contacts', 'contact_blacklist', 'none']

const explain = (list) => list.map((v) => `• ${v}`).join('\n')

export default [
  {
    name: 'lastseen',
    alias: ['setlastseen'],
    category: 'PRIVACY',
    desc: 'Who can see the bot\'s last seen',
    usage: '.lastseen all | contacts | contact_blacklist | none',
    owner: true,
    async run({ sock, m, args }) {
      const v = (args[0] || '').toLowerCase()
      if (!VALUES.includes(v)) {
        const current = await sock.fetchPrivacySettings(true).catch(() => null)
        return m.reply(
          `👁️ *Last seen privacy*${current ? `\nCurrent: *${current.last}*` : ''}\n\n` +
            `Usage: .lastseen <value>\n\n${explain(VALUES)}`
        )
      }
      await sock.updateLastSeenPrivacy(v)
      await m.reply(`✅ Last seen set to *${v}*`)
    }
  },
  {
    name: 'online',
    alias: ['setonline'],
    category: 'PRIVACY',
    desc: 'Who can see when the bot is online',
    usage: '.online all | match_last_seen',
    owner: true,
    async run({ sock, m, args }) {
      const v = (args[0] || '').toLowerCase()
      if (!['all', 'match_last_seen'].includes(v)) {
        return m.reply('🟢 Usage: .online all | match_last_seen')
      }
      await sock.updateOnlinePrivacy(v)
      await m.reply(`✅ Online privacy set to *${v}*`)
    }
  },
  {
    name: 'mypp',
    alias: ['ppprivacy'],
    category: 'PRIVACY',
    desc: 'Who can see the bot\'s profile picture',
    usage: '.mypp all | contacts | contact_blacklist | none',
    owner: true,
    async run({ sock, m, args }) {
      const v = (args[0] || '').toLowerCase()
      if (!PP_VALUES.includes(v)) {
        return m.reply(`🖼️ Usage: .mypp <value>\n\n${explain(PP_VALUES)}`)
      }
      await sock.updateProfilePicturePrivacy(v)
      await m.reply(`✅ Profile picture privacy set to *${v}*`)
    }
  },
  {
    name: 'mystatus',
    alias: ['statusprivacy'],
    category: 'PRIVACY',
    desc: 'Who can see the bot\'s status updates',
    usage: '.mystatus all | contacts | contact_blacklist | none',
    owner: true,
    async run({ sock, m, args }) {
      const v = (args[0] || '').toLowerCase()
      if (!VALUES.includes(v)) {
        return m.reply(`📸 Usage: .mystatus <value>\n\n${explain(VALUES)}`)
      }
      await sock.updateStatusPrivacy(v)
      await m.reply(`✅ Status privacy set to *${v}*`)
    }
  },
  {
    name: 'read',
    alias: ['readreceipts'],
    category: 'PRIVACY',
    desc: 'Turn read receipts (blue ticks) on or off',
    usage: '.read all | none',
    owner: true,
    async run({ sock, m, args }) {
      const v = (args[0] || '').toLowerCase()
      if (!['all', 'none'].includes(v)) {
        return m.reply('✅ Usage: .read all | none\n\n*all* = blue ticks on\n*none* = blue ticks off')
      }
      await sock.updateReadReceiptsPrivacy(v)
      await m.reply(`✅ Read receipts set to *${v}*`)
    }
  },
  {
    name: 'allow-gcadd',
    alias: ['groupadd', 'gcadd'],
    category: 'PRIVACY',
    desc: 'Who can add the bot to groups',
    usage: '.allow-gcadd all | contacts | contact_blacklist',
    owner: true,
    async run({ sock, m, args }) {
      const v = (args[0] || '').toLowerCase()
      if (!['all', 'contacts', 'contact_blacklist'].includes(v)) {
        return m.reply('👥 Usage: .allow-gcadd all | contacts | contact_blacklist')
      }
      await sock.updateGroupsAddPrivacy(v)
      await m.reply(`✅ Group add privacy set to *${v}*`)
    }
  },
  {
    name: 'privacy',
    alias: ['privacysettings'],
    category: 'PRIVACY',
    desc: 'Show all current privacy settings',
    usage: '.privacy',
    owner: true,
    async run({ sock, m }) {
      try {
        const p = await sock.fetchPrivacySettings(true)
        await m.reply(
          `╭━━━〔 *PRIVACY SETTINGS* 〕━━━╮\n` +
            `┃ 👁️ Last seen: ${p.last || 'n/a'}\n` +
            `┃ 🟢 Online: ${p.online || 'n/a'}\n` +
            `┃ 🖼️ Profile pic: ${p.profile || 'n/a'}\n` +
            `┃ 📸 Status: ${p.status || 'n/a'}\n` +
            `┃ ✅ Read receipts: ${p.readreceipts || 'n/a'}\n` +
            `┃ 👥 Group add: ${p.groupadd || 'n/a'}\n` +
            `╰━━━━━━━━━━━━━━━━━╯`
        )
      } catch (e) {
        await m.reply(`❌ Could not fetch privacy settings: ${e.message}`)
      }
    }
  }
]
