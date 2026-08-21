import {
  getContentType,
  downloadMediaMessage
} from 'baileys'

import {
  getVar,
  setVar
} from '../../src/lib/vars.js'

import config from '../../src/config.js'


function getArchiveJid() {
  const configured = String(
    getVar('ANTI_DELETE_ARCHIVE') || ''
  ).trim()

  if (configured) {
    if (configured.includes('@')) {
      return configured
    }

    const number = configured.replace(/\D/g, '')

    if (number) {
      return number + '@s.whatsapp.net'
    }
  }

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

  return number + '@s.whatsapp.net'
}


function isAntiDeleteEnabled() {
  const value = getVar('ANTI_DELETE')

  return (
    value === true ||
    String(value).toLowerCase() === 'true' ||
    String(value).toLowerCase() === 'on' ||
    String(value) === '1'
  )
}


function getText(message) {
  if (!message) {
    return ''
  }

  if (message.conversation) {
    return message.conversation
  }

  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text
  }

  if (message.imageMessage?.caption) {
    return message.imageMessage.caption
  }

  if (message.videoMessage?.caption) {
    return message.videoMessage.caption
  }

  if (message.documentMessage?.caption) {
    return message.documentMessage.caption
  }

  return ''
}


async function getChatName(sock, jid) {
  if (!jid) {
    return 'Unknown'
  }

  if (jid.endsWith('@g.us')) {
    try {
      const metadata = await sock.groupMetadata(jid)

      return metadata?.subject || jid
    } catch {
      return jid
    }
  }

  return jid
}


async function sendMedia(
  sock,
  archive,
  original,
  type,
  caption
) {
  console.log(
    '[ANTI-DELETE] Downloading media: ' + type
  )

  const buffer = await downloadMediaMessage(
    original,
    'buffer',
    {},
    {
      reuploadRequest: async function (message) {
        return await sock.updateMediaMessage(message)
      }
    }
  )

  if (!buffer) {
    throw new Error('Media buffer is empty')
  }

  let payload = null

  if (type === 'imageMessage') {
    payload = {
      image: buffer
    }

    if (caption) {
      payload.caption = caption
    }
  }

  else if (type === 'videoMessage') {
    payload = {
      video: buffer
    }

    if (caption) {
      payload.caption = caption
    }
  }

  else if (type === 'audioMessage') {
    payload = {
      audio: buffer,
      mimetype:
        original.message?.audioMessage?.mimetype ||
        'audio/mpeg',
      ptt:
        original.message?.audioMessage?.ptt || false
    }
  }

  else if (type === 'stickerMessage') {
    payload = {
      sticker: buffer
    }
  }

  else if (type === 'documentMessage') {
    payload = {
      document: buffer,
      mimetype:
        original.message?.documentMessage?.mimetype ||
        'application/octet-stream',
      fileName:
        original.message?.documentMessage?.fileName ||
        'deleted-file'
    }
  }

  else {
    throw new Error(
      'Unsupported media type: ' + type
    )
  }

  console.log(
    '[ANTI-DELETE] Sending media to: ' + archive
  )

  await sock.sendMessage(
    archive,
    payload
  )

  console.log(
    '[ANTI-DELETE] Media sent successfully'
  )
}


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


  async run({ m, args }) {
    const sub = String(
      args?.[0] || ''
    ).toLowerCase()


    if (!sub) {
      const archive = getArchiveJid()

      const status =
        isAntiDeleteEnabled()
          ? 'ON'
          : 'OFF'

      return m.reply(
        '🗑️ *ANTI-DELETE*\n\n' +
        'Status: *' + status + '*\n' +
        'Archive: *' +
        (archive || 'Not configured') +
        '*\n\n' +
        'Use:\n' +
        '• *.antidelete on*\n' +
        '• *.antidelete off*\n' +
        '• *.antidelete archive 234xxxxxxxxxx*\n' +
        '• *.antidelete archive 120363xxxxxxxxxx@g.us*'
      )
    }


    if (
      sub === 'on'
    ) {
      await setVar(
        'ANTI_DELETE',
        'true'
      )

      const archive = getArchiveJid()

      return m.reply(
        '✅ *Anti-delete turned ON!*\n\n' +
        '📥 Archive:\n' +
        '*' +
        (archive || 'Not configured') +
        '*\n\n' +
        '🗑️ Deleted messages will be sent there.'
      )
    }


    if (
      sub === 'off'
    ) {
      await setVar(
        'ANTI_DELETE',
        'false'
      )

      return m.reply(
        '❌ *Anti-delete turned OFF.*'
      )
    }


    if (
      sub === 'archive'
    ) {
      const raw = String(
        args?.slice(1).join(' ') || ''
      ).trim()

      if (!raw) {
        return m.reply(
          '❌ *Invalid archive destination.*\n\n' +
          'Example:\n' +
          '*.antidelete archive 2348012345678*\n\n' +
          'Or group:\n' +
          '*.antidelete archive 120363429429530466@g.us*'
        )
      }


      let destination = raw


      if (
        destination.endsWith('@g.us')
      ) {
        await setVar(
          'ANTI_DELETE_ARCHIVE',
          destination
        )

        return m.reply(
          '✅ *Anti-delete archive set!*\n\n' +
          '📥 Destination: *Archive Group*\n' +
          '🆔 ' + destination + '\n\n' +
          '🗑️ Deleted messages will now be sent to this group.'
        )
      }


      const number =
        destination.replace(
          /\D/g,
          ''
        )

      if (!number) {
        return m.reply(
          '❌ *Invalid archive destination.*\n\n' +
          'Example:\n' +
          '*.antidelete archive 2348012345678*\n\n' +
          'Or group:\n' +
          '*.antidelete archive 120363429429530466@g.us*'
        )
      }


      destination =
        number + '@s.whatsapp.net'


      await setVar(
        'ANTI_DELETE_ARCHIVE',
        destination
      )


      return m.reply(
        '✅ *Anti-delete archive set!*\n\n' +
        '📥 Destination: *' +
        destination +
        '*\n\n' +
        '🗑️ Deleted messages will now be sent there.'
      )
    }


    return m.reply(
      '❌ *Invalid option.*\n\n' +
      'Use:\n' +
      '• *.antidelete on*\n' +
      '• *.antidelete off*\n' +
      '• *.antidelete archive 234xxxxxxxxxx*\n' +
      '• *.antidelete archive 120363xxxxxxxxxx@g.us*'
    )
  },


  async onDelete({
    sock,
    key,
    messageStore
  }) {

    console.log(
      '[ANTI-DELETE] onDelete triggered: ' +
      (key?.id || 'unknown')
    )


    if (!isAntiDeleteEnabled()) {
      console.log(
        '[ANTI-DELETE] Feature is OFF'
      )
      return
    }


    const messageId = key?.id

    if (!messageId) {
      console.log(
        '[ANTI-DELETE] Delete event has no message ID'
      )
      return
    }


    const original =
      messageStore.get(messageId)


    if (!original?.message) {
      console.log(
        '[ANTI-DELETE] Original message NOT FOUND: ' +
        messageId
      )

      console.log(
        '[ANTI-DELETE] Store size: ' +
        messageStore.size
      )

      return
    }


    console.log(
      '[ANTI-DELETE] Original message FOUND: ' +
      messageId
    )


    if (
      original.key?.fromMe
    ) {
      console.log(
        '[ANTI-DELETE] Ignoring bot own message'
      )
      return
    }


    const archive =
      getArchiveJid()


    if (!archive) {
      console.error(
        '[ANTI-DELETE] No archive destination configured'
      )
      return
    }


    console.log(
      '[ANTI-DELETE] Archive destination: ' +
      archive
    )


    const chat =
      original.key?.remoteJid ||
      key?.remoteJid ||
      'unknown'


    const type =
      getContentType(
        original.message
      )


    const body =
      getText(
        original.message
      )


    console.log(
      '[ANTI-DELETE] Type: ' +
      type
    )

    console.log(
      '[ANTI-DELETE] Text: ' +
      (body || '[no text]')
    )


    const chatName =
      await getChatName(
        sock,
        chat
      )


    const sender =
      original.key?.participant ||
      original.key?.remoteJid ||
      chat


    const deleter =
      key?.participant ||
      chat


    const time =
      new Date().toLocaleTimeString(
        'en-GB',
        {
          hour12: false
        }
      )


    const header =
      '🗑️ *DELETED MESSAGE ARCHIVE*\n\n' +
      '👤 *Sender:* @' +
      String(sender).split('@')[0] +
      '\n' +
      '🙈 *Deleted by:* @' +
      String(deleter).split('@')[0] +
      '\n' +
      '💬 *Chat:* ' +
      chatName +
      '\n' +
      '🕐 *Time:* ' +
      time +
      '\n' +
      '📦 *Type:* ' +
      type


    const mentions = []


    if (
      sender &&
      sender.includes('@')
    ) {
      mentions.push(sender)
    }


    if (
      deleter &&
      deleter.includes('@') &&
      !mentions.includes(deleter)
    ) {
      mentions.push(deleter)
    }


    try {

      /*
       * SEND HEADER
       */

      console.log(
        '[ANTI-DELETE] Sending archive header...'
      )


      await sock.sendMessage(
        archive,
        {
          text:
            header +
            (
              body
                ? '\n\n💬 *Message:*\n' + body
                : ''
            ),
          mentions
        }
      )


      console.log(
        '[ANTI-DELETE] Archive header SENT'
      )


      /*
       * MEDIA
       */

      const mediaTypes = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'stickerMessage',
        'documentMessage'
      ]


      if (
        mediaTypes.includes(type)
      ) {

        await sendMedia(
          sock,
          archive,
          original,
          type,
          body
        )

        console.log(
          '[ANTI-DELETE] DELETE RECOVERY COMPLETE'
        )

        return
      }


      /*
       * TEXT
       */

      if (body) {

        console.log(
          '[ANTI-DELETE] Text already included in archive header'
        )

      } else {

        await sock.sendMessage(
          archive,
          {
            text:
              '⚠️ Deleted message recovered.\n' +
              'Type: ' +
              type
          }
        )
      }


      console.log(
        '[ANTI-DELETE] DELETE RECOVERY COMPLETE'
      )

    } catch (error) {

      console.error(
        '[ANTI-DELETE] SEND ERROR: ' +
        (error?.message || error)
      )

      console.error(
        error?.stack || ''
      )


      /*
       * Try to send the error to the archive.
       */

      try {
        await sock.sendMessage(
          archive,
          {
            text:
              '⚠️ *ANTI-DELETE ERROR*\n\n' +
              'Message ID: ' +
              messageId +
              '\n' +
              'Type: ' +
              type +
              '\n\n' +
              'Error: ' +
              (error?.message || error)
          }
        )
      } catch (secondError) {
        console.error(
          '[ANTI-DELETE] Could not send error report: ' +
          (secondError?.message || secondError)
        )
      }
    }
  }
}
