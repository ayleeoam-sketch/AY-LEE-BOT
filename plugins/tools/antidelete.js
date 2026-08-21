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
 * Recovers deleted messages from messageStore and forwards
 * them to the configured archive chat/group.
 *
 * Archive:
 *   .antidelete archive 120363xxxxxxxxxxxx@g.us
 *
 * Or:
 *   .antidelete archive 2348012345678
 *
 * If no archive is configured, the bot uses ownerNumbers[0].
 *
 * IMPORTANT:
 * connection.js must store messages using:
 *
 * messageStore.set(raw.key.id, raw)
 *
 * and call:
 *
 * mw.onDelete({
 *   sock,
 *   key,
 *   messageStore
 * })
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
     * WhatsApp group JID
     *
     * Example:
     * 120363429429530466@g.us
     */
    if (
      configured.endsWith('@g.us')
    ) {
      return configured
    }

    /*
     * WhatsApp user JID
     *
     * Example:
     * 2348012345678@s.whatsapp.net
     */
    if (
      configured.endsWith('@s.whatsapp.net')
    ) {
      return configured
    }

    /*
     * Raw number
     */
    const number =
      configured.replace(
        /\D/g,
        ''
      )

    if (number) {
      return `${number}@s.whatsapp.net`
    }
  }

  /*
   * Fallback to first owner
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
 * MESSAGE UNWRAPPING
 *
 * WhatsApp can wrap messages inside:
 *
 * ephemeralMessage
 * viewOnceMessage
 * viewOnceMessageV2
 * documentWithCaptionMessage
 *
 * This function unwraps them before processing.
 * ============================================================ */

const unwrapMessage = (message) => {
  let current = message

  if (!current) {
    return null
  }

  /*
   * Keep unwrapping until we reach the actual message.
   */
  let changed = true

  while (
    current &&
    changed
  ) {
    changed = false

    if (
      current.ephemeralMessage?.message
    ) {
      current =
        current.ephemeralMessage.message

      changed = true
      continue
    }

    if (
      current.viewOnceMessage?.message
    ) {
      current =
        current.viewOnceMessage.message

      changed = true
      continue
    }

    if (
      current.viewOnceMessageV2?.message
    ) {
      current =
        current.viewOnceMessageV2.message

      changed = true
      continue
    }

    if (
      current.viewOnceMessageV2Extension?.message
    ) {
      current =
        current.viewOnceMessageV2Extension.message

      changed = true
      continue
    }

    if (
      current.documentWithCaptionMessage?.message
    ) {
      current =
        current.documentWithCaptionMessage.message

      changed = true
      continue
    }
  }

  return current
}


/* ============================================================
 * GET MESSAGE TEXT
 * ============================================================ */

const getMessageBody = (
  message
) => {
  if (!message) {
    return ''
  }

  /*
   * Normal text
   */
  if (
    message.conversation
  ) {
    return message.conversation
  }

  /*
   * Extended text
   */
  if (
    message.extendedTextMessage?.text
  ) {
    return message
      .extendedTextMessage
      .text
  }

  /*
   * Captions
   */
  if (
    message.imageMessage?.caption
  ) {
    return message
      .imageMessage
      .caption
  }

  if (
    message.videoMessage?.caption
  ) {
    return message
      .videoMessage
      .caption
  }

  if (
    message.documentMessage?.caption
  ) {
    return message
      .documentMessage
      .caption
  }

  return ''
}


/* ============================================================
 * GET SENDER JID
 * ============================================================ */

const getSenderJid = (
  original,
  chat
) => {
  return (
    original?.key?.participant ||
    original?.participant ||
    original?.key?.remoteJid ||
    chat
  )
}


/* ============================================================
 * GET DELETER JID
 * ============================================================ */

const getDeleterJid = (
  key,
  original,
  chat
) => {
  return (
    key?.participant ||
    key?.remoteJid ||
    original?.key?.participant ||
    chat
  )
}


/* ============================================================
 * FORMAT JID
 * ============================================================ */

const mentionJid = (
  jid
) => {
  if (!jid) {
    return ''
  }

  return `@${String(jid)
    .split('@')[0]
    .split(':')[0]}`
}


/* ============================================================
 * FIND ORIGINAL MESSAGE
 *
 * We first try exact ID.
 *
 * If that fails, we also search through the store because
 * some WhatsApp delete events can normalize the key differently.
 * ============================================================ */

const findOriginalMessage = (
  messageStore,
  key
) => {
  if (!messageStore || !key?.id) {
    return null
  }

  /*
   * Exact lookup
   */
  const exact =
    messageStore.get(
      key.id
    )

  if (exact?.message) {
    return exact
  }

  /*
   * Fallback search
   */
  for (
    const message
    of messageStore.values()
  ) {
    if (
      !message?.key
    ) {
      continue
    }

    if (
      message.key.id !== key.id
    ) {
      continue
    }

    /*
     * If remoteJid is available,
     * make sure we're talking about
     * the same chat.
     */
    if (
      key.remoteJid &&
      message.key.remoteJid &&
      key.remoteJid !==
        message.key.remoteJid
    ) {
      continue
    }

    return message
  }

  return null
}


/* ============================================================
 * GET CHAT NAME
 * ============================================================ */

const getChatName = async (
  sock,
  chat
) => {
  if (!chat) {
    return 'Unknown chat'
  }

  /*
   * Group
   */
  if (
    chat.endsWith('@g.us')
  ) {
    try {
      const metadata =
        await sock.groupMetadata(
          chat
        )

      return (
        metadata?.subject ||
        chat
      )
    } catch {
      return chat
    }
  }

  /*
   * Private chat
   */
  return chat
}


/* ============================================================
 * SEND ARCHIVE TEXT
 * ============================================================ */

const sendArchiveText = async (
  sock,
  archive,
  text,
  mentions = []
) => {
  try {
    await sock.sendMessage(
      archive,
      {
        text,
        mentions
      }
    )

    console.log(
      `[ANTI-DELETE] Archive message sent successfully to ${archive}`
    )

    return true
  } catch (e) {
    console.error(
      `[ANTI-DELETE] Failed to send archive message: ${e.message}`
    )

    return false
  }
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
    'Recover deleted messages and send them to an archive chat/group',

  usage:
    '.antidelete on | off | archive <number/group JID>',

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
     * SHOW STATUS
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

        `• *.antidelete archive 234xxxxxxxxxx*\n` +

        `• *.antidelete archive 120363xxxxxxxx@g.us*`
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

      return m.reply(
        `✅ Anti-delete turned *${sub}*.\n\n` +

        (
          enabled
            ? 'Deleted messages will now be archived.'
            : 'Deleted messages will no longer be recovered.'
        )
      )
    }


    /* ========================================================
     * ARCHIVE
     * ======================================================== */

    if (
      sub === 'archive'
    ) {
      let destination =
        String(
          args
            ?.slice(1)
            ?.join(' ') ||
          ''
        ).trim()

      if (!destination) {
        return m.reply(
          `❌ Enter an archive destination.\n\n` +

          `For a WhatsApp number:\n` +

          `*.antidelete archive 2348012345678*\n\n` +

          `For a WhatsApp group:\n` +

          `*.antidelete archive 120363xxxxxxxx@g.us*`
        )
      }


      /*
       * Group JID
       */
      if (
        destination.endsWith('@g.us')
      ) {
        await setVar(
          'ANTI_DELETE_ARCHIVE',
          destination
        )

        return m.reply(
          `✅ *Anti-delete archive set!*\n\n` +

          `📥 Destination: *Archive Group*\n` +

          `🆔 ${destination}\n\n` +

          `🗑️ Deleted messages will now be sent to this group.`
        )
      }


      /*
       * Already a WhatsApp JID
       */
      if (
        destination.endsWith(
          '@s.whatsapp.net'
        )
      ) {
        await setVar(
          'ANTI_DELETE_ARCHIVE',
          destination
        )

        return m.reply(
          `✅ *Anti-delete archive set!*\n\n` +

          `📥 Destination: *${destination}*\n\n` +

          `🗑️ Deleted messages will now be archived there.`
        )
      }


      /*
       * Number
       */
      const number =
        destination.replace(
          /\D/g,
          ''
        )

      if (!number) {
        return m.reply(
          `❌ Invalid archive destination.\n\n` +

          `Example:\n` +

          `*.antidelete archive 2348012345678*`
        )
      }


      const jid =
        `${number}@s.whatsapp.net`

      await setVar(
        'ANTI_DELETE_ARCHIVE',
        jid
      )

      return m.reply(
        `✅ *Anti-delete archive set!*\n\n` +

        `📥 Destination: *+${number}*\n\n` +

        `🗑️ Deleted messages will now be archived there.`
      )
    }


    /* ========================================================
     * INVALID
     * ======================================================== */

    return m.reply(
      `❌ Invalid option.\n\n` +

      `Use:\n` +

      `*.antidelete on*\n` +

      `*.antidelete off*\n` +

      `*.antidelete archive 234xxxxxxxxxx*\n` +

      `*.antidelete archive 120363xxxxxxxx@g.us*`
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
      `[ANTI-DELETE] Processing delete event: ${key?.id || 'unknown'}`
    )


    /* ========================================================
     * CHECK ENABLED
     * ======================================================== */

    const enabled =
      getVar(
        'ANTI_DELETE'
      )

    if (!enabled) {
      console.log(
        '[ANTI-DELETE] Disabled. Ignoring delete event.'
      )

      return
    }


    /* ========================================================
     * VALIDATE KEY
     * ======================================================== */

    if (!key?.id) {
      console.log(
        '[ANTI-DELETE] Delete event has no message ID.'
      )

      return
    }


    /* ========================================================
     * FIND ORIGINAL
     * ======================================================== */

    const original =
      findOriginalMessage(
        messageStore,
        key
      )

    if (!original?.message) {
      console.error(
        `[ANTI-DELETE] ORIGINAL MESSAGE NOT FOUND: ${key.id}`
      )

      console.error(
        `[ANTI-DELETE] Current messageStore size: ${messageStore?.size || 0}`
      )

      /*
       * Send diagnostic information to archive if possible.
       */
      const archive =
        getArchiveJid()

      if (archive) {
        await sendArchiveText(
          sock,
          archive,

          `⚠️ *ANTI-DELETE ERROR*\n\n` +

          `The bot detected that a message was deleted, ` +
          `but the original message was no longer available ` +
          `in memory.\n\n` +

          `🆔 Message ID:\n${key.id}\n\n` +

          `📦 Store size: ${messageStore?.size || 0}`
        )
      }

      return
    }


    console.log(
      `[ANTI-DELETE] ORIGINAL MESSAGE FOUND: ${key.id}`
    )


    /* ========================================================
     * DON'T RECOVER BOT'S OWN MESSAGES
     * ======================================================== */

    if (
      original.key?.fromMe
    ) {
      console.log(
        '[ANTI-DELETE] Deleted message belongs to the bot. Ignoring.'
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
     * CHAT
     * ======================================================== */

    const chat =
      original.key?.remoteJid ||
      key.remoteJid ||
      'unknown'


    /* ========================================================
     * SENDER
     * ======================================================== */

    const author =
      getSenderJid(
        original,
        chat
      )


    /* ========================================================
     * DELETER
     * ======================================================== */

    const deleter =
      getDeleterJid(
        key,
        original,
        chat
      )


    /* ========================================================
     * UNWRAP MESSAGE
     * ======================================================== */

    const message =
      unwrapMessage(
        original.message
      )

    if (!message) {
      console.error(
        '[ANTI-DELETE] Could not unwrap original message.'
      )

      return
    }


    /* ========================================================
     * MESSAGE TYPE
     * ======================================================== */

    const type =
      getContentType(
        message
      ) ||
      'unknown'


    /* ========================================================
     * CHAT NAME
     * ======================================================== */

    const chatName =
      await getChatName(
        sock,
        chat
      )


    /* ========================================================
     * MESSAGE BODY
     * ======================================================== */

    const body =
      getMessageBody(
        message
      )


    /* ========================================================
     * MENTIONS
     * ======================================================== */

    const mentions = []

    if (author?.includes('@')) {
      mentions.push(author)
    }

    if (
      deleter?.includes('@') &&
      deleter !== author
    ) {
      mentions.push(deleter)
    }


    /* ========================================================
     * HEADER
     *
     * NO TIME INCLUDED.
     * ======================================================== */

    const header =
      `🗑️ *DELETED MESSAGE ARCHIVE*\n\n` +

      `👤 *Sender:* ${mentionJid(author)}\n` +

      `🙈 *Deleted by:* ${mentionJid(deleter)}\n` +

      `💬 *Chat:* ${chatName}\n` +

      `📦 *Type:* ${type}`


    /* ========================================================
     * PROCESS
     * ======================================================== */

    try {

      /* ======================================================
       * TEXT MESSAGE
       * ====================================================== */

      if (
        type === 'conversation' ||
        type === 'extendedTextMessage'
      ) {

        if (!body) {
          await sendArchiveText(
            sock,
            archive,
            `${header}\n\n` +
            `💬 *Message:*\n` +
            `_Empty text message_`,
            mentions
          )

          return
        }

        await sendArchiveText(
          sock,
          archive,

          `${header}\n\n` +

          `💬 *Message:*\n` +

          body,

          mentions
        )

        return
      }


      /* ======================================================
       * MEDIA
       * ====================================================== */

      if (
        mediaTypes.includes(
          type
        )
      ) {

        /*
         * Send archive information first.
         */
        await sendArchiveText(
          sock,
          archive,

          `${header}` +

          (
            body
              ? `\n\n💬 *Caption:*\n${body}`
              : ''
          ),

          mentions
        )


        /* ====================================================
         * DOWNLOAD MEDIA
         * ==================================================== */

        let buffer

        try {

          console.log(
            `[ANTI-DELETE] Downloading deleted ${type}...`
          )

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

          await sendArchiveText(
            sock,
            archive,

            `⚠️ *MEDIA RECOVERY FAILED*\n\n` +

            `The deleted ${type} was detected, ` +
            `but WhatsApp did not allow the media to be downloaded.\n\n` +

            `Reason: ${e.message}`

          )

          return
        }


        /* ====================================================
         * PREPARE MEDIA
         * ==================================================== */

        let mediaPayload


        if (
          type === 'imageMessage'
        ) {

          mediaPayload = {
            image: buffer,

            caption:
              body ||
              undefined
          }

        }


        else if (
          type === 'videoMessage'
        ) {

          mediaPayload = {
            video: buffer,

            caption:
              body ||
              undefined
          }

        }


        else if (
          type === 'audioMessage'
        ) {

          mediaPayload = {
            audio: buffer,

            mimetype:
              message
                .audioMessage
                ?.mimetype ||
              'audio/mpeg',

            ptt:
              message
                .audioMessage
                ?.ptt ||
              false
          }

        }


        else if (
          type === 'stickerMessage'
        ) {

          mediaPayload = {
            sticker: buffer
          }

        }


        else if (
          type === 'documentMessage'
        ) {

          mediaPayload = {
            document: buffer,

            mimetype:
              message
                .documentMessage
                ?.mimetype ||
              'application/octet-stream',

            fileName:
              message
                .documentMessage
                ?.fileName ||
              'deleted-file'
          }

        }


        /* ====================================================
         * SEND MEDIA
         * ==================================================== */

        try {

          await sock.sendMessage(
            archive,
            mediaPayload
          )

          console.log(
            `[ANTI-DELETE] Deleted ${type} successfully sent to ${archive}`
          )

        } catch (e) {

          console.error(
            `[ANTI-DELETE] Failed to send deleted media: ${e.message}`
          )

          await sendArchiveText(
            sock,
            archive,

            `⚠️ *MEDIA SEND FAILED*\n\n` +

            `The deleted ${type} was recovered ` +
            `but could not be sent to the archive.\n\n` +

            `Reason: ${e.message}`
          )
        }

        return
      }


      /* ======================================================
       * UNKNOWN MESSAGE TYPE
       * ====================================================== */

      console.log(
        `[ANTI-DELETE] Unknown message type: ${type}`
      )

      await sendArchiveText(
        sock,
        archive,

        `${header}\n\n` +

        `⚠️ *Message type:* ${type}\n\n` +

        `The bot detected and recovered this message, ` +
        `but this message type is not currently supported.`,

        mentions
      )

    } catch (e) {

      console.error(
        `[ANTI-DELETE] Recovery failed: ${e.stack || e.message}`
      )

      try {

        await sendArchiveText(
          sock,
          archive,

          `❌ *ANTI-DELETE ERROR*\n\n` +

          `Message ID:\n${key.id}\n\n` +

          `Error:\n${e.message}`
        )

      } catch {
        /* Ignore secondary archive errors */
      }
    }
  }
}
