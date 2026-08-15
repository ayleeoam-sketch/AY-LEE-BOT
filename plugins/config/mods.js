import DB from '../../src/lib/database.js'
import { toJid } from '../../src/lib/utils.js'
import { invalidateCaches } from '../../src/handler.js'

/**
 * Moderators: a tier below sudo. They can use admin-level group commands
 * through the bot even when they are not WhatsApp group admins.
 */
const targetOf = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /\d{7,}/.test(args[0])) return toJid(args[0])
  return null
}

export default [
  {
    name: 'setmod',
    alias: ['addmod'],
    category: 'CONFIG',
    desc: 'Give someone moderator access',
    usage: '.setmod @user',
    owner: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag or reply to the person to make a moderator.')
      const number = target.split('@')[0].split(':')[0]
      await DB.mods.set({ number }, { at: Date.now() })
      invalidateCaches()
      await m.reply({ text: `🛡️ @${number} is now a moderator.`, mentions: [target] })
    }
  },
  {
    name: 'delmod',
    alias: ['rmmod'],
    category: 'CONFIG',
    desc: 'Remove moderator access',
    usage: '.delmod @user',
    owner: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag or reply to the person.')
      const number = target.split('@')[0].split(':')[0]
      await DB.mods.delete({ number })
      invalidateCaches()
      await m.reply(`✅ Moderator access revoked for ${number}.`)
    }
  },
  {
    name: 'getmods',
    alias: ['modlist', 'mods'],
    category: 'CONFIG',
    desc: 'List all moderators',
    usage: '.getmods',
    owner: true,
    async run({ m }) {
      const rows = await DB.mods.all()
      if (!rows.length) return m.reply('🛡️ No moderators set.\n\nAdd one with *.setmod @user*')
      await m.reply(
        `🛡️ *MODERATORS* (${rows.length})\n\n${rows.map((r) => `• ${r.number}`).join('\n')}`
      )
    }
  }
]
