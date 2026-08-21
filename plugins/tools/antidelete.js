import {
  getContentType,
  downloadMediaMessage
} from 'baileys'

import {
  getVar,
  setVar
} from '../../src/lib/vars.js'

import config from '../../src/config.js'

/* ============================================================
 * ANTI-DELETE
 *
 * Supports:
 *
 * .antidelete on
 * .antidelete off
 *
 * .antidelete archive 2348012345678
 *
 * .antidelete archive 120363429429530466@g.us
 *
 * Deleted messages are recovered from messageStore
 * and forwarded to the configured archive chat.
 * ============================================================ */

/* ============================================================
 * ARCHIVE DESTINATION
 * ============================================================ */

function getArchiveJid() {
  const configured = String(
    getVar('ANTI_DELETE_ARCHIVE') || ''
  ).trim()

  if (configured) {
    /*
     * Group JID
     */
    if (configured.endsWith('@g.us')) {
      return configured
    }

    /*
     * User JID
     */
    if (configured.endsWith('@s.whatsapp.net')) {
      return configured
    }

    /*
     * Plain WhatsApp number
     */
    const number = configured.replace(
      /\D/g,
      ''
    )

    if (number) {
      return `${number}@s.whatsapp.net`
    }
  }

  /*
   * Fallback to owner
   */
  const owner =
    config.ownerNumbers?.[0]

  if (!owner) {
    return null
  }

  if (String(owner).includes('@')) {
    return String(owner)
  }

  const number =
    String(owner).replace(
      /\D/g,
      ''
    )

  if (!number) {
    return null
  }

  return `${number}@s.whatsapp.net`
}

/* ============================================================
 * VALIDATE ARCHIVE
 * ============================================================ */

function normalizeArchive(value) {
  const input =
    String(value || '').trim()

  if (!input) {
    return null
  }

  /*
   * Group
   */
  if (
    /^120\d+@g\.us$/i.test(input)
  ) {
    return input
  }

  /*
   * User JID
   */
  if (
    /^\d+@s\.whatsapp\.net$/i.test(input)
  ) {
    return input
  }

  /*
   * Plain number
   */
  const number =
    input.replace(
      /\D/g,
      ''
    )

  if (
    number.length >= 8
  ) {
    return `${number}@s.whatsapp.net`
  }

  return null
}

/* ============================================================
 * MEDIA TYPES
 * ============================================================ */

const mediaTypes = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage'
]

/* ============================================================
 * PLUGIN
 * ============================================================ */

export default {
  name: 'antidelete',

  alias: [
    'antidel'
  ],

  category: 'CONFIG',

  desc:
    'Recover deleted messages and send them to an archive chat',

  usage:
    '.antidelete on | off | archive',

  owner: true,

  /* ==========================================================
   * COMMAND
   * ========================================================== */

  async run({
    m,
    args
  }) {
    const sub =
      String(
        args?.[0] || ''
      ).toLowerCase()

    /* ========================================================
     * STATUS
     * ======================================================== */

    if (!sub) {
      const archive =
        getArchiveJid()

      return m.reply(
        `🗑️ *ANTI-DELETE*\n\n` +

        `Status: *${
          getVar('ANTI_DELETE')
            ? 'ON'
            : 'OFF'
        }*\n\n` +

        `📥 Archive:\n` +
        `${archive || 'Not configured'}\n\n` +

        `Use:\n` +
        `• *.antidelete on*\n` +
        `• *.antidelete off*\n` +
        `• *.antidelete archive 234xxxxxxxxxx*\n` +
        `• *.antidelete archive 120xxxxxxxx@g.us*`
      )
    }

    /* ========================================================
     * ON
     * ======================================================== */

    if (
      sub === 'on'
    ) {
      await setVar(
        'ANTI_DELETE',
        'true'
      )

      const archive =
        getArchiveJid()

      return m.reply(
        `✅ *Anti-delete is now ON!*\n\n` +

        `📥 Archive:\n` +
        `${archive || 'Not configured'}\n\n` +

        `🗑️ Deleted messages will be recovered and sent there.`
      )
    }

    /* ========================================================
     * OFF
     * ======================================================== */

    if (
      sub === 'off'
    ) {
      await setVar(
        'ANTI_DELETE',
        'false'
      )

      return m.reply(
        `❌ *Anti-delete turned OFF.*`
      )
    }

    /* ========================================================
     * ARCHIVE
     * ======================================================== */

    if (
      sub === 'archive'
    ) {
      const input =
        String(
          args?.[1] || ''
        ).trim()

      const archive =
        normalizeArchive(input)

      if (!archive) {
        return m.reply(
          `❌ *Invalid archive destination.*\n\n` +

          `Example:\n` +
          `*.antidelete archive 2348012345678*\n\n` +

          `Or group:\n` +
          `*.antidelete archive 120363429429530466@g.us*`
        )
      }

      await setVar(
        'ANTI_DELETE_ARCHIVE',
        archive
      )

      return m.reply(
        `✅ *Anti-delete archive set!*\n\n` +

        `📥 Destination:\n` +
        `*${archive}*\n\n` +

        `🗑️ Deleted messages will now be sent there.`
      )
    }

    /* ========================================================
     * INVALID
     * ======================================================== */

    return m.reply(
      `❌ *Invalid option.*\n\n` +

      `Use:\n` +
      `• *.antidelete on*\n` +
      `• *.antidelete off*\n` +
      `• *.antidelete archive 234xxxxxxxxxx*\n` +
      `• *.antidelete archive 120xxxxxxxx@g.us*`
    )
  },

  /* ==========================================================
   * DELETE EVENT
   * ========================================================== */

  async onDelete({
    sock,
    key,
    messageStore
  }) {
    try {
      console.log(
        `[ANTI-DELETE] Processing delete: ${key?.id}`
      )

      /* ======================================================
       * CHECK ENABLED
       * ====================================================== */

      const enabled =
        getVar('ANTI_DELETE')

      if (!enabled) {
        console.log(
          '[ANTI-DELETE] Disabled.'
        )

        return
      }

      /* ======================================================
       * FIND ORIGINAL
       * ====================================================== */

      const messageId =
        key?.id

      if (!messageId) {
        console.log(
          '[ANTI-DELETE] No message ID.'
        )

        return
      }

      const original =
        messageStore.get(
          messageId
        )

      if (
        !original?.message
      ) {
        console.log(
          `[ANTI-DELETE] Original message NOT FOUND: ${messageId}`
        )

        console.log(
          `[ANTI-DELETE] Store size: ${messageStore.size}`
        )

        return
      }

      console.log(
        `[ANTI-DELETE] Original message FOUND: ${messageId}`
      )

      /* ======================================================
       * DON'T ARCHIVE BOT'S OWN MESSAGE
       * ====================================================== */

      if (
        original.key?.fromMe
      ) {
        console.log(
          '[ANTI-DELETE] Ignoring bot message.'
        )

        return
      }

      /* ======================================================
       * ARCHIVE
       * ====================================================== */

      const archive =
        getArchiveJid()

      if (!archive) {
        console.error(
          '[ANTI-DELETE] No archive destination configured.'
        )

        return
      }

      console.log(
        `[ANTI-DELETE] Archive destination: ${archive}`
      )

      /* ======================================================
       * CHAT
       * ====================================================== */

      const chat =
        original.key?.remoteJid ||
        key?.remoteJid ||
        'Unknown'

      /* ======================================================
       * AUTHOR
       * ====================================================== */

      const author =
        original.key?.participant ||
        original.key?.remoteJid ||
        chat

      /* ======================================================
       * DELETER
       * ====================================================== */

      const deleter =
        key?.participant ||
        key?.remoteJid ||
        chat

      /* ======================================================
       * MESSAGE TYPE
       * ====================================================== */

      const type =
        getContentType(
          original.message
        ) || 'unknown'

      /* ======================================================
       * TEXT / CAPTION
       * ====================================================== */

      let body = ''

      if (
        original.message.conversation
      ) {
        body =
          original.message.conversation
      }

      else if (
        original.message.extendedTextMessage?.text
      ) {
        body =
          original.message
            .extendedTextMessage
            .text
      }

      else if (
        original.message[type]?.caption
      ) {
        body =
          original.message[type]
            .caption
      }

      /* ======================================================
       * CHAT NAME
       * ====================================================== */

      let chatName =
        chat

      try {
        if (
          chat.endsWith('@g.us')
        ) {
          const metadata =
            await sock.groupMetadata(
              chat
            )

          if (
            metadata?.subject
          ) {
            chatName =
              metadata.subject
          }
        }
      } catch (e) {
        console.log(
          `[ANTI-DELETE] Could not get group name: ${e.message}`
        )
      }

      /* ======================================================
       * TIME
       * ====================================================== */

      const time =
        new Date().toLocaleString(
          'en-NG',
          {
            timeZone:
              'Africa/Lagos'
          }
        )

      /* ======================================================
       * HEADER
       * ====================================================== */

      const header =
        `🗑️ *DELETED MESSAGE*\n\n` +

        `👤 *Sender:*\n` +
        `${author}\n\n` +

        `🙈 *Deleted by:*\n` +
        `${deleter}\n\n` +

        `💬 *Chat:*\n` +
        `${chatName}\n\n` +

        `🕐 *Time:*\n` +
        `${time}\n\n` +

        `📦 *Type:*\n` +
        `${type}`

      console.log(
        `[ANTI-DELETE] Message type: ${type}`
      )

      /* ======================================================
       * TEXT MESSAGE
       * ====================================================== */

      if (
        type === 'conversation' ||
        type === 'extendedTextMessage'
      ) {
        await sock.sendMessage(
          archive,
          {
            text:
              `${header}\n\n` +
              `💬 *Message:*\n` +
              `${body || '(empty message)'}`
          }
        )

        console.log(
          `[ANTI-DELETE] Text message sent to ${archive}`
        )

        return
      }

      /* ======================================================
       * MEDIA
       * ====================================================== */

      if (
        mediaTypes.includes(type)
      ) {
        let buffer

        try {
          buffer =
            await downloadMediaMessage(
              original,
              'buffer',
              {},
              {
                reuploadRequest:
                  async (msg) =>
                    sock.updateMediaMessage(
                      msg
                    )
              }
            )
        } catch (e) {
          console.error(
            `[ANTI-DELETE] Media download failed: ${e.message}`
          )

          await sock.sendMessage(
            archive,
            {
              text:
                `${header}\n\n` +

                `⚠️ *Media could not be recovered.*\n\n` +

                `${body || ''}`
            }
          )

          return
        }

        /* ====================================================
         * SEND INFORMATION FIRST
         * ==================================================== */

        await sock.sendMessage(
          archive,
          {
            text:
              `${header}` +

              (
                body
                  ? `\n\n💬 *Caption:*\n${body}`
                  : ''
              )
          }
        )

        /* ====================================================
         * SEND MEDIA
         * ==================================================== */

        if (
          type === 'imageMessage'
        ) {
          await sock.sendMessage(
            archive,
            {
              image: buffer,
              caption:
                body ||
                '🗑️ Deleted image'
            }
          )
        }

        else if (
          type === 'videoMessage'
        ) {
          await sock.sendMessage(
            archive,
            {
              video: buffer,
              caption:
                body ||
                '🗑️ Deleted video'
            }
          )
        }

        else if (
          type === 'audioMessage'
        ) {
          await sock.sendMessage(
            archive,
            {
              audio: buffer,
              mimetype:
                original.message
                  .audioMessage
                  ?.mimetype ||
                'audio/mpeg',

              ptt:
                original.message
                  .audioMessage
                  ?.ptt ||
                false
            }
          )
        }

        else if (
          type === 'stickerMessage'
        ) {
          await sock.sendMessage(
            archive,
            {
              sticker: buffer
            }
          )
        }

        else if (
          type === 'documentMessage'
        ) {
          await sock.sendMessage(
            archive,
            {
              document: buffer,

              mimetype:
                original.message
                  .documentMessage
                  ?.mimetype ||
                'application/octet-stream',

              fileName:
                original.message
                  .documentMessage
                  ?.fileName ||
                'deleted-file'
            }
          )
        }

        console.log(
          `[ANTI-DELETE] Media message sent to ${archive}`
        )

        return
      }

      /* ======================================================
       * OTHER MESSAGE TYPES
       * ====================================================== */

      await sock.sendMessage(
        archive,
        {
          text:
            `${header}\n\n` +

            `💬 *Message:*\n` +

            `${body || '⚠️ Unsupported message type.'}`
        }
      )

      console.log(
        `[ANTI-DELETE] Message sent to ${archive}`
      )

    } catch (e) {
      console.error(
        `[ANTI-DELETE] Recovery failed: ${e.stack || e.message}`
      )
    }
  }
}
