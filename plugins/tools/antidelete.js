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
 * Recover deleted messages and send them to:
 *
 * 1. Configured archive JID
 * 2. Owner number if no archive is configured
 *
 * Supported archive formats:
 *
 * Phone:
 *   2348012345678
 *
 * Group:
 *   120363429429530466@g.us
 *
 * ============================================================ */


/* ============================================================
 * ARCHIVE DESTINATION
 * ============================================================ */

const getArchiveJid = () => {
  const configured =
    String(
      getVar('ANTI_DELETE_ARCHIVE') || ''
    ).trim()

  /*
   * Explicit archive destination
   */
  if (configured) {

    /*
     * WhatsApp JID already supplied
     *
     * Example:
     * 120363429429530466@g.us
     */
    if (
      configured.endsWith('@g.us') ||
      configured.endsWith('@s.whatsapp.net')
    ) {
      return configured
    }

    /*
     * Otherwise treat it as a phone number.
     */
    const number =
      configured.replace(
        /\D/g,
        ''
      )

    if (number) {
      return `${number}@s.whatsapp.net`
    }

    return null
  }

  /*
   * Fallback to first owner number.
   */
  const owner =
    config.ownerNumbers?.[0]

  if (!owner) {
    return null
  }

  if (
    String(owner).includes('@')
  ) {
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
 * NORMALIZE JID
 * ============================================================ */

const normalizeJid = (jid) => {
  if (!jid) return null

  const value =
    String(jid).trim()

  if (
    value.endsWith('@g.us') ||
    value.endsWith('@s.whatsapp.net')
  ) {
    return value
  }

  const number =
    value.replace(
      /\D/g,
      ''
    )

  if (!number) {
    return null
  }

  return `${number}@s.whatsapp.net`
}


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
    'Recover deleted messages and send them to an archive chat.',

  usage:
    '.antidelete on | off | archive <number/JID>',

  owner: true,


  /* ==========================================================
   * COMMAND
   * ========================================================== */

  async run({ m, args }) {

    const sub =
      String(
        args?.[0] || ''
      ).toLowerCase()


    /* ========================================================
     * .antidelete
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
        }*\n` +

        `Archive: *${
          archive ||
          'Not configured'
        }*\n\n` +

        `Use:\n` +

        `• *.antidelete on*\n` +

        `• *.antidelete off*\n` +

        `• *.antidelete archive <number>*\n` +

        `• *.antidelete archive <group JID>*`
      )
    }


    /* ========================================================
     * ON / OFF
     * ======================================================== */

    if (
      sub === 'on' ||
      sub === 'off'
    ) {

      const enabled =
        sub === 'on'

      await setVar(
        'ANTI_DELETE',
        enabled
          ? 'true'
          : 'false'
      )

      const archive =
        getArchiveJid()

      return m.reply(
        enabled

          ? `✅ *Anti-delete turned ON.*\n\n` +
            `🗑️ Deleted messages will now be recovered.\n` +
            `📥 Archive: *${
              archive ||
              'Owner chat'
            }*`

          : `❌ *Anti-delete turned OFF.*\n\n` +
            `Deleted messages will no longer be recovered.`
      )
    }


    /* ========================================================
     * ARCHIVE
     * ======================================================== */

    if (
      sub === 'archive'
    ) {

      const target =
        String(
          args?.[1] || ''
        ).trim()

      if (!target) {

        return m.reply(
          `❌ *Invalid archive destination.*\n\n` +

          `You can use a WhatsApp number:\n` +

          `*.antidelete archive 2348012345678*\n\n` +

          `Or a WhatsApp group JID:\n` +

          `*.antidelete archive 120363429429530466@g.us*`
        )
      }


      /*
       * Convert input to JID.
       */
      const jid =
        normalizeJid(target)


      if (!jid) {

        return m.reply(
          `❌ *Invalid archive destination.*\n\n` +

          `Example:\n` +

          `*.antidelete archive 2348012345678*\n\n` +

          `Or:\n` +

          `*.antidelete archive 120363429429530466@g.us*`
        )
      }


      /*
       * Save the actual JID.
       */
      await setVar(
        'ANTI_DELETE_ARCHIVE',
        jid
      )


      return m.reply(
        `✅ *Anti-delete archive set!*\n\n` +

        `📥 Destination: *${jid}*\n\n` +

        `🗑️ Deleted messages will now be sent there.`
      )
    }


    /* ========================================================
     * INVALID OPTION
     * ======================================================== */

    return m.reply(
      `❌ *Invalid option.*\n\n` +

      `Use:\n` +

      `*.antidelete on*\n` +

      `*.antidelete off*\n` +

      `*.antidelete archive 2348012345678*\n` +

      `*.antidelete archive 120363429429530466@g.us*`
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
      `[ANTI-DELETE] Processing deleted message: ${key?.id || 'unknown'}`
    )


    /* ========================================================
     * CHECK ENABLED
     * ======================================================== */

    const enabled =
      getVar('ANTI_DELETE')

    if (!enabled) {

      console.log(
        '[ANTI-DELETE] Disabled.'
      )

      return
    }


    /* ========================================================
     * MESSAGE ID
     * ======================================================== */

    const messageId =
      key?.id

    if (!messageId) {

      console.log(
        '[ANTI-DELETE] Delete event has no message ID.'
      )

      return
    }


    /* ========================================================
     * FIND ORIGINAL MESSAGE
     * ======================================================== */

    const original =
      messageStore.get(
        messageId
      )


    if (
      !original?.message
    ) {

      console.log(
        `[ANTI-DELETE] Original message not found in messageStore: ${messageId}`
      )

      return
    }


    console.log(
      `[ANTI-DELETE] Original message found: ${messageId}`
    )


    /* ========================================================
     * DO NOT ARCHIVE BOT'S OWN MESSAGE
     * ======================================================== */

    if (
      original.key?.fromMe
    ) {

      console.log(
        '[ANTI-DELETE] Ignoring bot message.'
      )

      return
    }


    /* ========================================================
     * ARCHIVE DESTINATION
     * ======================================================== */

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


    /* ========================================================
     * ORIGINAL CHAT
     * ======================================================== */

    const chat =
      original.key?.remoteJid ||
      key?.remoteJid ||
      'Unknown'


    /* ========================================================
     * SENDER
     * ======================================================== */

    const author =
      original.key?.participant ||
      original.key?.remoteJid ||
      chat


    /* ========================================================
     * DELETER
     * ======================================================== */

    const deleter =
      key?.participant ||
      key?.remoteJid ||
      chat


    /* ========================================================
     * MESSAGE TYPE
     * ======================================================== */

    let type

    try {

      type =
        getContentType(
          original.message
        )

    } catch {

      type =
        'unknown'
    }


    /* ========================================================
     * TIME
     * ======================================================== */

    const time =
      new Date().toLocaleTimeString(
        'en-GB',
        {
          hour12: false
        }
      )


    /* ========================================================
     * CHAT NAME
     * ======================================================== */

    let chatName =
      chat


    if (
      chat.endsWith('@g.us')
    ) {

      try {

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

      } catch (e) {

        console.log(
          `[ANTI-DELETE] Could not get group name: ${e.message}`
        )
      }
    }


    /* ========================================================
     * HEADER
     * ======================================================== */

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
    ].filter(Boolean)


    try {

      /* ======================================================
       * GET MESSAGE BODY
       * ====================================================== */

      const message =
        original.message


      const body =
        message.conversation ||

        message.extendedTextMessage?.text ||

        message[type]?.caption ||

        message.imageMessage?.caption ||

        message.videoMessage?.caption ||

        message.documentMessage?.caption ||

        ''


      /* ======================================================
       * MEDIA
       * ====================================================== */

      if (
        mediaTypes.includes(type)
      ) {

        console.log(
          `[ANTI-DELETE] Downloading deleted ${type}...`
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

        } catch (e) {

          console.error(
            `[ANTI-DELETE] Media download failed: ${e.message}`
          )


          await sock.sendMessage(
            archive,
            {
              text:
                `${header}\n\n` +

                `⚠️ *Media could not be recovered.*\n` +

                `The media may have expired or is no longer available.`,

              mentions
            }
          )

          return
        }


        /* ====================================================
         * SEND INFORMATION
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
              ),

            mentions
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

          return
        }


        if (
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

          return
        }


        if (
          type === 'audioMessage'
        ) {

          await sock.sendMessage(
            archive,
            {
              audio: buffer,

              mimetype:
                message.audioMessage?.mimetype ||
                'audio/mpeg',

              ptt:
                message.audioMessage?.ptt ||
                false
            }
          )

          return
        }


        if (
          type === 'stickerMessage'
        ) {

          await sock.sendMessage(
            archive,
            {
              sticker: buffer
            }
          )

          return
        }


        if (
          type === 'documentMessage'
        ) {

          await sock.sendMessage(
            archive,
            {
              document: buffer,

              mimetype:
                message.documentMessage?.mimetype ||
                'application/octet-stream',

              fileName:
                message.documentMessage?.fileName ||
                'deleted-file'
            }
          )

          return
        }


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
          `[ANTI-DELETE] Deleted text archived successfully.`
        )

        return
      }


      /* ======================================================
       * UNKNOWN / EMPTY MESSAGE
       * ====================================================== */

      await sock.sendMessage(
        archive,
        {
          text:
            `${header}\n\n` +

            `⚠️ *Message content could not be extracted.*`,

          mentions
        }
      )

    } catch (e) {

      console.error(
        `[ANTI-DELETE] Recovery failed: ${e.message}`
      )
    }
  }
}
