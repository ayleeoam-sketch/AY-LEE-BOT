import { getVar, setVar } from '../../src/lib/vars.js'

/* ============================================================
 * ANTI-DELETE
 * ============================================================ */

/* ============================================================
 * NORMALIZE ARCHIVE DESTINATION
 * ============================================================ */

function normalizeDestination(value) {
  if (!value) return ''

  let destination = String(value).trim()

  if (destination.endsWith('@g.us')) {
    return destination
  }

  if (destination.endsWith('@s.whatsapp.net')) {
    return destination
  }

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

  if (!m) {
    return ''
  }

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

  if (!m) {
    return 'unknown'
  }

  if (m.conversation) {
    return 'text'
  }

  if (m.extendedTextMessage) {
    return 'text'
  }

  if (m.imageMessage) {
    return 'image'
  }

  if (m.videoMessage) {
    return 'video'
  }

  if (m.audioMessage) {
    return 'audio'
  }

  if (m.documentMessage) {
    return 'document'
  }

  if (m.stickerMessage) {
    return 'sticker'
  }

  if (m.contactMessage) {
    return 'contact'
  }

  if (m.locationMessage) {
    return 'location'
  }

  return 'unknown'
}

/* ============================================================
 * GET ARCHIVE DESTINATION
 * ============================================================ */

function getArchiveDestination() {
  const configured =
    getVar(
      'ANTI_DELETE_ARCHIVE'
    )

  if (!configured) {
    return ''
  }

  return normalizeDestination(
    configured
  )
}

/* ============================================================
 * JID HELPERS
 * ============================================================ */

function isGroupJid(jid) {
  return Boolean(
    jid &&
    String(jid).endsWith('@g.us')
  )
}

function isUserJid(jid) {
  return Boolean(
    jid &&
    (
      String(jid).endsWith('@s.whatsapp.net') ||
      String(jid).endsWith('@lid')
    )
  )
}

/* ============================================================
 * GET CHAT JID
 * ============================================================ */

function getChatJid(stored, key) {
  const candidates = [
    stored?.key?.remoteJid,
    key?.remoteJid,

    stored?.key?.remoteJidAlt,
    key?.remoteJidAlt
  ]

  for (const jid of candidates) {
    if (jid) {
      return String(jid)
    }
  }

  return 'Unknown'
}

/* ============================================================
 * GET SENDER JID
 *
 * Prefer a real phone-number JID where available.
 * ============================================================ */

function getSenderJid(stored, key) {
  const message =
    unwrapMessage(
      stored?.message
    )

  const candidates = [
    /* ========================================================
     * REAL PHONE NUMBER ALTERNATIVES
     * ======================================================== */

    stored?.key?.participantAlt,
    key?.participantAlt,

    stored?.key?.participantPn,
    key?.participantPn,

    stored?.key?.remoteJidAlt,
    key?.remoteJidAlt,

    /* ========================================================
     * ORIGINAL PARTICIPANT
     * ======================================================== */

    stored?.key?.participant,
    key?.participant,

    /* ========================================================
     * CONTEXT PARTICIPANT
     * ======================================================== */

    message?.extendedTextMessage?.contextInfo?.participant,

    message?.imageMessage?.contextInfo?.participant,

    message?.videoMessage?.contextInfo?.participant,

    message?.documentMessage?.contextInfo?.participant,

    message?.audioMessage?.contextInfo?.participant,

    /* ========================================================
     * PRIVATE CHAT FALLBACK
     * ======================================================== */

    !isGroupJid(
      stored?.key?.remoteJid
    )
      ? stored?.key?.remoteJid
      : null,

    !isGroupJid(
      key?.remoteJid
    )
      ? key?.remoteJid
      : null
  ]

  /* ==========================================================
   * FIRST CHOICE:
   * ACTUAL PHONE JID
   * ========================================================== */

  for (const jid of candidates) {
    if (
      jid &&
      String(jid).endsWith(
        '@s.whatsapp.net'
      )
    ) {
      return String(jid)
    }
  }

  /* ==========================================================
   * SECOND CHOICE:
   * WHATEVER WHATSAPP SUPPLIED
   * ========================================================== */

  for (const jid of candidates) {
    if (jid) {
      return String(jid)
    }
  }

  return 'Unknown'
}

/* ============================================================
 * GET SENDER NAME
 * ============================================================ */

function getSenderName(stored) {
  return (
    stored?.pushName ||
    stored?.notifyName ||
    stored?.verifiedBizName ||
    stored?.key?.participantPn ||
    'Unknown'
  )
}

/* ============================================================
 * GET CHAT NAME
 * ============================================================ */

function getChatName(stored, key) {
  const chatName =
    stored?.chatName ||
    stored?.groupName ||
    stored?.key?.chatName ||
    stored?.key?.groupName

  if (chatName) {
    return String(chatName)
  }

  return getChatJid(
    stored,
    key
  )
}

/* ============================================================
 * BUILD DELETED MESSAGE HEADER
 * ============================================================ */

function buildHeader(
  stored,
  key
) {
  const sender =
    getSenderJid(
      stored,
      key
    )

  const name =
    getSenderName(
      stored
    )

  const chatJid =
    getChatJid(
      stored,
      key
    )

  const chatName =
    getChatName(
      stored,
      key
    )

  return (
    '🗑️ *DELETED MESSAGE*\n\n' +
    '👤 *From:* ' +
    name +
    '\n' +
    '🆔 *Sender:* ' +
    sender +
    '\n' +
    '💬 *Chat:* ' +
    chatName +
    '\n' +
    '🔗 *Chat JID:* ' +
    chatJid
  )
}

/* ============================================================
 * SEND DELETED TEXT
 * ============================================================ */

async function sendDeletedText(
  sock,
  destination,
  stored,
  key
) {
  const text =
    getText(
      stored.message
    )

  const output =
    buildHeader(
      stored,
      key
    ) +
    '\n\n' +
    '📝 *Message:*\n' +
    (
      text ||
      '(empty message)'
    )

  await sock.sendMessage(
    destination,
    {
      text: output
    }
  )

  return true
}

/* ============================================================
 * MEDIA DOWNLOADER
 * ============================================================ */

async function downloadMediaMessageSafe(
  message
) {
  try {
    const baileys =
      await import(
        'baileys'
      )

    if (
      typeof baileys.downloadContentFromMessage !==
      'function'
    ) {
      return null
    }

    const raw =
      unwrapMessage(
        message?.message
      )

    if (!raw) {
      return null
    }

    let mediaMessage = null
    let mediaType = null

    /* ========================================================
     * IMAGE
     * ======================================================== */

    if (
      raw.imageMessage
    ) {
      mediaMessage =
        raw.imageMessage

      mediaType =
        'image'
    }

    /* ========================================================
     * VIDEO
     * ======================================================== */

    else if (
      raw.videoMessage
    ) {
      mediaMessage =
        raw.videoMessage

      mediaType =
        'video'
    }

    /* ========================================================
     * AUDIO
     * ======================================================== */

    else if (
      raw.audioMessage
    ) {
      mediaMessage =
        raw.audioMessage

      mediaType =
        'audio'
    }

    /* ========================================================
     * DOCUMENT
     * ======================================================== */

    else if (
      raw.documentMessage
    ) {
      mediaMessage =
        raw.documentMessage

      mediaType =
        'document'
    }

    /* ========================================================
     * STICKER
     * ======================================================== */

    else if (
      raw.stickerMessage
    ) {
      mediaMessage =
        raw.stickerMessage

      mediaType =
        'sticker'
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

    if (
      !chunks.length
    ) {
      return null
    }

    return Buffer.concat(
      chunks
    )
  } catch (error) {
    console.error(
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
 * SEND DELETED MEDIA
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

  if (!message) {
    return false
  }

  const type =
    getType(
      message
    )

  const caption =
    buildHeader(
      stored,
      key
    ) +
    '\n' +
    '📦 *Type:* ' +
    type +
    '\n\n' +
    '📝 *Caption:*\n' +
    (
      getText(message) ||
      '(none)'
    )

  /* ==========================================================
   * DOWNLOAD MEDIA
   * ========================================================== */

  const media =
    await downloadMediaMessageSafe(
      stored
    )

  /* ==========================================================
   * IMAGE
   * ========================================================== */

  if (
    message.imageMessage
  ) {
    if (!media) {
      return false
    }

    await sock.sendMessage(
      destination,
      {
        image: media,
        caption
      }
    )

    return true
  }

  /* ==========================================================
   * VIDEO
   * ========================================================== */

  if (
    message.videoMessage
  ) {
    if (!media) {
      return false
    }

    await sock.sendMessage(
      destination,
      {
        video: media,
        caption
      }
    )

    return true
  }

  /* ==========================================================
   * AUDIO
   * ========================================================== */

  if (
    message.audioMessage
  ) {
    if (!media) {
      return false
    }

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

  /* ==========================================================
   * DOCUMENT
   * ========================================================== */

  if (
    message.documentMessage
  ) {
    if (!media) {
      return false
    }

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

  /* ==========================================================
   * STICKER
   * ========================================================== */

  if (
    message.stickerMessage
  ) {
    if (!media) {
      return false
    }

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

  return false
}

/* ============================================================
 * PLUGIN
 *
 * IMPORTANT:
 * Do NOT add "ad" to aliases.
 *
 * Another plugin already owns "ad".
 * ============================================================ */

const antidelete = {
  name: 'antidelete',

  alias: [
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

    if (
      action === 'on'
    ) {
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

    if (
      action === 'off'
    ) {
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

    if (
      action === 'archive'
    ) {
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
            '🗑️ Deleted messages will now be sent to this destination.'
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
      return
    }

    /* ========================================================
     * CHECK MESSAGE ID
     * ======================================================== */

    if (!key?.id) {
      return
    }

    /* ========================================================
     * GET ARCHIVE DESTINATION
     * ======================================================== */

    const destination =
      getArchiveDestination()

    if (!destination) {
      return
    }

    /* ========================================================
     * GET ORIGINAL MESSAGE
     * ======================================================== */

    const stored =
      messageStore?.get(
        key.id
      )

    if (!stored?.message) {
      return
    }

    /* ========================================================
     * PROCESS
     * ======================================================== */

    try {
      const type =
        getType(
          stored.message
        )

      /* ======================================================
       * TEXT
       * ====================================================== */

      if (
        type === 'text'
      ) {
        await sendDeletedText(
          sock,
          destination,
          stored,
          key
        )

        return
      }

      /* ======================================================
       * MEDIA
       * ====================================================== */

      const mediaSent =
        await sendDeletedMedia(
          sock,
          destination,
          stored,
          key
        )

      /* ======================================================
       * FALLBACK
       * ====================================================== */

      if (!mediaSent) {
        await sendDeletedText(
          sock,
          destination,
          stored,
          key
        )
      }
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
