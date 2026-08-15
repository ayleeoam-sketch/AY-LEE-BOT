import { getVar, setVar } from '../../src/lib/vars.js'

/**
 * Simple on/off switches from the original menu.
 * Each one is a thin wrapper over the vars store so the setting survives
 * restarts and can also be changed with .setvar.
 */
const toggle = ({ name, alias, key, label, emoji, desc, extra }) => ({
  name,
  alias,
  category: 'CONFIG',
  desc,
  usage: `.${name} on | off`,
  owner: true,
  async run({ m, args }) {
    const sub = (args[0] || '').toLowerCase()
    if (sub !== 'on' && sub !== 'off') {
      return m.reply(
        `${emoji} *${label}:* currently *${getVar(key) ? 'on' : 'off'}*\n\n` +
          `Use *.${name} on* or *.${name} off*` +
          (extra ? `\n\n${extra}` : '')
      )
    }
    await setVar(key, sub === 'on' ? 'true' : 'false')
    await m.reply(`✅ ${label} turned *${sub}*.`)
  }
})

export default [
  toggle({
    name: 'readstatus', alias: ['autoreadstatus', 'autostatus'], key: 'AUTO_READ_STATUS',
    label: 'Auto view status', emoji: '👁️',
    desc: 'Automatically view everyone\'s status updates'
  }),
  toggle({
    name: 'likestatus', alias: ['autolikestatus'], key: 'LIKE_STATUS',
    label: 'Auto like status', emoji: '💚',
    desc: 'Automatically react to status updates',
    extra: 'Change the emoji with *.statusemoji 🔥*'
  }),
  toggle({
    name: 'savestatus', alias: ['autosavestatus'], key: 'SAVE_STATUS',
    label: 'Auto save status', emoji: '💾',
    desc: 'Forward every status you view to your own chat'
  }),
  toggle({
    name: 'startupmsg', alias: ['startupmessage'], key: 'STARTUP_MESSAGE',
    label: 'Startup message', emoji: '🚀',
    desc: 'Send the owner a message when the bot connects'
  }),
  toggle({
    name: 'alwaysonline', alias: ['online-always'], key: 'ALWAYS_ONLINE',
    label: 'Always online', emoji: '🟢',
    desc: 'Keep the bot showing as online permanently'
  }),
  toggle({
    name: 'rejectcall', alias: ['anticall'], key: 'REJECT_CALL',
    label: 'Reject calls', emoji: '📵',
    desc: 'Automatically reject incoming calls'
  }),
  toggle({
    name: 'readmsg', alias: ['autoread'], key: 'AUTO_READ',
    label: 'Auto read messages', emoji: '📖',
    desc: 'Mark every incoming message as read'
  }),
  toggle({
    name: 'cmdreact', alias: ['commandreact'], key: 'CMD_REACT',
    label: 'Command reactions', emoji: '⚡',
    desc: 'React with an emoji whenever a command runs',
    extra: 'Change the emoji with *.setvar CMD_REACT_EMOJI 🔥*'
  }),
  toggle({
    name: 'autotyping', alias: ['typing'], key: 'AUTO_TYPING',
    label: 'Auto typing', emoji: '⌨️',
    desc: 'Show "typing..." before replying'
  }),
  toggle({
    name: 'antiedit', alias: ['antiedits'], key: 'ANTI_EDIT',
    label: 'Anti edit', emoji: '✏️',
    desc: 'Reveal the original text when someone edits a message'
  }),

  {
    name: 'statusemoji',
    category: 'CONFIG',
    desc: 'Set the emoji used by auto status like',
    usage: '.statusemoji 🔥',
    owner: true,
    async run({ m, args }) {
      const emoji = args[0]
      if (!emoji) return m.reply(`💚 Current status emoji: *${getVar('STATUS_EMOJI')}*\n\nUsage: *.statusemoji 🔥*`)
      if (emoji.length > 8) return m.reply('❌ That does not look like an emoji.')
      await setVar('STATUS_EMOJI', emoji)
      await m.reply(`✅ Status reaction emoji set to ${emoji}`)
    }
  },
  {
    name: 'antieditchat',
    category: 'CONFIG',
    desc: 'Where anti-edit alerts are sent',
    usage: '.antieditchat same | owner',
    owner: true,
    async run({ m, args }) {
      const sub = (args[0] || '').toLowerCase()
      if (!['same', 'owner'].includes(sub)) {
        return m.reply(
          `✏️ *Anti-edit destination:* *${getVar('ANTI_EDIT_CHAT')}*\n\n` +
            `*.antieditchat same* — alert in the chat where it happened\n` +
            `*.antieditchat owner* — send alerts to the owner privately`
        )
      }
      await setVar('ANTI_EDIT_CHAT', sub)
      await m.reply(`✅ Anti-edit alerts will go to: *${sub}*`)
    }
  }
]
