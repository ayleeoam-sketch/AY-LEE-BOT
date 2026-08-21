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
 * ANTI-DELETE
 *
 * Recovers deleted messages and sends them to:
 *
 *   ANTI_DELETE_ARCHIVE
 *
 * Supported archive formats:
 *
 *   .antidelete archive 2348012345678
 *
 *   .antidelete archive 120363429429530466@g.us
 * ============================================================ */


/* ============================================================
 * GET ARCHIVE JID
 * ============================================================ */

function getArchiveJid() {
  const configured =
    String(
      getVar('ANTI_DELETE_ARCHIVE') || ''
    ).trim()

  /*
   * Explicit archive destination
   */
  if (configured) {

    /*
     * Group JID or full WhatsApp JID
     */
    if (configured.includes('@')) {
      return configured
    }

    /*
     * Normal WhatsApp number
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
 * MEDIA TYPES
 * ============================================================ */

const MEDIA_TYPES = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage'
]


/* ============================================================
 * GET MESSAGE TEXT
 * ============================================================ */

function getMessageText(message) {
  if (!message) {
    return ''
  }

  /*
   * Normal text
   */
  if (message.conversation) {
    return message.conversation
  }

  /*
   * Extended text
   */
  if (
    message.extendedTextMessage?.text
  ) {
    return message.extendedTextMessage.text
  }

  /*
   * Caption from media
   */
  const type =
    getContentType(message)

  if (
    type &&
    message[type]?.caption
  ) {
    return message[type].caption
  }

  /*
   * Buttons/list messages
   */
  if (
    message.buttonsResponseMessage?.selectedDisplayText
  ) {
    return message.buttonsResponseMessage.selectedDisplayText
  }

  if (
    message.listResponseMessage?.title
  ) {
    return message.listResponseMessage.title
  }

  return ''
}


/* ============================================================
 * GET PARTICIPANT
 * ============================================================ */

function getParticipant(
  original,
  chat
) {
  return (
    original?.key?.participant ||
    original?.key?.remoteJid ||
    chat
  )
}


/* ============================================================
 * GET CHAT NAME
 * ============================================================ */

async function getChatName(
  sock,
  chat
) {
  if (!chat) {
    return 'Unknown'
  }

  /*
   * Group
   */
  if (chat.endsWith('@g.us')) {
    try {
      const metadata =
        await sock.groupMetadata(chat)

      return (
        metadata?.subject ||
        chat
      )
    } catch (e) {
      return chat
    }
  }

  /*
   * Private chat
   */
  return chat
}


/* ============================================================
 * SEND ARCHIVE HEADER
 * ============================================================ */

async function sendArchiveHeader({
  sock,
  archive,
  original,
  key,
  type,
  body,
  chatName
}) {
  const chat =
    key.remoteJid || 'unknown'

  const author =
    getParticipant(
      original,
      chat
    )

  const deleter =
    key.participant ||
    chat

  const time =
    new Date().toLocaleTimeString(
      'en-GB',
      {
        hour12: false
      }
    )

  const header =
    `🗑️ *DELETED MESSAGE ARCHIVE*\n\n` +
    `👤 *Sender:* @${String(author).split('@')[0]}\n` +
    `🙈 *Deleted by:* @${String(deleter).split('@')[0]}\n` +
    `💬 *Chat:* ${chatName}\n` +
    `🕐 *Time:* ${time}\n` +
    `📦 *Type:* ${type}`

  const text =
    body
      ? `${header}\n\n💬 *Message:*\n${body}`
      : header

  const mentions = []

  if (
    author &&
    author.includes('@')
  ) {
    mentions.push(author)
  }

  if (
    deleter &&
    deleter.includes('@') &&
    !mentions.includes(deleter)
  ) {
    mentions.push(deleter)
  }

  console.log(
    `[ANTI-DELETE] Sending archive header to: ${archive}`
  )

  await sock.sendMessage(
    archive,
    {
      text,
      mentions
    }
  )

  console.log(
    `[ANTI-DELETE] Archive header SENT successfully`
  )
}


/* ============================================================
 * SEND MEDIA
 * ============================================================ */

async function sendMedia({
  sock,
  archive,
  original,
  type,
  body
}) {
  console.log(
    `[ANTI-DELETE] Downloading ${type}...`
  )

  const buffer =
    await downloadMediaMessage(
      original,
      'buffer',
      {},
      {
        reuploadRequest:
          async (msg) => {
            try {
              return await sock.updateMediaMessage(
                msg
              )
            } catch (e) {
              console.error(
                `[ANTI-DELETE] Media reupload failed: ${e.message}`
              )

              throw e
            }
          }
      }
    )

  if (!buffer) {
    throw new Error(
      'Downloaded media buffer is empty'
    )
  }

  console.log(
    `[ANTI-DELETE] Media downloaded successfully`
  )

  let payload

  /* ==========================================================
   * IMAGE
   * ========================================================== */

  if (type === 'imageMessage') {
    payload = {
      image: buffer
    }

    if (body) {
      payload.caption = body
    }
  }

  /* ==========================================================
   * VIDEO
   * ========================================================== */

  else if (type === 'videoMessage') {
    payload = {
      video: buffer
    }

    if (body) {
      payload.caption = body
    }
  }

  /* ==========================================================
   * AUDIO
   * ========================================================== */

  else if (type === 'audioMessage') {
    payload = {
      audio: buffer,

      mimetype:
        original.message
          ?.audioMessage
          ?.mimetype ||
        'audio/mpeg',

      ptt:
        original.message
          ?.audioMessage
          ?.ptt ||
        false
    }
  }

  /* ==========================================================
   * STICKER
   * ========================================================== */

  else if (type === 'stickerMessage') {
    payload = {
      sticker: buffer
    }
  }

  /* ==========================================================
   * DOCUMENT
   * ========================================================== */

  else if (type === 'documentMessage') {
    payload = {
      document: buffer,

      mimetype:
        original.message
          ?.documentMessage
          ?.mimetype ||
        'application/octet-stream',

      fileName:
        original.message
          ?.documentMessage
          ?.fileName ||
        'deleted-file'
    }
  }

  else {
    throw new Error(
      `Unsupported media type: ${type}`
    )
  }

  console.log(
    `[ANTI-DELETE] Sending ${type} to ${archive}...`
  )

  await sock.sendMessage(
    archive,
    payload
  )

  console.log(
    `[ANTI-DELETE] ${type} SENT successfully`
  )
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

      const enabled =
        getVar(
          'ANTI_DELETE'
        ) === true ||
        String(
          getVar(
            'ANTI_DELETE'
          )
        ).toLowerCase() === 'true'

      return m.reply(
        `🗑️ *ANTI-DELETE*\n\n` +

        `Status: *${
          enabled
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

        `• *.antidelete archive 120363xxxxxxxxxx@g.us*`
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
        `✅ *Anti-delete enabled!*\n\n` +

        `📥 Archive:\n` +

        `*${archive || 'Not configured'}*\n\n` +

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
        `❌ *Anti-delete disabled.*`
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
          args
            .slice(1)
            .join(' ') ||
          ''
        ).trim()

      if (!raw) {

        return m.reply(
          `❌ *Invalid archive destination.*\n\n` +

          `Example:\n` +

          `*.antidelete archive 2348012345678*\n\n` +

          `Or:\n` +

          `*.antidelete archive 120363429429530466@g.us*`
        )
      }


      let destination = raw


      /* ======================================================
       * GROUP JID
       * ====================================================== */

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


      /* ======================================================
       * NORMAL NUMBER
       * ====================================================== */

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

          `Or:\n` +

          `*.antidelete archive 120363429429530466@g.us*`
        )
      }


      destination =
        `${number}@s.whatsapp.net`


      await setVar(
        'ANTI_DELETE_ARCHIVE',
        destination
      )


      return m.reply(
        `✅ *Anti-delete archive set!*\n\n` +

        `📥 Destination: *${destination}*\n\n` +

        `🗑️ Deleted messages will now be sent there.`
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

      `*.antidelete archive 234xxxxxxxxxx*\n` +

      `*.antidelete archive 120363xxxxxxxxxx@g.us*`
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
      `[ANTI-DELETE] onDelete() triggered for: ${key?.id || 'unknown'}`
    )


    /* ========================================================
     * CHECK ENABLED
     * ======================================================== */

    const enabled =
      getVar(
        'ANTI_DELETE'
      ) === true ||
      String(
        getVar(
          'ANTI_DELETE'
        )
      ).toLowerCase() === 'true'

    if (!enabled) {

      console.log(
        `[ANTI-DELETE] Disabled`
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
        `[ANTI-DELETE] No message ID`
      )

      return
    }


    /* ========================================================
     * FIND ORIGINAL
     * ======================================================== */

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
        `[ANTI-DELETE] messageStore size: ${messageStore.size}`
      )

      return
    }


    console.log(
      `[ANTI-DELETE] Original message FOUND: ${messageId}`
    )


    /* ========================================================
     * IGNORE BOT'S OWN MESSAGE
     * ======================================================== */

    if (
      original.key?.fromMe
    ) {

      console.log(
        `[ANTI-DELETE] Ignoring bot's own deleted message`
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
        `[ANTI-DELETE] No archive destination configured`
      )

      return
    }


    console.log(
      `[ANTI-DELETE] Archive destination: ${archive}`
    )


    /* ========================================================
     * BASIC INFORMATION
     * ======================================================== */

    const chat =
      key.remoteJid ||
      original.key?.remoteJid ||
      'unknown'


    const type =
      getContentType(
        original.message
      )


    const body =
      getMessageText(
        original.message
      )


    console.log(
      `[ANTI-DELETE] Message type: ${type}`
    )


    console.log(
      `[ANTI-DELETE] Message text: ${body || '[none]'}`
    )


    /* ========================================================
     * CHAT NAME
     * ======================================================== */

    const chatName =
      await getChatName(
        sock,
        chat
      )


    console.log(
      `[ANTI-DELETE] Chat: ${chatName}`
    )


    /* ========================================================
     * SEND
     * ======================================================== */

    try {

      /*
       * First send information/header.
       */

      await sendArchiveHeader({
        sock,
        archive,
        original,
        key,
        type,
        body,
        chatName
      })


      /*
       * Media
       */

      if (
        MEDIA_TYPES.includes(
          type
        )
      ) {

        await sendMedia({
          sock,
          archive,
          original,
          type,
          body
        })

        console.log(
          `[ANTI-DELETE] COMPLETE: deleted media archived successfully`
        )

        return
      }


      /*
       * Text / other message
       */

      if (
        !body
      ) {

        await sock.sendMessage(
          archive,
          {
            text:
              `🗑️ Deleted message recovered.\n\n` +
              `📦 Type: ${type}\n` +
              `⚠️ No readable text was found.`
          }
        )

        console.log(
          `[ANTI-DELETE] COMPLETE: message information archived`
        )

        return
      }


      console.log(
        `[ANTI-DELETE] COMPLETE: deleted text archived successfully`
      )

    } catch (e) {

      console.error(
        `[ANTI-DELETE] SEND/RECOVERY ERROR: ${e?.message || e}`
      )

      console.error(
        e?.stack || ''
      )


      /*
       * Try to notify archive that recovery failed.
       */

      try {

        await sock.sendMessage(
          archive,
          {
            text:
              `⚠️ *ANTI-DELETE ERROR*\n\n` +
              `A deleted message was detected but could not be fully archived.\n\n` +
              `🆔 Message ID: ${messageId}\n` +
              `📦 Type: ${type}\n` +
              `❌ Error: ${e?.message || e}`
          }
        )

      } catch (notifyError) {

        console.error(
          `[ANTI-DELETE] Could not send error notification: ${notifyError?.message || notifyError}`
        )
      }
    }
  }
}
```
