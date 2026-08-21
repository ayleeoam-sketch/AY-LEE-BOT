import { getVar, setVar } from '../../src/lib/vars.js'

/* ============================================================
 * ANTI-DELETE
 * ============================================================ */

/**
 * Normalize an archive destination.
 *
 * Accepts:
 * - WhatsApp group JID
 * - WhatsApp private JID
 * - Plain phone number
 */
function normalizeDestination(value) {
  if (!value) return ''

  let destination = String(value).trim()

  /* WhatsApp group JID */
  if (destination.endsWith('@g.us')) {
    return destination
  }

  /* WhatsApp private JID */
  if (destination.endsWith('@s.whatsapp.net')) {
    return destination
  }

  /* Phone number */
  destination = destination.replace(/\D/g, '')

  if (destination.length < 7) {
    return ''
  }

  return destination + '@s.whatsapp.net'
}

/* ============================================================
 * UNWRAP WHATSAPP MESSAGE
 * ============================================================ */

function unwrapMessage(message) {
  let current = message

  while (current) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message
      continue
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message
      continue
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message
      continue
    }

    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message
      continue
    }

    break
  }

  return current
}

/* ============================================================
 * GET TEXT
 * ============================================================ */

function getText(message) {
  const m = unwrapMessage(message)

  if (!m) return ''

  if (m.conversation) {
    return m.conversation
  }

  if (m.extendedTextMessage?.text) {
    return m.extendedTextMessage.text
  }

  if (m.imageMessage?.caption) {
    return m.imageMessage.caption
  }

  if (m.videoMessage?.caption) {
    return m.videoMessage.caption
  }

  if (m.documentMessage?.caption) {
    return m.documentMessage.caption
  }

  return ''
}

/* ============================================================
 * GET MESSAGE TYPE
 * ============================================================ */

function getType(message) {
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
  if (m.locationMessage) return 'location'

  return 'unknown'
}

/* ============================================================
 * GET ARCHIVE DESTINATION
 * ============================================================ */

function getArchiveDestination() {
  const configured = getVar('ANTI_DELETE_ARCHIVE')

  if (!configured) {
    return ''
  }

  return normalizeDestination(configured)
}

/* ============================================================
 * SEND TEXT
 * ============================================================ */

async function sendDeletedText(
  sock,
  destination,
  stored,
  key
) {
  const text = getText(stored.message)

  const sender =
    stored.key?.participant ||
    key.participant ||
    stored.key?.remoteJid ||
    'Unknown'

  const name =
    stored.pushName ||
    'Unknown'

  const chat =
    stored.key?.remoteJid ||
    key.remoteJid ||
    'Unknown'

  const output =
    '🗑️ *DELETED MESSAGE*\n\n' +
    '👤 *From:* ' +
    name +
    '\n' +
    '🆔 *Sender:* ' +
    sender +
    '\n' +
    '💬 *Chat:* ' +
    chat +
    '\n\n' +
    '📝 *Message:*\n' +
    (text || '(empty message)')

  await sock.sendMessage(
    destination,
    {
      text: output
    }
  )
}

/* ============================================================
 * SEND MEDIA
 * ============================================================ */

async function sendDeletedMedia(
  sock,
  destination,
  stored,
  key
) {
  const message =
    unwrapMessage(
      stored.message
    )

  const sender =
    stored.key?.participant ||
    key.participant ||
    stored.key?.remoteJid ||
    'Unknown'

  const name =
    stored.pushName ||
    'Unknown'

  const chat =
    stored.key?.remoteJid ||
    key.remoteJid ||
    'Unknown'

  const type =
    getType(message)

  const caption =
    '🗑️ *DELETED MESSAGE*\n\n' +
    '👤 *From:* ' +
    name +
    '\n' +
    '🆔 *Sender:* ' +
    sender +
    '\n' +
    '💬 *Chat:* ' +
    chat +
    '\n' +
    '📦 *Type:* ' +
    type +
    '\n\n' +
    '📝 *Caption:*\n' +
    (getText(message) || '(none)')

  /* ==========================================================
   * IMAGE
   * ========================================================== */

  if (message?.imageMessage) {
    const media =
      await downloadMediaMessageSafe(
        stored
      )

    if (media) {
      await sock.sendMessage(
        destination,
        {
          image: media,
          caption
        }
      )

      return true
    }
  }

  /* ==========================================================
   * VIDEO
   * ========================================================== */

  if (message?.videoMessage) {
    const media =
      await downloadMediaMessageSafe(
        stored
      )

    if (media) {
      await sock.sendMessage(
        destination,
        {
          video: media,
          caption
        }
      )

      return true
    }
  }

  /* ==========================================================
   * AUDIO
   * ========================================================== */

  if (message?.audioMessage) {
    const media =
      await downloadMediaMessageSafe(
        stored
      )

    if (media) {
      await sock.sendMessage(
        destination,
        {
          audio: media,
          mimetype:
            message.audioMessage.mimetype ||
            'audio/mp4',
          ptt:
            Boolean(
              message.audioMessage.ptt
            )
        }
      )

      await sock.sendMessage(
        destination,
        {
          text: caption
        }
      )

      return true
    }
  }

  /* ==========================================================
   * DOCUMENT
   * ========================================================== */

  if (message?.documentMessage) {
    const media =
      await downloadMediaMessageSafe(
        stored
      )

    if (media) {
      await sock.sendMessage(
        destination,
        {
          document: media,
          mimetype:
            message.documentMessage.mimetype ||
            'application/octet-stream',
          fileName:
            message.documentMessage.fileName ||
            'deleted-file',
          caption
        }
      )

      return true
    }
  }

  /* ==========================================================
   * STICKER
   * ========================================================== */

  if (message?.stickerMessage) {
    const media =
      await downloadMediaMessageSafe(
        stored
      )

    if (media) {
      await sock.sendMessage(
        destination,
        {
          sticker: media
        }
      )

      await sock.sendMessage(
        destination,
        {
          text: caption
        }
      )

      return true
    }
  }

  return false
}

/* ============================================================
 * MEDIA DOWNLOADER
 *
 * Dynamically imports Baileys so this plugin remains compatible
 * with the existing project.
 * ============================================================ */

async function downloadMediaMessageSafe(message) {
  try {
    const baileys =
      await import('baileys')

    if (
      typeof baileys.downloadContentFromMessage !==
      'function'
    ) {
      console.log(
        '[ANTI-DELETE] downloadContentFromMessage unavailable'
      )

      return null
    }

    const raw =
      unwrapMessage(
        message.message
      )

    if (!raw) {
      return null
    }

    let mediaMessage = null
    let mediaType = null

    if (raw.imageMessage) {
      mediaMessage =
        raw.imageMessage
      mediaType = 'image'
    } else if (raw.videoMessage) {
      mediaMessage =
        raw.videoMessage
      mediaType = 'video'
    } else if (raw.audioMessage) {
      mediaMessage =
        raw.audioMessage
      mediaType = 'audio'
    } else if (raw.documentMessage) {
      mediaMessage =
        raw.documentMessage
      mediaType = 'document'
    } else if (raw.stickerMessage) {
      mediaMessage =
        raw.stickerMessage
      mediaType = 'sticker'
    }

    if (
      !mediaMessage ||
      !mediaType
    ) {
      return null
    }

    const stream =
      await baileys.downloadContentFromMessage(
        mediaMessage,
        mediaType
      )

    const chunks = []

    for await (
      const chunk of stream
    ) {
      chunks.push(chunk)
    }

    return Buffer.concat(
      chunks
    )
  } catch (error) {
    console.log(
      '[ANTI-DELETE] Media download failed: ' +
        (
          error?.message ||
          error
        )
    )

    return null
  }
}

/* ============================================================
 * PLUGIN
 * ============================================================ */

const antidelete = {
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
        Boolean(
          getVar(
            'ANTI_DELETE'
          )
        )

      const archive =
        getArchiveDestination()

      await sock.sendMessage(
        m.key.remoteJid,
        {
          text:
            '🛡️ *ANTI-DELETE*\n\n' +
            'Status: ' +
            (
              enabled
                ? '✅ ON'
                : '❌ OFF'
            ) +
            '\n' +
            'Archive: ' +
            (
              archive ||
              'Not configured'
            ) +
            '\n\n' +
            'Commands:\n' +
            '• *.antidelete on*\n' +
            '• *.antidelete off*\n' +
            '• *.antidelete archive 2348012345678*\n' +
            '• *.antidelete archive 120363429429530466@g.us*'
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
            '✅ *Anti-delete enabled!*\n\n' +
            '📥 Destination: ' +
            (
              archive ||
              'Not configured'
            )
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
        normalizeDestination(
          raw
        )

      if (!destination) {
        await sock.sendMessage(
          m.key.remoteJid,
          {
            text:
              '❌ *Invalid archive destination.*\n\n' +
              'Example:\n' +
              '*.antidelete archive 2348012345678*\n\n' +
              'Or:\n' +
              '*.antidelete archive 120363429429530466@g.us*'
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
            '✅ *Anti-delete archive set!*\n\n' +
            '📥 Destination: *Archive Group*\n' +
            '🆔 ' +
            destination +
            '\n\n' +
            '🗑️ Deleted messages will now be sent to this group.'
        }
      )

      return
    }

    /* ========================================================
     * UNKNOWN
     * ======================================================== */

    await sock.sendMessage(
      m.key.remoteJid,
      {
        text:
          '❌ Unknown option.\n\n' +
          'Use:\n' +
          '• *.antidelete on*\n' +
          '• *.antidelete off*\n' +
          '• *.antidelete archive 2348012345678*\n' +
          '• *.antidelete archive 120363429429530466@g.us*'
      }
    )
  },

  /* ==========================================================
   * ON DELETE
   *
   * This is registered directly in deleteHandlers by
   * pluginLoader.js.
   *
   * connection.js calls this when WhatsApp reports a revoke.
   * ========================================================== */

  async onDelete({
    sock,
    key,
    messageStore
  }) {
    /* ========================================================
     * CHECK ENABLED
     * ======================================================== */

    if (
      !getVar(
        'ANTI_DELETE'
      )
    ) {
      console.log(
        '[ANTI-DELETE] Disabled.'
      )

      return
    }

    /* ========================================================
     * CHECK MESSAGE ID
     * ======================================================== */

    if (!key?.id) {
      console.log(
        '[ANTI-DELETE] Delete event has no message ID.'
      )

      return
    }

    /* ========================================================
     * GET ARCHIVE DESTINATION
     * ======================================================== */

    const destination =
      getArchiveDestination()

    if (!destination) {
      console.log(
        '[ANTI-DELETE] No archive destination configured.'
      )

      return
    }

    /* ========================================================
     * GET ORIGINAL MESSAGE
     * ======================================================== */

    const stored =
      messageStore.get(
        key.id
      )

    if (!stored?.message) {
      console.log(
        '[ANTI-DELETE] Original message not found: ' +
          key.id
      )

      return
    }

    console.log(
      '[ANTI-DELETE] Forwarding deleted message: ' +
        key.id
    )

    try {
      const type =
        getType(
          stored.message
        )

      /* ======================================================
       * TEXT
       * ====================================================== */

      if (type === 'text') {
        await sendDeletedText(
          sock,
          destination,
          stored,
          key
        )
      } else {
        /* ====================================================
         * MEDIA
         * ==================================================== */

        const mediaSent =
          await sendDeletedMedia(
            sock,
            destination,
            stored,
            key
          )

        /* ====================================================
         * FALLBACK TO TEXT
         * ==================================================== */

        if (!mediaSent) {
          await sendDeletedText(
            sock,
            destination,
            stored,
            key
          )
        }
      }

      console.log(
        '[ANTI-DELETE] Deleted message forwarded successfully: ' +
          key.id
      )
    } catch (error) {
      console.error(
        '[ANTI-DELETE] Forward failed: ' +
          (
            error?.stack ||
            error?.message ||
            error
          )
      )
    }
  }
}

/* ============================================================
 * EXPORT
 * ============================================================ */

export default antidelete
