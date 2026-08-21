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

const getArchiveJid = () => {
  const configured =
    String(
      getVar('ANTI_DELETE_ARCHIVE') || ''
    ).trim()

  if (configured) {
    return configured
  }

  const owner =
    config.ownerNumbers?.[0]

  if (!owner) {
    return null
  }

  if (String(owner).includes('@')) {
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
    'Recover deleted messages to an archive chat.',

  usage:
    '.antidelete on | off | archive',

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

        `• *.antidelete archive*`
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
        `✅ *Anti-delete turned ON.*\n\n` +

        `🗑️ Deleted messages will now be recovered.\n` +

        `📥 Archive: *${
          getArchiveJid() ||
          'Not configured'
        }*`
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
     *
     * IMPORTANT:
     * If .antidelete archive is sent inside a group,
     * automatically use that group as the archive.
     *
     * This avoids manually entering the long @g.us JID.
     * ======================================================== */

    if (sub === 'archive') {

      const currentChat =
        m?.key?.remoteJid ||
        m?.chat ||
        m?.remoteJid


      /*
       * If command is being used inside a group,
       * automatically save that group.
       */

      if (
        currentChat &&
        currentChat.endsWith('@g.us')
      ) {

        await setVar(
          'ANTI_DELETE_ARCHIVE',
          currentChat
        )

        return m.reply(
          `✅ *Anti-delete archive set!*\n\n` +

          `📥 Destination: *This group*\n` +

          `🆔 ${currentChat}\n\n` +

          `🗑️ Deleted messages will now be sent to this group.`
        )
      }


      /*
       * If command is used in DM, allow a manually
       * supplied number/JID.
       */

      const target =
        String(
          args?.[1] || ''
        ).trim()


      if (!target) {

        return m.reply(
          `❌ *No archive group selected.*\n\n` +

          `Open the group you want to use as the archive and send:\n\n` +

          `*.antidelete archive*`
        )
      }


      let jid =
        target


      /*
       * Group JID
       */

      if (
        jid.endsWith('@g.us')
      ) {

        await setVar(
          'ANTI_DELETE_ARCHIVE',
          jid
        )

        return m.reply(
          `✅ *Anti-delete archive set!*\n\n` +

          `📥 Destination: *Group*\n` +

          `🆔 ${jid}\n\n` +

          `🗑️ Deleted messages will now be sent to this group.`
        )
      }


      /*
       * Phone number
       */

      const number =
        jid.replace(
          /\D/g,
          ''
        )


      if (number) {

        jid =
          `${number}@s.whatsapp.net`

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


      return m.reply(
        `❌ *Invalid archive destination.*\n\n` +

        `Open the archive group and simply send:\n` +

        `*.antidelete archive*`
      )
    }


    return m.reply(
      `❌ *Invalid option.*\n\n` +

      `Use:\n` +

      `*.antidelete on*\n` +

      `*.antidelete off*\n` +

      `*.antidelete archive*`
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
      `[ANTI-DELETE] Processing delete: ${key?.id || 'unknown'}`
    )


    /* ========================================================
     * CHECK STATUS
     * ======================================================== */

    if (!getVar('ANTI_DELETE')) {

      console.log(
        '[ANTI-DELETE] Disabled.'
      )

      return
    }


    /* ========================================================
     * FIND ORIGINAL
     * ======================================================== */

    const original =
      messageStore.get(
        key?.id
      )


    if (!original?.message) {

      console.log(
        `[ANTI-DELETE] Original message NOT found: ${key?.id}`
      )

      return
    }


    console.log(
      `[ANTI-DELETE] Original message found: ${key.id}`
    )


    /* ========================================================
     * IGNORE BOT'S OWN MESSAGE
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
     * ARCHIVE
     * ======================================================== */

    const archive =
      getArchiveJid()


    if (!archive) {

      console.error(
        '[ANTI-DELETE] No archive destination.'
      )

      return
    }


    console.log(
      `[ANTI-DELETE] Sending to: ${archive}`
    )


    /* ========================================================
     * ORIGINAL CHAT
     * ======================================================== */

    const chat =
      original.key?.remoteJid ||
      key?.remoteJid ||
      'Unknown'


    /* ========================================================
     * AUTHOR
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

        chatName =
          metadata?.subject ||
          chat

      } catch {}
    }


    /* ========================================================
     * MESSAGE BODY
     * ======================================================== */

    const message =
      original.message


    const body =
      message.conversation ||

      message.extendedTextMessage?.text ||

      message[type]?.caption ||

      ''


    /* ========================================================
     * HEADER
     * ======================================================== */

    const header =
      `🗑️ *DELETED MESSAGE ARCHIVE*\n\n` +

      `👤 *Sender:* @${author.split('@')[0]}\n` +

      `💬 *Chat:* ${chatName}\n` +

      `🕐 *Time:* ${new Date().toLocaleTimeString(
        'en-GB',
        { hour12: false }
      )}\n` +

      `📦 *Type:* ${type}`


    const mentions = [
      author
    ]


    try {

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
                  sock.updateMediaMessage
              }
            )

        } catch (e) {

          console.error(
            `[ANTI-DELETE] Media recovery failed: ${e.message}`
          )

          await sock.sendMessage(
            archive,
            {
              text:
                `${header}\n\n` +

                `⚠️ *Media could not be recovered.*`,

              mentions
            }
          )

          return
        }


        /* ==================================================
         * ARCHIVE INFORMATION
         * ================================================== */

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


        /* ==================================================
         * IMAGE
         * ================================================== */

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

          console.log(
            '[ANTI-DELETE] Image archived.'
          )

          return
        }


        /* ==================================================
         * VIDEO
         * ================================================== */

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

          console.log(
            '[ANTI-DELETE] Video archived.'
          )

          return
        }


        /* ==================================================
         * AUDIO
         * ================================================== */

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

          console.log(
            '[ANTI-DELETE] Audio archived.'
          )

          return
        }


        /* ==================================================
         * STICKER
         * ================================================== */

        if (
          type === 'stickerMessage'
        ) {

          await sock.sendMessage(
            archive,
            {
              sticker: buffer
            }
          )

          console.log(
            '[ANTI-DELETE] Sticker archived.'
          )

          return
        }


        /* ==================================================
         * DOCUMENT
         * ================================================== */

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

          console.log(
            '[ANTI-DELETE] Document archived.'
          )

          return
        }
      }


      /* ======================================================
       * TEXT
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
          '[ANTI-DELETE] Text message archived successfully.'
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
