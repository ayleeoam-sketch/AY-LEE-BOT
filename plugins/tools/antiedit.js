import { getContentType } from 'baileys'
import { getVar } from '../../src/lib/vars.js'
import config from '../../src/config.js'

/**
 * Anti-edit: when someone edits a message, show what it originally said.
 * Uses the onEdit hook fired from src/connection.js.
 */
export default {
  name: 'antieditinfo',
  category: 'CONFIG',
  desc: 'Show anti-edit status',
  usage: '.antieditinfo',
  owner: true,
  hidden: true,

  async run({ m }) {
    await m.reply(
      `✏️ *Anti-edit:* ${getVar('ANTI_EDIT') ? 'on' : 'off'}\n` +
        `📍 Alerts go to: ${getVar('ANTI_EDIT_CHAT')}\n\n` +
        `Toggle with *.antiedit on*`
    )
  },

  async onEdit({ sock, key, edited, messageStore }) {
    if (!getVar('ANTI_EDIT')) return

    const original = messageStore.get(key.id)
    if (!original?.message) return
    if (original.key.fromMe) return

    const oldType = getContentType(original.message)
    const oldText =
      original.message.conversation ||
      original.message.extendedTextMessage?.text ||
      original.message[oldType]?.caption ||
      ''

    const newText =
      edited.conversation ||
      edited.extendedTextMessage?.text ||
      edited[getContentType(edited)]?.caption ||
      ''

    if (!oldText || oldText === newText) return

    const chat = key.remoteJid
    const author = original.key.participant || chat
    const body =
      `✏️ *MESSAGE EDITED*\n\n` +
      `👤 @${author.split('@')[0]}\n\n` +
      `📝 *Before:*\n${oldText.slice(0, 900)}\n\n` +
      `📝 *After:*\n${newText.slice(0, 900)}`

    const dest =
      getVar('ANTI_EDIT_CHAT') === 'owner' && config.ownerNumbers[0]
        ? `${config.ownerNumbers[0]}@s.whatsapp.net`
        : chat

    await sock.sendMessage(dest, { text: body, mentions: [author] }).catch(() => {})
  }
}
