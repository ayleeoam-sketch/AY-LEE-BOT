```javascript
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
 * ARCHIVE JID
 * ============================================================ */

function getArchiveJid() {
  const configured =
    String(
      getVar('ANTI_DELETE_ARCHIVE') || ''
    ).trim()

  if (configured) {
    /*
     * GROUP JID
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
     * PRIVATE JID
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
     * If only a phone number was supplied.
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
   * Fallback to owner.
   */
  const owner =
    config.ownerNumbers?.[0]

  if (!owner) {
    return null
  }

  if (
    owner.includes('@')
  ) {
    return owner
  }

  const number =
    String(owner).replace(
      /\D/g,
      ''
    )

  return number
    ? `${number}@s.whatsapp.net`
    : null
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
 * MESSAGE TEXT
 * ============================================================ */

function getMessageText(message) {
  if (!message) {
    return ''
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ''
  )
}

/* ============================================================
 * GET AUTHOR
 * ============================================================ */

function getAuthor(message, key) {
  return (
    key?.participant ||
    message?.key?.participant ||
    message?.key?.remoteJid ||
    key?.remoteJid ||
    ''
  )
}

/* ============================================================
 * ARCHIVE DESTINATION TEST
 * ============================================================ */

async function testArchive(sock, archive) {
  try {
    /*
     * We don't send a test message.
     *
     * Instead, check that the JID has a valid WhatsApp format.
     */

    if (
      archive.endsWith('@g.us')
    ) {
      console.log(
        `[ANTI-DELETE] Archive group: ${archive}`
      )

      return true
    }

    if (
      archive.endsWith(
        '@s.whatsapp.net'
      )
    ) {
      console.log(
        `[ANTI-DELETE] Archive private chat: ${archive}`
      )

      return true
    }

    console.error(
      `[ANTI-DELETE] Invalid archive JID: ${archive}`
    )

    return false

  } catch (e) {
    console.error(
      `[ANTI-DELETE] Archive validation failed: ${e.message}`
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
    'Recover deleted messages to an archive chat',

  usage:
    '.antidelete on | off | archive',

  owner: true,

  /* ==========================================================
   * COMMAND
   * ========================================================== */

  async run({
    m,
    args,
    sock
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
        `*${
          archive ||
          'Not configured'
        }*\n\n` +

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
        `✅ *Anti-delete turned ON.*\n\n` +

        `📥 Archive:\n` +
        `*${
          archive ||
          'Not configured'
        }*\n\n` +

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
        `✅ *Anti-delete turned OFF.*`
      )
    }

    /* ========================================================
     * ARCHIVE
     * ======================================================== */

    if (
      sub === 'archive'
    ) {

      const raw =
        String(
          args?.[1] || ''
        ).trim()

      if (!raw) {
        return m.reply(
          `❌ *Invalid archive destination.*\n\n` +

          `Example:\n` +
          `*.antidelete archive 2348012345678*\n\n` +

          `Or group:\n` +
          `*.antidelete archive 120363429429530466@g.us*`
        )
      }

      let destination = raw

      /*
       * GROUP
       */
      if (
        destination.endsWith('@g.us')
      ) {
        // already correct
      }

      /*
       * PRIVATE JID
       */
      else if (
        destination.endsWith(
          '@s.whatsapp.net'
        )
      ) {
        // already correct
      }

      /*
       * PHONE NUMBER
       */
      else {

        const number =
          destination.replace(
            /\D/g,
            ''
          )

        if (!number) {
          return m.reply(
            `❌ *Invalid archive destination.*\n\n` +

            `Example:\n` +
            `*.antidelete archive 2348012345678*\n\n` +

            `Or group:\n` +
            `*.antidelete archive 120363429429530466@g.us*`
          )
        }

        destination =
          `${number}@s.whatsapp.net`
      }

      await setVar(
        'ANTI_DELETE_ARCHIVE',
        destination
      )

      return m.reply(
        `✅ *Anti-delete archive set!*\n\n` +

        `📥 Destination:\n` +
        `*${destination}*\n\n` +

        `🗑️ Deleted messages will now be sent to this archive.`
      )
    }

    /* ========================================================
     * INVALID
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
   * DELETE HANDLER
   * ========================================================== */

  async onDelete({
    sock,
    key,
    messageStore
  }) {

    console.log(
      `[ANTI-DELETE] Processing delete: ${key?.id || 'unknown'}`
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
     * FIND ORIGINAL
     * ======================================================== */

    const messageId =
      key?.id

    if (!messageId) {

      console.warn(
        '[ANTI-DELETE] Delete event has no message ID.'
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

      console.warn(
        `[ANTI-DELETE] Original message NOT FOUND: ${messageId}`
      )

      console.warn(
        `[ANTI-DELETE] messageStore size: ${messageStore.size}`
      )

      return
    }

    console.log(
      `[ANTI-DELETE] Original message FOUND: ${messageId}`
    )

    /* ========================================================
     * DON'T ARCHIVE BOT'S OWN MESSAGE
     * ======================================================== */

    if (
      original.key?.fromMe
    ) {

      console.log(
        '[ANTI-DELETE] Ignoring bot-owned deleted message.'
      )

      return
    }

    /* ========================================================
     * ARCHIVE
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

    if (
      !(await testArchive(
        sock,
        archive
      ))
    ) {
      return
    }

    /* ========================================================
     * CHAT
     * ======================================================== */

    const chat =
      original.key?.remoteJid ||
      key?.remoteJid ||
      ''

    const author =
      getAuthor(
        original,
        key
      )

    const deleter =
      key?.participant ||
      key?.remoteJid ||
      chat

    /* ========================================================
     * TYPE
     * ======================================================== */

    const type =
      getContentType(
        original.message
      )

    console.log(
      `[ANTI-DELETE] Message type: ${type}`
    )

    /* ========================================================
     * TIME
     * ======================================================== */

    const time =
      new Date().toLocaleString(
        'en-NG',
        {
          timeZone:
            'Africa/Lagos'
        }
      )

    /* ========================================================
     * CHAT NAME
     * ======================================================== */

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

      console.warn(
        `[ANTI-DELETE] Could not get group name: ${e.message}`
      )
    }

    /* ========================================================
     * BODY
     * ======================================================== */

    const body =
      getMessageText(
        original.message
      )

    /* ========================================================
     * HEADER
     * ======================================================== */

    const header =
      `🗑️ *DELETED MESSAGE*\n\n` +

      `👤 *Sender:* ${
        author
          ? `@${author.split('@')[0]}`
          : 'Unknown'
      }\n` +

      `🙈 *Deleted by:* ${
        deleter
          ? `@${deleter.split('@')[0]}`
          : 'Unknown'
      }\n` +

      `💬 *Chat:* ${chatName}\n` +

      `🕐 *Time:* ${time}\n` +

      `📦 *Type:* ${type || 'unknown'}`

    const mentions =
      [
        author,
        deleter
      ].filter(
        Boolean
      )

    /* ========================================================
     * SEND
     * ======================================================== */

    try {

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

                `Reason: ${e.message}`,
              mentions
            }
          )

          console.log(
            '[ANTI-DELETE] Media failure notice sent.'
          )

          return
        }

        /* ====================================================
         * ARCHIVE INFORMATION
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

        console.log(
          `[ANTI-DELETE] Archive information sent to ${archive}`
        )

        /* ====================================================
         * ACTUAL MEDIA
         * ==================================================== */

        let mediaPayload

        if (
          type === 'imageMessage'
        ) {

          mediaPayload = {
            image: buffer,
            caption:
              body || undefined
          }

        }

        else if (
          type === 'videoMessage'
        ) {

          mediaPayload = {
            video: buffer,
            caption:
              body || undefined
          }

        }

        else if (
          type === 'audioMessage'
        ) {

          mediaPayload = {
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

        if (
          mediaPayload
        ) {

          await sock.sendMessage(
            archive,
            mediaPayload
          )

          console.log(
            `[ANTI-DELETE] Deleted ${type} successfully sent to ${archive}`
          )
        }

        return
      }

      /* ======================================================
       * TEXT
       * ====================================================== */

      if (
        body
      ) {

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
          `[ANTI-DELETE] Deleted text successfully sent to ${archive}`
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
            `⚠️ This message type could not be converted to text.`,

          mentions
        }
      )

      console.log(
        `[ANTI-DELETE] Unsupported message notice sent to ${archive}`
      )

    } catch (e) {

      console.error(
        `[ANTI-DELETE] SEND FAILED: ${e.message}`
      )

      console.error(
        e
      )
    }
  }
}
```
