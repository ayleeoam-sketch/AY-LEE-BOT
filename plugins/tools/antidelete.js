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
 * GET ARCHIVE JID
 * ============================================================ */

function getArchiveJid() {
  const configured = String(
    getVar('ANTI_DELETE_ARCHIVE') || ''
  ).trim()

  if (configured) {
    // WhatsApp group
    if (configured.endsWith('@g.us')) {
      return configured
    }

    // WhatsApp user
    if (configured.endsWith('@s.whatsapp.net')) {
      return configured
    }

    // Plain number
    const number = configured.replace(/\D/g, '')

    if (number) {
      return `${number}@s.whatsapp.net`
    }
  }

  // Fallback to owner
  const owner = config.ownerNumbers?.[0]

  if (!owner) {
    return null
  }

  if (String(owner).includes('@')) {
    return String(owner)
  }

  const number = String(owner).replace(/\D/g, '')

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

  desc: 'Recover deleted messages',

  usage: '.antidelete on | off | archive',

  owner: true,


  /* ==========================================================
   * COMMAND
   * ========================================================== */

  async run({ m, args }) {
    const sub = String(
      args?.[0] || ''
    ).toLowerCase()


    /* ========================================================
     * STATUS
     * ======================================================== */

    if (!sub) {
      const archive = getArchiveJid()

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
        `• *.antidelete archive 120xxxxxxxx@g.us*`
      )
    }


    /* ========================================================
     * ON
     * ======================================================== */

    if (sub === 'on') {
      await setVar(
        'ANTI_DELETE',
        'true'
      )

      return m.reply(
        `✅ *Anti-delete turned ON!*\n\n` +
        `📥 Archive:\n` +
        `${getArchiveJid() || 'Not configured'}`
      )
    }


    /* ========================================================
     * OFF
     * ======================================================== */

    if (sub === 'off') {
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

    if (sub === 'archive') {
      const input = String(
        args?.[1] || ''
      ).trim()

      if (!input) {
        return m.reply(
          `❌ *Enter an archive destination.*\n\n` +
          `Group example:\n` +
          `*.antidelete archive 120363429429530466@g.us*\n\n` +
          `Number example:\n` +
          `*.antidelete archive 2348012345678*`
        )
      }

      let archive = input

      // Group JID
      if (archive.endsWith('@g.us')) {
        // keep it exactly as supplied
      }

      // User JID
      else if (
        archive.endsWith('@s.whatsapp.net')
      ) {
        // keep it exactly as supplied
      }

      // Number
      else {
        const number =
          archive.replace(/\D/g, '')

        if (!number) {
          return m.reply(
            `❌ *Invalid archive destination.*`
          )
        }

        archive =
          `${number}@s.whatsapp.net`
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


    return m.reply(
      `❌ *Invalid option.*\n\n` +
      `Use:\n` +
      `*.antidelete on*\n` +
      `*.antidelete off*\n` +
      `*.antidelete archive 120xxxxxxxx@g.us*`
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
      `[ANTI-DELETE] onDelete() START: ${key?.id}`
    )


    /* ========================================================
     * CHECK ENABLED
     * ======================================================== */

    const enabled =
      getVar('ANTI_DELETE')

    console.log(
      `[ANTI-DELETE] Enabled: ${enabled}`
    )

    if (!enabled) {
      console.log(
        '[ANTI-DELETE] STOPPED: feature is OFF'
      )

      return
    }


    /* ========================================================
     * MESSAGE ID
     * ======================================================== */

    const id = key?.id

    if (!id) {
      console.log(
        '[ANTI-DELETE] STOPPED: no message ID'
      )

      return
    }


    /* ========================================================
     * FIND ORIGINAL
     * ======================================================== */

    const original =
      messageStore.get(id)

    if (!original?.message) {
      console.log(
        `[ANTI-DELETE] STOPPED: original NOT FOUND: ${id}`
      )

      return
    }

    console.log(
      `[ANTI-DELETE] Original message FOUND: ${id}`
    )


    /* ========================================================
     * DON'T ARCHIVE BOT'S OWN MESSAGE
     * ======================================================== */

    if (original.key?.fromMe) {
      console.log(
        '[ANTI-DELETE] STOPPED: message was sent by bot'
      )

      return
    }


    /* ========================================================
     * ARCHIVE DESTINATION
     * ======================================================== */

    const archive =
      getArchiveJid()

    console.log(
      `[ANTI-DELETE] Archive destination: ${archive}`
    )

    if (!archive) {
      console.log(
        '[ANTI-DELETE] STOPPED: archive destination is empty'
      )

      return
    }


    /* ========================================================
     * GET MESSAGE TYPE
     * ======================================================== */

    const type =
      getContentType(
        original.message
      )

    console.log(
      `[ANTI-DELETE] Message type: ${type}`
    )


    /* ========================================================
     * GET TEXT
     * ======================================================== */

    let text = ''

    if (
      original.message.conversation
    ) {
      text =
        original.message.conversation
    }

    else if (
      original.message.extendedTextMessage?.text
    ) {
      text =
        original.message
          .extendedTextMessage
          .text
    }

    else if (
      original.message[type]?.caption
    ) {
      text =
        original.message[type]
          .caption
    }


    console.log(
      `[ANTI-DELETE] Text recovered: ${text ? 'YES' : 'NO'}`
    )


    /* ========================================================
     * SOURCE CHAT
     * ======================================================== */

    const sourceChat =
      original.key?.remoteJid ||
      key?.remoteJid ||
      'Unknown'


    /* ========================================================
     * SENDER
     * ======================================================== */

    const sender =
      original.key?.participant ||
      original.key?.remoteJid ||
      'Unknown'


    /* ========================================================
     * TIME
     * ======================================================== */

    const time =
      new Date().toLocaleString(
        'en-NG',
        {
          timeZone: 'Africa/Lagos'
        }
      )


    /* ========================================================
     * HEADER
     * ======================================================== */

    const archiveText =
      `🗑️ *DELETED MESSAGE ARCHIVE*\n\n` +
      `👤 *Sender:* ${sender}\n` +
      `💬 *Chat:* ${sourceChat}\n` +
      `🕐 *Time:* ${time}\n` +
      `📦 *Type:* ${type || 'unknown'}\n\n` +
      `💬 *Message:*\n` +
      `${text || '(No text content)'}`


    /* ========================================================
     * SEND ARCHIVE HEADER
     * ======================================================== */

    console.log(
      `[ANTI-DELETE] ATTEMPTING SEND TO: ${archive}`
    )

    try {

      const result =
        await sock.sendMessage(
          archive,
          {
            text: archiveText
          }
        )

      console.log(
        `[ANTI-DELETE] SEND SUCCESS: ${JSON.stringify(result?.key || {})}`
      )

    } catch (error) {

      console.error(
        `[ANTI-DELETE] SEND FAILED: ${error?.stack || error?.message || error}`
      )

      return
    }


    /* ========================================================
     * MEDIA
     * ======================================================== */

    const mediaTypes = [
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'stickerMessage',
      'documentMessage'
    ]

    if (
      !mediaTypes.includes(type)
    ) {
      console.log(
        '[ANTI-DELETE] Text message complete.'
      )

      return
    }


    /* ========================================================
     * DOWNLOAD MEDIA
     * ======================================================== */

    console.log(
      '[ANTI-DELETE] Attempting media download...'
    )

    try {

      const buffer =
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


      if (!buffer) {
        throw new Error(
          'Media buffer is empty'
        )
      }


      /* ======================================================
       * IMAGE
       * ====================================================== */

      if (
        type === 'imageMessage'
      ) {
        await sock.sendMessage(
          archive,
          {
            image: buffer,
            caption:
              text ||
              '🗑️ Deleted image'
          }
        )
      }


      /* ======================================================
       * VIDEO
       * ====================================================== */

      else if (
        type === 'videoMessage'
      ) {
        await sock.sendMessage(
          archive,
          {
            video: buffer,
            caption:
              text ||
              '🗑️ Deleted video'
          }
        )
      }


      /* ======================================================
       * AUDIO
       * ====================================================== */

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


      /* ======================================================
       * STICKER
       * ====================================================== */

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


      /* ======================================================
       * DOCUMENT
       * ====================================================== */

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
        `[ANTI-DELETE] MEDIA SEND SUCCESS: ${archive}`
      )

    } catch (error) {

      console.error(
        `[ANTI-DELETE] MEDIA SEND FAILED: ${error?.stack || error?.message || error}`
      )
    }
  }
}
