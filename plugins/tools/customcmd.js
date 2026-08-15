import DB from '../../src/lib/database.js'

/**
 * User-defined commands: .setcmd shortcut | full response
 * Stored in the DB and resolved before the normal command table, so users
 * can build their own shortcuts without touching any files.
 */

const cache = { at: 0, rows: [] }
const TTL = 30_000
async function allCmds() {
  if (Date.now() - cache.at < TTL) return cache.rows
  cache.rows = await DB.customcmd.all()
  cache.at = Date.now()
  return cache.rows
}
const bust = () => { cache.at = 0 }

export default [
  {
    name: 'setcmd',
    alias: ['addcmd'],
    category: 'TOOLS',
    desc: 'Create your own command',
    usage: '.setcmd rules | Please read the group description',
    admin: true,
    async run({ m, text, prefix }) {
      if (!text.includes('|')) return m.reply(`📝 Usage: *${prefix}setcmd rules | Read the description*`)
      const [name, ...rest] = text.split('|')
      const key = name.trim().toLowerCase().replace(/^[.\/!#$,]/, '')
      const response = rest.join('|').trim()
      if (!key || !response) return m.reply('📝 Both a name and a response are required.')
      if (/\s/.test(key)) return m.reply('❌ Command names cannot contain spaces.')

      await DB.customcmd.set({ scope: m.isGroup ? m.chat : 'global', name: key }, { response, by: m.sender, at: Date.now() })
      bust()
      await m.reply(`✅ Command *${prefix}${key}* created.\n\n💬 ${response}`)
    }
  },
  {
    name: 'delcmd',
    alias: ['removecmd'],
    category: 'TOOLS',
    desc: 'Delete a custom command',
    usage: '.delcmd rules',
    admin: true,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .delcmd rules')
      const key = text.trim().toLowerCase().replace(/^[.\/!#$,]/, '')
      const scope = m.isGroup ? m.chat : 'global'
      const row = await DB.customcmd.findOne({ scope, name: key })
      if (!row) return m.reply(`❌ No custom command called "${key}".`)
      await DB.customcmd.delete({ scope, name: key })
      bust()
      await m.reply(`🗑️ Custom command *${key}* deleted.`)
    }
  },
  {
    name: 'listcmd',
    alias: ['listcmds', 'customcmds'],
    category: 'TOOLS',
    desc: 'List custom commands for this chat',
    usage: '.listcmd',
    async run({ m, prefix }) {
      const scope = m.isGroup ? m.chat : 'global'
      const rows = (await allCmds()).filter((r) => r.scope === scope)
      if (!rows.length) return m.reply(`📭 No custom commands here.\n\nCreate one: *${prefix}setcmd name | response*`)
      await m.reply(
        `⚙️ *CUSTOM COMMANDS* (${rows.length})\n\n` +
          rows.map((r) => `• *${prefix}${r.name}*\n   ${String(r.response).slice(0, 60)}`).join('\n')
      )
    }
  },
  {
    name: 'delcmds',
    alias: ['clearcmds'],
    category: 'TOOLS',
    desc: 'Delete every custom command here',
    usage: '.delcmds',
    admin: true,
    async run({ m }) {
      const scope = m.isGroup ? m.chat : 'global'
      await DB.customcmd.delete({ scope })
      bust()
      await m.reply('🗑️ All custom commands for this chat were deleted.')
    },

    /** resolve custom commands before the built-in table */
    async before({ m }) {
      if (m.fromMe || !m.body) return false
      const match = m.body.trim().match(/^[.\/!#$,](\S+)/)
      if (!match) return false

      const key = match[1].toLowerCase()
      const rows = await allCmds()
      const scope = m.isGroup ? m.chat : 'global'
      const hit = rows.find((r) => r.name === key && (r.scope === scope || r.scope === 'global'))
      if (!hit) return false

      await m.reply(String(hit.response))
      return true
    }
  }
]
