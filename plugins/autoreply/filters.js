import DB from '../../src/lib/database.js'

/**
 * Auto-reply filters.
 *
 * pfilter / pstop -> personal (DM) filters, owned by you
 * gfilter / gstop -> group filters, scoped to one group
 *
 * Matching is case-insensitive substring on the incoming message.
 */

const cache = { at: 0, rows: [] }
const TTL = 30_000

async function allFilters() {
  if (Date.now() - cache.at < TTL) return cache.rows
  cache.rows = await DB.filters.all()
  cache.at = Date.now()
  return cache.rows
}
const bust = () => { cache.at = 0 }

export default [
  {
    name: 'pfilter',
    alias: ['addfilter'],
    category: 'AUTOREPLY',
    desc: 'Auto-reply to a keyword in your DMs',
    usage: '.pfilter keyword | response',
    owner: true,
    async run({ m, text }) {
      if (!text.includes('|')) {
        const rows = (await allFilters()).filter((r) => r.scope === 'personal')
        return m.reply(
          `💬 *PERSONAL FILTERS* (${rows.length})\n\n` +
            (rows.map((r) => `• *${r.keyword}* → ${String(r.response).slice(0, 40)}`).join('\n') || '_none yet_') +
            `\n\nAdd: *.pfilter hello | Hi there!*\nRemove: *.pstop hello*`
        )
      }
      const [keyword, ...rest] = text.split('|')
      const response = rest.join('|').trim()
      const key = keyword.trim().toLowerCase()
      if (!key || !response) return m.reply('📝 Usage: .pfilter keyword | response')

      await DB.filters.set({ scope: 'personal', keyword: key }, { response, at: Date.now() })
      bust()
      await m.reply(`✅ Personal filter saved.\n\n🔑 *${key}*\n💬 ${response}`)
    }
  },
  {
    name: 'pstop',
    alias: ['delfilter'],
    category: 'AUTOREPLY',
    desc: 'Remove a personal auto-reply filter',
    usage: '.pstop keyword',
    owner: true,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .pstop hello')
      const key = text.trim().toLowerCase()
      const row = await DB.filters.findOne({ scope: 'personal', keyword: key })
      if (!row) return m.reply(`❌ No personal filter for "${key}".`)
      await DB.filters.delete({ scope: 'personal', keyword: key })
      bust()
      await m.reply(`🗑️ Personal filter *${key}* removed.`)
    }
  },
  {
    name: 'gfilter',
    alias: ['groupfilter'],
    category: 'AUTOREPLY',
    desc: 'Auto-reply to a keyword in this group',
    usage: '.gfilter keyword | response',
    group: true,
    admin: true,
    async run({ m, text }) {
      if (!text.includes('|')) {
        const rows = (await allFilters()).filter((r) => r.scope === m.chat)
        return m.reply(
          `💬 *GROUP FILTERS* (${rows.length})\n\n` +
            (rows.map((r) => `• *${r.keyword}* → ${String(r.response).slice(0, 40)}`).join('\n') || '_none yet_') +
            `\n\nAdd: *.gfilter rules | Read the description*\nRemove: *.gstop rules*`
        )
      }
      const [keyword, ...rest] = text.split('|')
      const response = rest.join('|').trim()
      const key = keyword.trim().toLowerCase()
      if (!key || !response) return m.reply('📝 Usage: .gfilter keyword | response')

      await DB.filters.set({ scope: m.chat, keyword: key }, { response, at: Date.now() })
      bust()
      await m.reply(`✅ Group filter saved.\n\n🔑 *${key}*\n💬 ${response}`)
    }
  },
  {
    name: 'gstop',
    alias: ['delgfilter'],
    category: 'AUTOREPLY',
    desc: 'Remove a group auto-reply filter',
    usage: '.gstop keyword',
    group: true,
    admin: true,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .gstop rules')
      const key = text.trim().toLowerCase()
      const row = await DB.filters.findOne({ scope: m.chat, keyword: key })
      if (!row) return m.reply(`❌ No group filter for "${key}".`)
      await DB.filters.delete({ scope: m.chat, keyword: key })
      bust()
      await m.reply(`🗑️ Group filter *${key}* removed.`)
    }
  },
  {
    name: 'listfilters',
    alias: ['filters', 'allfilters'],
    category: 'AUTOREPLY',
    desc: 'Show every filter that applies here',
    usage: '.listfilters',
    async run({ m }) {
      const rows = await allFilters()
      const mine = rows.filter((r) => r.scope === 'personal' || r.scope === m.chat)
      if (!mine.length) return m.reply('📭 No filters set for this chat.')
      await m.reply(
        `💬 *ACTIVE FILTERS* (${mine.length})\n\n` +
          mine
            .map((r) => `${r.scope === 'personal' ? '👤' : '👥'} *${r.keyword}*\n   → ${String(r.response).slice(0, 60)}`)
            .join('\n\n')
      )
    },

    /** the actual auto-responder */
    async before({ m }) {
      if (m.fromMe || !m.body) return false
      // never fire on commands
      if (/^[.\/!#$,]/.test(m.body.trim())) return false

      const rows = await allFilters()
      if (!rows.length) return false

      const body = m.body.toLowerCase()
      const scoped = rows.filter((r) => (m.isGroup ? r.scope === m.chat : r.scope === 'personal'))
      const hit = scoped.find((r) => body.includes(r.keyword))
      if (!hit) return false

      await m.reply(String(hit.response))
      return true
    }
  }
]
