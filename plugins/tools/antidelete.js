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
 * ARCHIVE DESTINATION
 * ============================================================ */

const getArchiveJid = () => {
  const configured = String(
    getVar('ANTI_DELETE_ARCHIVE') || ''
  ).trim()

  if (configured) {
    return configured
  }

  const owner =
    config.ownerNumbers?.[0]

  if (!owner) return null

  if (owner.includes('@')) {
    return owner
  }

  return `${String(owner).replace(/\D/g, '')}@s.whatsapp.net`
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
    'Recover deleted messages and archive them',

  usage:
    '.antidelete on | off | archive here',

  owner: true,

  /* ==========================================================
   * COMMAND
   * ========================================================== */

  async run({ m, args }) {

    const sub =
      String(args[0] || '')
        .toLowerCase()

    /* --------------------------------------------------------
     * STATUS
     * -------------------------------------------------------- */

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
        `• *.antidelete archive here*`
      )
    }

    /* --------------------------------------------------------
     * ON / OFF
     * -------------------------------------------------------- */

    if (
      sub === 'on' ||
      sub === 'off'
    ) {

      await setVar(
        'ANTI_DELETE',
        sub === 'on'
          ? 'true'
          : 'false'
      )

      return m.reply(
        `✅ Anti-delete turned *${sub}*.\n\n` +

        (
          sub === 'on'
            ? `🗑️ Deleted messages will now be recovered and sent to the archive.`
            : `🛑 Deleted messages will no longer be recovered.`
        )
      )
    }

    /* --------------------------------------------------------
     * ARCHIVE
     *
     * .antidelete archive here
     *
     * Must be used inside the archive group.
     * -------------------------------------------------------- */

    if (sub === 'archive') {

      const option =
        String(args[1] || '')
          .toLowerCase()

      /* ------------------------------------------------------
       * ARCHIVE CURRENT GROUP
       * ------------------------------------------------------ */

      if (option === 'here') {

        if (!m.chat?.endsWith('@g.us')) {

          return m.reply(
            `❌ This command must be used *inside the archive group*.\n\n` +

            `Open your deleted-message archive group and send:\n` +
            `*.antidelete archive here*`
          )
        }

        await setVar(
          'ANTI_DELETE_ARCHIVE',
          m.chat
        )

        let groupName =
          'Archive Group'

        try {

          const metadata =
            await m.sock?.groupMetadata?.(
              m.chat
            )

          groupName =
            metadata?.subject ||
            groupName

        } catch {
          /* ignore */
        }

        return m.reply(
          `✅ *Anti-delete archive set!*\n\n` +
          `📥 Destination: *${groupName}*\n` +
          `🆔 ${m.chat}\n\n` +
          `🗑️ Deleted messages will now be sent to this group.`
        )
      }

      /* ------------------------------------------------------
       * DIRECT JID
       *
       * Useful if the group JID is already known.
       *
       * .antidelete archive 120363xxxxxxxx@g.us
       * ------------------------------------------------------ */

      if (
        option.endsWith('@g.us') ||
        option.endsWith('@s.whatsapp.net')
      ) {

        await setVar(
          'ANTI_DELETE_ARCHIVE',
          option
        )

        return m.reply(
          `✅ Archive destination updated.\n\n` +
          `📥 ${option}`
        )
      }

      /* ------------------------------------------------------
       * PHONE NUMBER
       * ------------------------------------------------------ */

      const number =
        String(args[1] || '')
          .replace(/\D/g, '')

      if (number) {

        const jid =
          `${number}@s.whatsapp.net`

        await setVar(
          'ANTI_DELETE_ARCHIVE',
          jid
        )

        return m.reply(
          `✅ Archive destination updated.\n\n` +
          `📥 +${number}`
        )
      }

      return m.reply(
        `❌ Invalid archive command.\n\n` +

        `To use a group:\n` +
        `1️⃣ Enter your archive group\n` +
        `2️⃣ Send *.antidelete archive here*\n\n` +

        `Or use a WhatsApp number:\n` +
        `*.antidelete archive 234xxxxxxxxxx*`
      )
    }

    /* --------------------------------------------------------
     * INVALID OPTION
     * -------------------------------------------------------- */

    return m.reply(
      `❌ Invalid option.\n\n` +

      `Use:\n` +
      `• *.antidelete on*\n` +
      `• *.antidelete off*\n` +
      `• *.antidelete archive here*`
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

    console.log(
      `[ANTI-DELETE] Processing delete: ${key?.id}`
    )

    /* --------------------------------------------------------
     * CHECK STATUS
     * -------------------------------------------------------- */

    if (!getVar('ANTI_DELETE')) {

      console.log(
        '[ANTI-DELETE] Disabled'
      )

      return
    }

    /* --------------------------------------------------------
     * FIND ORIGINAL MESSAGE
     * -------------------------------------------------------- */

    const original =
      messageStore.get(key.id)

    if (!original?.message) {

      console.log(
        `[ANTI-DELETE] Original message not found: ${key.id}`
      )

      return
    }

    /* --------------------------------------------------------
     * DON'T RECOVER BOT'S OWN MESSAGE
     * -------------------------------------------------------- */

    if (original.key.fromMe) {

      console.log(
        '[ANTI-DELETE] Ignoring bot message'
      )

      return
    }

    /* --------------------------------------------------------
     * ARCHIVE DESTINATION
     * -------------------------------------------------------- */

    const archive =
      getArchiveJid()

    if (!archive) {

      console.error(
        '[ANTI-DELETE] No archive destination configured'
      )

      return
    }

    console.log(
      `[ANTI-DELETE] Archive destination: ${archive}`
    )

    /* --------------------------------------------------------
     * ORIGINAL CHAT
     * -------------------------------------------------------- */

    const chat =
      original.key.remoteJid ||
      key.remoteJid

    /* --------------------------------------------------------
     * SENDER
     * -------------------------------------------------------- */

    const author =
      original.key.participant ||
      original.key.remoteJid ||
      chat

    /* --------------------------------------------------------
     * DELETER
     * -------------------------------------------------------- */

    const deleter =
      key.participant ||
      original.key.participant ||
      chat

    /* --------------------------------------------------------
     * MESSAGE TYPE
     * -------------------------------------------------------- */

    const type =
      getContentType(
        original.message
      )

    /* --------------------------------------------------------
     * TIME
     * -------------------------------------------------------- */

    const time =
      new Date().toLocaleTimeString(
        'en-GB',
        {
          hour12: false
        }
      )

    /* --------------------------------------------------------
     * CHAT NAME
     * -------------------------------------------------------- */

    let chatName = chat

    try {

      if (
        chat?.endsWith('@g.us')
      ) {

        const metadata =
          await sock.groupMetadata(
            chat
          )

        chatName =
          metadata?.subject ||
          chat
      }

    } catch {
      /* ignore */
    }

    /* --------------------------------------------------------
     * HEADER
     * -------------------------------------------------------- */

    const header =
      `🗑️ *DELETED MESSAGE*\n\n` +

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

      /* ======================================================
       * EXTRACT TEXT / CAPTION
       * ====================================================== */

      const body =
        original.message.conversation ||

        original.message.extendedTextMessage?.text ||

        original.message[type]?.caption ||

        ''

      /* ======================================================
       * MEDIA
       * ====================================================== */

      if (
        mediaTypes.includes(type)
      ) {

        console.log(
          `[ANTI-DELETE] Downloading ${type}`
        )

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

        } catch (error) {

          console.error(
            `[ANTI-DELETE] Media download failed: ${error.message}`
          )

          await sock.sendMessage(
            archive,
            {
              text:
                `${header}\n\n` +

                `⚠️ *Media could not be recovered.*\n` +

                `WhatsApp may have already expired the media.`,
              mentions
            }
          )

          return
        }

        /* ----------------------------------------------------
         * SEND INFORMATION
         * ---------------------------------------------------- */

        await sock.sendMessage(
          archive,
          {
            text:
              `${header}` +

              (
                body
                  ? `\n\n💬 *Caption:*\n${body}`
                  : ''
              ),

            mentions
          }
        )

        /* ----------------------------------------------------
         * SEND MEDIA
         * ---------------------------------------------------- */

        const mediaMap = {

          imageMessage: {
            image: buffer,
            caption:
              body || undefined
          },

          videoMessage: {
            video: buffer,
            caption:
              body || undefined
          },

          audioMessage: {
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
          },

          stickerMessage: {
            sticker: buffer
          },

          documentMessage: {

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

        }

        await sock.sendMessage(
          archive,
          mediaMap[type]
        )

        console.log(
          `[ANTI-DELETE] ${type} archived successfully`
        )

        return
      }

      /* ======================================================
       * TEXT MESSAGE
       * ====================================================== */

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

        console.log(
          '[ANTI-DELETE] Text message archived successfully'
        )

        return
      }

      /* ======================================================
       * UNKNOWN MESSAGE
       * ====================================================== */

      await sock.sendMessage(
        archive,
        {
          text:
            `${header}\n\n` +
            `⚠️ Unable to extract the deleted message content.`,

          mentions
        }
      )

    } catch (error) {

      console.error(
        `[ANTI-DELETE] Recovery failed: ${error.message}`
      )
    }
  }
}
