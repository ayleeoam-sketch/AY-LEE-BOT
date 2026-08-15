import { getContentType, downloadMediaMessage } from 'baileys'
import { getVar, setVar } from '../../src/lib/vars.js'
import config from '../../src/config.js'

/**
 * Anti-delete: when someone revokes a message, resend it.
 * Relies on the messageStore kept in src/connection.js and the onDelete hook.
 */
export default {
  name: 'antidelete',
  alias: ['antidel'],
  category: 'CONFIG',
  desc: 'Recover messages that people delete',
  usage: '.antidelete on | off',
  owner: true,

  async run({ m, args }) {
    const sub = (args[0] || '').toLowerCase()
    if (sub !== 'on' && sub !== 'off') {
      return m.reply(`🗑️ *Anti-delete:* currently *${getVar('ANTI_DELETE') ? 'on' : 'off'}*\n\nUse *.antidelete on* or *.antidelete off*`)
    }
    await setVar('ANTI_DELETE', sub === 'on' ? 'true' : 'false')
    await m.reply(`✅ Anti-delete turned *${sub}*.`)
  },

  async onDelete({ sock, key, messageStore }) {
    if (!getVar('ANTI_DELETE')) return

    const original = messageStore.get(key.id)
    if (!original?.message) return
    if (original.key.fromMe) return // don't echo the bot's own deletions

    const chat = key.remoteJid
    const deleter = key.participant || original.key.participant || chat
    const author = original.key.participant || chat
    const type = getContentType(original.message)

    const header =
      `🗑️ *DELETED MESSAGE RECOVERED*\n\n` +
      `👤 Sender: @${author.split('@')[0]}\n` +
      `🙈 Deleted by: @${deleter.split('@')[0]}\n` +
      `🕐 ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`

    const mentions = [author, deleter]

    try {
      const body =
        original.message.conversation ||
        original.message.extendedTextMessage?.text ||
        original.message[type]?.caption ||
        ''

      // media: re-download and resend
      if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(type)) {
        const buffer = await downloadMediaMessage(original, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
        const map = {
          imageMessage: { image: buffer },
          videoMessage: { video: buffer },
          audioMessage: { audio: buffer, mimetype: 'audio/mpeg' },
          stickerMessage: { sticker: buffer },
          documentMessage: {
            document: buffer,
            mimetype: original.message.documentMessage?.mimetype || 'application/octet-stream',
            fileName: original.message.documentMessage?.fileName || 'file'
          }
        }
        await sock.sendMessage(chat, { text: header + (body ? `\n\n💬 Caption: ${body}` : ''), mentions })
        await sock.sendMessage(chat, map[type])
        return
      }

      if (!body) return
      await sock.sendMessage(chat, { text: `${header}\n\n💬 Message:\n${body}`, mentions })
    } catch {
      /* media may have expired on WhatsApp's servers - nothing to recover */
    }
  }
}
