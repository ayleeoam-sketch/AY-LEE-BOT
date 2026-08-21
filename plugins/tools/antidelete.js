```javascript
import { getVar, setVar } from '../../src/lib/vars.js'
import DB from '../../src/lib/database.js'

/* ============================================================
 * HELPERS
 * ============================================================ */

function normalizeArchive(value) {
  if (!value) return ''

  let v = String(value).trim()

  // WhatsApp group JID
  if (v.endsWith('@g.us')) {
    return v
  }

  // WhatsApp private JID
  if (v.endsWith('@s.whatsapp.net')) {
    return v
  }

  // Plain phone number
  v = v.replace(/\D/g, '')

  if (v.length >= 7) {
    return `${v}@s.whatsapp.net`
  }

  return ''
}

function isGroup(jid) {
  return String(jid || '').endsWith('@g.us')
}

function getMessageText(message) {
  if (!message) return ''

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

  if (message.buttonsResponseMessage?.selectedDisplayText) {
    return message.buttonsResponseMessage.selectedDisplayText
  }

  if (message.listResponseMessage?.title) {
    return message.listResponseMessage.title
  }

  if (message.templateButtonReplyMessage?.selectedDisplayText) {
    return message.templateButtonReplyMessage.selectedDisplayText
  }

  return ''
}

function unwrapMessage(message) {
  if (!message) return null

  let current = message

  while (
    current?.ephemeralMessage ||
    current?.viewOnceMessage ||
    current?.viewOnceMessageV2 ||
    current?.viewOnceMessageV2Extension
  ) {
    current =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current
  }

  return current
}

function getMessageType(message) {
  const m = unwrapMessage(message)

  if (!m) return 'unknown'

  if (m.conversation) return 'text'
  if (m.extendedTextMessage) return 'text'
  if (m.imageMessage) return 'image'
  if (m.videoMessage) return 'video'
  if (m.audioMessage) return 'audio'
  if (m.documentMessage) return 'document'
  if (m.stickerMessage) return 'sticker'
  if (m.contactMessage) return 'contact'
  if (m.contactsArrayMessage) return 'contacts'
  if (m.locationMessage) return 'location'
  if (m.liveLocationMessage) return 'live_location'
  if (m.pollCreationMessage) return 'poll'

  return 'unknown'
}

function getSenderName(message) {
  return (
    message?.pushName ||
    message?.verifiedBizName ||
    'Unknown'
  )
}

/* ============================================================
 * ARCHIVE DESTINATION
 * ============================================================ */

function getArchiveDestination() {
  const configured =
    getVar('ANTI_DELETE_ARCHIVE')

  if (configured) {
    const normalized =
      normalizeArchive(configured)

    if (normalized) {
      return normalized
    }
  }

  const owner =
    getVar('OWNER_NUMBER') ||
    ''

  if (owner) {
    const normalized =
      normalizeArchive(owner)

    if (normalized) {
      return normalized
    }
  }

  return ''
}

/* ============================================================
 * ANTI DELETE STATE
 * ============================================================ */

function isAntiDeleteEnabled() {
  return Boolean(
    getVar('ANTI_DELETE')
  )
}

/* ============================================================
 * SAVE ARCHIVE MESSAGE
 * ============================================================ */

async function saveArchiveRecord({
  key,
  message,
  destination
}) {
  try {
    if (
      !DB?.antidelete ||
      typeof DB.antidelete.set !== 'function'
    ) {
      return
    }

    await DB.antidelete.set(
      {
        id: key?.id
      },
      {
        id: key?.id,
        jid: key?.remoteJid || '',
        sender: key?.participant || key?.remoteJid || '',
        destination,
        type: getMessageType(message),
        text: getMessageText(message),
        at: Date.now()
      }
    )
  } catch (e) {
    console.error(
      `[ANTI-DELETE] DB save failed: ${e?.message || e}`
    )
  }
}

/* ============================================================
 * SEND DELETED MESSAGE
 * ============================================================ */

async function forwardDeletedMessage({
  sock,
  key,
  stored
}) {
  if (!sock) {
    throw new Error('WhatsApp socket is missing')
  }

  if (!stored?.message) {
    throw new Error('Stored message has no message payload')
  }

  const destination =
    getArchiveDestination()

  if (!destination) {
    throw new Error(
      'No archive destination configured'
    )
  }

  const original =
    unwrapMessage(stored.message)

  if (!original) {
    throw new Error(
      'Could not unwrap original message'
    )
  }

  const sender =
    key?.participant ||
    stored?.key?.participant ||
    stored?.key?.remoteJid ||
    'Unknown'

  const senderName =
    getSenderName(stored)

  const originalChat =
    stored?.key?.remoteJid ||
    key?.remoteJid ||
    'Unknown'

  const type =
    getMessageType(stored.message)

  const text =
    getMessageText(stored.message)

  /* ==========================================================
   * HEADER
   * ========================================================== */

  const header =
    `🗑️ *DELETED MESSAGE*\n\n` +
    `👤 *From:* ${senderName}\n` +
    `🆔 *Sender:* ${sender}\n` +
    `💬 *Chat:* ${originalChat}\n` +
    `📦 *Type:* ${type}\n`

  /* ==========================================================
   * TEXT
   * ========================================================== */

  if (type === 'text') {
    await sock.sendMessage(
      destination,
      {
        text:
          `${header}\n` +
          `📝 *Message:*\n${text || '(empty)'}`
      }
    )

    return
  }

  /* ==========================================================
   * IMAGE
   * ========================================================== */

  if (original.imageMessage) {
    const caption =
      `${header}\n` +
      `📝 *Caption:* ${original.imageMessage.caption || '(none)'}`

    await sock.sendMessage(
      destination,
      {
        image: {
          url:
            original.imageMessage.url
        },
        caption
      }
    )

    return
  }

  /* ==========================================================
   * VIDEO
   * ========================================================== */

  if (original.videoMessage) {
    const caption =
      `${header}\n` +
      `📝 *Caption:* ${original.videoMessage.caption || '(none)'}`

    await sock.sendMessage(
      destination,
      {
        video: {
          url:
            original.videoMessage.url
        },
        caption
      }
    )

    return
  }

  /* ==========================================================
   * AUDIO
   * ========================================================== */

  if (original.audioMessage) {
    await sock.sendMessage(
      destination,
      {
        audio: {
          url:
            original.audioMessage.url
        },
        mimetype:
          original.audioMessage.mimetype ||
          'audio/mp4',
        ptt:
          Boolean(
            original.audioMessage.ptt
          )
      }
    )

    await sock.sendMessage(
      destination,
      {
        text: header
      }
    )

    return
  }

  /* ==========================================================
   * DOCUMENT
   * ========================================================== */

  if (original.documentMessage) {
    await sock.sendMessage(
      destination,
      {
        document: {
          url:
            original.documentMessage.url
        },
        mimetype:
          original.documentMessage.mimetype ||
          'application/octet-stream',
        fileName:
          original.documentMessage.fileName ||
          'deleted-document',
        caption: header
      }
    )

    return
  }

  /* ==========================================================
   * STICKER
   * ========================================================== */

  if (original.stickerMessage) {
    await sock.sendMessage(
      destination,
      {
        sticker: {
          url:
            original.stickerMessage.url
        }
      }
    )

    await sock.sendMessage(
      destination,
      {
        text: header
      }
    )

    return
  }

  /* ==========================================================
   * CONTACT
   * ========================================================== */

  if (original.contactMessage) {
    await sock.sendMessage(
      destination,
      {
        contacts: {
          displayName:
            original.contactMessage.displayName ||
            'Deleted Contact',
          contacts: [
            original.contactMessage.vcard
          ]
        }
      }
    )

    await sock.sendMessage(
      destination,
      {
        text: header
      }
    )

    return
  }

  /* ==========================================================
   * LOCATION
   * ========================================================== */

  if (original.locationMessage) {
    await sock.sendMessage(
      destination,
      {
        location: {
          degreesLatitude:
            original.locationMessage.degreesLatitude,
          degreesLongitude:
            original.locationMessage.degreesLongitude,
          name:
            original.locationMessage.name ||
            'Deleted Location',
          address:
            original.locationMessage.address ||
            ''
        }
      }
    )

    await sock.sendMessage(
      destination,
      {
        text: header
      }
    )

    return
  }

  /* ==========================================================
   * FALLBACK
   * ========================================================== */

  await sock.sendMessage(
    destination,
    {
      text:
        `${header}\n` +
        `📝 *Message:*\n` +
        `${text || '(unsupported message type)' }`
    }
  )
}

/* ============================================================
 * COMMAND + MIDDLEWARE
 * ============================================================ */

const plugin = {
  name: 'antidelete',

  alias: [
    'ad',
    'antidel'
  ],

  category: 'TOOLS',

  desc:
    'Recover deleted WhatsApp messages.',

  usage:
    '.antidelete on | off | archive <number/group-jid>',

  owner: true,

  /* ==========================================================
   * COMMAND
   * ========================================================== */

  async run({
    sock,
    m,
    args
  }) {
    const action =
      String(
        args?.[0] || ''
      ).toLowerCase()

    /* ========================================================
     * STATUS
     * ======================================================== */

    if (!action) {
      const enabled =
        isAntiDeleteEnabled()

      const archive =
        getArchiveDestination()

      await sock.sendMessage(
        m.key.remoteJid,
        {
          text:
            `🛡️ *ANTI-DELETE*\n\n` +
            `Status: ${
              enabled
                ? '✅ ON'
                : '❌ OFF'
            }\n` +
            `Archive: ${
              archive ||
              'Not configured'
            }\n\n` +
            `Use:\n` +
            `• *.antidelete on*\n` +
            `• *.antidelete off*\n` +
            `• *.antidelete archive 234xxxxxxxxxx*\n` +
            `• *.antidelete archive 120363xxxxxxxxxx@g.us*`
        }
      )

      return
    }

    /* ========================================================
     * ON
     * ======================================================== */

    if (action === 'on') {
      await setVar(
        'ANTI_DELETE',
        true
      )

      const archive =
        getArchiveDestination()

      await sock.sendMessage(
        m.key.remoteJid,
        {
          text:
            `✅ *Anti-delete enabled!*\n\n` +
            `📥 Destination: *${
              archive ||
              'Not configured'
            }*`
        }
      )

      return
    }

    /* ========================================================
     * OFF
     * ======================================================== */

    if (action === 'off') {
      await setVar(
        'ANTI_DELETE',
        false
      )

      await sock.sendMessage(
        m.key.remoteJid,
        {
          text:
            '❌ *Anti-delete disabled.*'
        }
      )

      return
    }

    /* ========================================================
     * ARCHIVE
     * ======================================================== */

    if (action === 'archive') {
      const raw =
        args
          ?.slice(1)
          ?.join(' ')
          ?.trim()

      const destination =
        normalizeArchive(raw)

      if (!destination) {
        await sock.sendMessage(
          m.key.remoteJid,
          {
            text:
              `❌ *Invalid archive destination.*\n\n` +
              `Example:\n` +
              `*.antidelete archive 2348012345678*\n\n` +
              `Or:\n` +
              `*.antidelete archive 120363429429530466@g.us*`
          }
        )

        return
      }

      await setVar(
        'ANTI_DELETE_ARCHIVE',
        destination
      )

      await setVar(
        'ANTI_DELETE',
        true
      )

      await sock.sendMessage(
        m.key.remoteJid,
        {
          text:
            `✅ *Anti-delete archive set!*\n\n` +
            `📥 Destination: *Archive Group*\n` +
            `🆔 ${destination}\n\n` +
            `🗑️ Deleted messages will now be sent to this destination.`
        }
      )

      return
    }

    /* ========================================================
     * UNKNOWN ACTION
     * ======================================================== */

    await sock.sendMessage(
      m.key.remoteJid,
      {
        text:
          `❌ Unknown option.\n\n` +
          `Use:\n` +
          `• *.antidelete on*\n` +
          `• *.antidelete off*\n` +
          `• *.antidelete archive 234xxxxxxxxxx*\n` +
          `• *.antidelete archive 120363xxxxxxxxxx@g.us*`
      }
    )
  },

  /* ==========================================================
   * BEFORE
   *
   * This exists because your plugin loader treats plugins
   * with "before" as message middlewares.
   *
   * It intentionally does nothing.
   * ========================================================== */

  async before() {
    return false
  },

  /* ==========================================================
   * DELETE EVENT
   *
   * THIS is what the connection.js calls.
   * ========================================================== */

  async onDelete({
    sock,
    key,
    messageStore
  }) {
    if (!isAntiDeleteEnabled()) {
      return
    }

    if (!key?.id) {
      return
    }

    const stored =
      messageStore.get(
        key.id
      )

    if (!stored?.message) {
      console.warn(
        `[ANTI-DELETE] Cannot recover message ${key.id}`
      )

      return
    }

    console.log(
      `[ANTI-DELETE] Forwarding deleted message ${key.id}`
    )

    try {
      await forwardDeletedMessage({
        sock,
        key,
        stored
      })

      await saveArchiveRecord({
        key,
        message: stored.message,
        destination:
          getArchiveDestination()
      })

      console.log(
        `[ANTI-DELETE] Deleted message forwarded successfully: ${key.id}`
      )
    } catch (e) {
      console.error(
        `[ANTI-DELETE] Forward failed: ${
          e?.stack ||
          e?.message ||
          e
        }`
      )
    }
  }
}

export default plugin
```
