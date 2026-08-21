import { getContentType, downloadMediaMessage } from 'baileys'
import { getVar, setVar } from '../../src/lib/vars.js'
import config from '../../src/config.js'

/**
 * Anti-delete
 *
 * When a message is deleted:
 * 1. Find the original message in messageStore
 * 2. Recover its text/media
 * 3. Send a copy to the configured archive chat
 *
 * Archive destination:
 *   ANTI_DELETE_ARCHIVE variable
 *
 * If ANTI_DELETE_ARCHIVE is empty, the bot sends the
 * recovered message to the first owner number.
 */

const getArchiveJid = () => {
  const configured = String(getVar('ANTI_DELETE_ARCHIVE') || '').trim()

  if (configured) {
    if (configured.includes('@')) return configured

    const number = configured.replace(/\D/g, '')
    if (number) return `${number}@s.whatsapp.net`
  }

  const owner = config.ownerNumbers?.[0]

  if (!owner) return null

  return owner.includes('@')
    ? owner
    : `${String(owner).replace(/\D/g, '')}@s.whatsapp.net`
}

const mediaTypes = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage'
]

export default {
  name: 'antidelete',
  alias: ['antidel'],
  category: 'CONFIG',
  desc: 'Recover deleted messages to a private archive',
  usage: '.antidelete on | off',
  owner: true,

  async run({ m, args }) {
    const sub = (args[0] || '').toLowerCase()

    /*
     * .antidelete
     */
    if (!sub) {
      const archive = getArchiveJid()

      return m.reply(
        `🗑️ *ANTI-DELETE*\n\n` +
        `Status: *${getVar('ANTI_DELETE') ? 'ON' : 'OFF'}*\n` +
        `Archive: *${archive || 'Not configured'}*\n\n` +
        `Use:\n` +
        `• *.antidelete on*\n` +
        `• *.antidelete off*`
      )
    }

    /*
     * ON / OFF
     */
    if (sub === 'on' || sub === 'off') {
      await setVar(
        'ANTI_DELETE',
        sub === 'on' ? 'true' : 'false'
      )

      return m.reply(
        `✅ Anti-delete turned *${sub}*.\n\n` +
        `Deleted messages will ${
          sub === 'on'
            ? 'now be archived privately.'
            : 'no longer be recovered.'
        }`
      )
    }

    /*
     * Optional archive command:
     *
     * .antidelete archive 2348012345678
     */
    if (sub === 'archive') {
      const number = String(args[1] || '')
        .replace(/\D/g, '')

      if (!number) {
        return m.reply(
          `❌ Enter the archive WhatsApp number.\n\n` +
          `Example:\n` +
          `*.antidelete archive 2348012345678*`
        )
      }

      await setVar(
        'ANTI_DELETE_ARCHIVE',
        number
      )

      return m.reply(
        `✅ Anti-delete archive changed to:\n` +
        `📥 +${number}`
      )
    }

    return m.reply(
      `❌ Invalid option.\n\n` +
      `Use:\n` +
      `*.antidelete on*\n` +
      `*.antidelete off*\n` +
      `*.antidelete archive 234xxxxxxxxxx*`
    )
  },

  async onDelete({ sock, key, messageStore }) {
    /*
     * Anti-delete disabled
     */
    if (!getVar('ANTI_DELETE')) return

    /*
     * Find original message
     */
    const original = messageStore.get(key.id)

    if (!original?.message) return

    /*
     * Don't archive bot's own deleted messages
     */
    if (original.key.fromMe) return

    /*
     * Archive destination
     */
    const archive = getArchiveJid()

    if (!archive) {
      console.error(
        '[ANTI-DELETE] No archive destination configured.'
      )
      return
    }

    /*
     * Information about the original message
     */
    const chat = key.remoteJid

    const deleter =
      key.participant ||
      original.key.participant ||
      chat

    const author =
      original.key.participant ||
      chat

    const type =
      getContentType(original.message)

    const time =
      new Date().toLocaleTimeString(
        'en-GB',
        { hour12: false }
      )

    /*
     * Group/chat name
     */
    let chatName = chat

    try {
      if (chat.endsWith('@g.us')) {
        const metadata =
          await sock.groupMetadata(chat)

        chatName =
          metadata?.subject ||
          chat
      }
    } catch {
      /* ignore metadata errors */
    }

    const header =
      `🗑️ *DELETED MESSAGE ARCHIVE*\n\n` +
      `👤 *Sender:* @${author.split('@')[0]}\n` +
      `🙈 *Deleted by:* @${deleter.split('@')[0]}\n` +
      `💬 *Chat:* ${chatName}\n` +
      `🕐 *Time:* ${time}\n` +
      `📦 *Type:* ${type}`

    const mentions = [
      author,
      deleter
    ]

    try {
      /*
       * TEXT
       */
      const body =
        original.message.conversation ||
        original.message.extendedTextMessage?.text ||
        original.message[type]?.caption ||
        ''

      /*
       * MEDIA
       */
      if (mediaTypes.includes(type)) {
        let buffer

        try {
          buffer =
            await downloadMediaMessage(
              original,
              'buffer',
              {},
              {
                reuploadRequest:
                  sock.updateMediaMessage
              }
            )
        } catch (e) {
          /*
           * If WhatsApp's media has already expired,
           * archive the information instead.
           */
          await sock.sendMessage(
            archive,
            {
              text:
                `${header}\n\n` +
                `⚠️ *Media could not be downloaded.*\n` +
                `The WhatsApp media has probably expired.`,
              mentions
            }
          )

          return
        }

        /*
         * First send archive information
         */
        await sock.sendMessage(
          archive,
          {
            text:
              `${header}` +
              (body
                ? `\n\n💬 *Caption:*\n${body}`
                : ''),
            mentions
          }
        )

        /*
         * Then send the actual media
         */
        const mediaMap = {
          imageMessage: {
            image: buffer,
            caption: body || undefined
          },

          videoMessage: {
            video: buffer,
            caption: body || undefined
          },

          audioMessage: {
            audio: buffer,
            mimetype:
              original.message.audioMessage?.mimetype ||
              'audio/mpeg',
            ptt:
              original.message.audioMessage?.ptt || false
          },

          stickerMessage: {
            sticker: buffer
          },

          documentMessage: {
            document: buffer,
            mimetype:
              original.message.documentMessage?.mimetype ||
              'application/octet-stream',
            fileName:
              original.message.documentMessage?.fileName ||
              'deleted-file'
          }
        }

        await sock.sendMessage(
          archive,
          mediaMap[type]
        )

        return
      }

      /*
       * TEXT MESSAGE
       */
      if (body) {
        await sock.sendMessage(
          archive,
          {
            text:
              `${header}\n\n` +
              `💬 *Message:*\n${body}`,
            mentions
          }
        )
      }

    } catch (e) {
      console.error(
        `[ANTI-DELETE] Recovery failed: ${e.message}`
      )
    }
  }
}
