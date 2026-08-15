import DB from '../../src/lib/database.js'

/**
 * Welcome / goodbye messages.
 * Uses the onGroupUpdate hook fired by src/connection.js.
 *
 * Placeholders: @user @group @desc @count
 */

const cache = new Map()
const TTL = 60_000

async function settings(chat) {
  const hit = cache.get(chat)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const row = (await DB.groups.findOne({ id: chat })) || {}
  const value = {
    welcome: row.welcome ?? false,
    goodbye: row.goodbye ?? false,
    welcomeText: row.welcomeText || '',
    goodbyeText: row.goodbyeText || ''
  }
  cache.set(chat, { at: Date.now(), value })
  return value
}

const fill = (template, { user, metadata }) =>
  template
    .replace(/@user/gi, `@${user.split('@')[0]}`)
    .replace(/@group/gi, metadata?.subject || 'the group')
    .replace(/@desc/gi, metadata?.desc || 'no description')
    .replace(/@count/gi, String(metadata?.participants?.length || 0))

export default {
  name: 'welcome',
  alias: ['setwelcome'],
  category: 'GROUP',
  desc: 'Toggle or customise the welcome message',
  usage: '.welcome on | off | set <text>',
  group: true,
  admin: true,

  async run({ m, args, text }) {
    const sub = (args[0] || '').toLowerCase()
    const s = await settings(m.chat)

    if (sub === 'on' || sub === 'off') {
      await DB.groups.set({ id: m.chat }, { welcome: sub === 'on' })
      cache.delete(m.chat)
      return m.reply(`👋 Welcome messages turned *${sub}*.`)
    }

    if (sub === 'set') {
      const body = text.slice(3).trim()
      if (!body) return m.reply('📝 Usage: .welcome set Hello @user, welcome to @group!')
      await DB.groups.set({ id: m.chat }, { welcomeText: body, welcome: true })
      cache.delete(m.chat)
      return m.reply(`✅ Welcome message saved:\n\n${body}`)
    }

    await m.reply(
      `👋 *WELCOME SETTINGS*\n\n` +
        `Status: *${s.welcome ? 'on' : 'off'}*\n` +
        `Message: ${s.welcomeText || '_default_'}\n\n` +
        `.welcome on\n.welcome off\n.welcome set <text>\n\n` +
        `Placeholders: @user @group @desc @count`
    )
  },

  async onGroupUpdate({ sock, event, metadata }) {
    const s = await settings(event.id)
    const isJoin = event.action === 'add'
    const isLeave = event.action === 'remove'
    if (isJoin && !s.welcome) return
    if (isLeave && !s.goodbye) return
    if (!isJoin && !isLeave) return

    for (const participant of event.participants) {
      const user = typeof participant === 'string' ? participant : participant.id
      const template = isJoin
        ? s.welcomeText || `👋 Welcome @user to *@group*!\n\nYou are member #@count. Please read the description and enjoy your stay.`
        : s.goodbyeText || `👋 @user has left *@group*.\n\nWe are now @count members.`

      await sock
        .sendMessage(event.id, {
          text: fill(template, { user, metadata }),
          mentions: [user]
        })
        .catch(() => {})
    }
  }
}
