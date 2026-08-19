import {
  getContentType,
  jidNormalizedUser,
  downloadMediaMessage,
  isJidGroup,
  areJidsSameUser
} from 'baileys'
import config from '../config.js'

/**
 * Group metadata cache.
 *
 * WhatsApp rate-limits groupMetadata() when it is called repeatedly.
 * Cache metadata for a short period instead of requesting it
 * for every single message.
 */
const groupMetadataCache = new Map()

const GROUP_CACHE_TTL = 60 * 1000

async function getCachedGroupMetadata(sock, jid) {
  const cached = groupMetadataCache.get(jid)

  if (
    cached &&
    Date.now() - cached.timestamp < GROUP_CACHE_TTL
  ) {
    return cached.metadata
  }

  try {
    const metadata = await sock.groupMetadata(jid)

    groupMetadataCache.set(jid, {
      metadata,
      timestamp: Date.now()
    })

    return metadata
  } catch (error) {
    console.error(
      '[PERMISSIONS] Failed to read group metadata:',
      error?.message || error
    )

    // Use old metadata if available.
    if (cached?.metadata) {
      return cached.metadata
    }

    return null
  }
}

/**
 * Turns a raw Baileys message into a flat,
 * predictable object.
 */
export async function serialize(sock, raw, store) {
  if (!raw?.message) return null

  const m = {}

  m.raw = raw
  m.key = raw.key
  m.id = raw.key.id
  m.chat = raw.key.remoteJid
  m.fromMe = !!raw.key.fromMe
  m.isGroup = isJidGroup(m.chat)
  m.isStatus = m.chat === 'status@broadcast'
  m.pushName = raw.pushName || 'Unknown'

  m.timestamp =
    Number(raw.messageTimestamp) ||
    Math.floor(Date.now() / 1000)

  // Bot JID
  const botJid = jidNormalizedUser(
    sock.user?.id || ''
  )

  m.botJid = botJid

  m.botNumber = botJid
    .split('@')[0]
    .split(':')[0]

  // Sender
  m.sender = m.isGroup
    ? jidNormalizedUser(
        raw.key.participant ||
        raw.participant ||
        ''
      )
    : m.fromMe
      ? botJid
      : jidNormalizedUser(m.chat)

  m.senderNumber = (m.sender || '')
    .split('@')[0]
    .split(':')[0]

  // Unwrap message envelopes
  let content = raw.message

  if (content.ephemeralMessage)
    content = content.ephemeralMessage.message

  if (content.viewOnceMessage)
    content = content.viewOnceMessage.message

  if (content.viewOnceMessageV2)
    content = content.viewOnceMessageV2.message

  if (content.viewOnceMessageV2Extension)
    content = content.viewOnceMessageV2Extension.message

  if (content.documentWithCaptionMessage)
    content = content.documentWithCaptionMessage.message

  if (content.deviceSentMessage)
    content = content.deviceSentMessage.message

  m.message = content

  m.type =
    getContentType(content) ||
    Object.keys(content)[0]

  m.msg = content[m.type]

  // Message text
  m.body =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    content.interactiveResponseMessage
      ?.nativeFlowResponseMessage
      ?.paramsJson ||
    content.eventMessage?.name ||
    ''

  m.text = m.body

  m.mentions =
    m.msg?.contextInfo?.mentionedJid || []

  m.expiration =
    m.msg?.contextInfo?.expiration || null

  m.isMedia = [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'stickerMessage',
    'documentMessage'
  ].includes(m.type)

  /* ---------------- QUOTED MESSAGE ---------------- */

  const ctx = m.msg?.contextInfo
  const quotedRaw = ctx?.quotedMessage

  if (quotedRaw) {
    let q = quotedRaw

    if (q.ephemeralMessage)
      q = q.ephemeralMessage.message

    if (q.viewOnceMessage)
      q = q.viewOnceMessage.message

    if (q.viewOnceMessageV2)
      q = q.viewOnceMessageV2.message

    if (q.viewOnceMessageV2Extension)
      q = q.viewOnceMessageV2Extension.message

    if (q.documentWithCaptionMessage)
      q = q.documentWithCaptionMessage.message

    const qType =
      getContentType(q) ||
      Object.keys(q)[0]

    const qSender =
      jidNormalizedUser(
        ctx.participant || ''
      )

    m.quoted = {
      raw: quotedRaw,
      message: q,
      type: qType,
      msg: q[qType],
      id: ctx.stanzaId,
      sender: qSender,

      senderNumber: qSender
        .split('@')[0]
        .split(':')[0],

      fromMe: areJidsSameUser(
        qSender,
        botJid
      ),

      isMedia: [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'stickerMessage',
        'documentMessage'
      ].includes(qType),

      body:
        q.conversation ||
        q.extendedTextMessage?.text ||
        q.imageMessage?.caption ||
        q.videoMessage?.caption ||
        q.documentMessage?.caption ||
        '',

      mentions:
        q[qType]?.contextInfo?.mentionedJid || [],

      key: {
        remoteJid: m.chat,

        fromMe: areJidsSameUser(
          qSender,
          botJid
        ),

        id: ctx.stanzaId,

        participant: m.isGroup
          ? qSender
          : undefined
      },

      download: () =>
        downloadMediaMessage(
          {
            key: {
              remoteJid: m.chat,
              id: ctx.stanzaId,
              fromMe: false,
              participant: qSender
            },
            message: q
          },
          'buffer',
          {},
          {
            reuploadRequest:
              sock.updateMediaMessage
          }
        )
    }

    m.quoted.text = m.quoted.body
  } else {
    m.quoted = null
  }

  /* ---------------- HELPERS ---------------- */

  // Download message media.
  m.download = () =>
    downloadMediaMessage(
      raw,
      'buffer',
      {},
      {
        reuploadRequest:
          sock.updateMediaMessage
      }
    )

  // Outgoing command responses.
  m.commandResponses = []

  const rememberResponse = (
    jid,
    sent,
    keep = false
  ) => {
    if (
      !keep &&
      jid === m.chat &&
      sent?.key?.id
    ) {
      m.commandResponses.push(sent.key)
    }

    return sent
  }

  // Reply to message.
  m.reply = async (
    text,
    options = {}
  ) => {
    const content =
      typeof text === 'string'
        ? { text }
        : text

    const {
      jid = m.chat,
      keep = false,
      quoted,
      ...sendOptions
    } = options

    const sent = await sock.sendMessage(
      jid,
      {
        ...content,

        ...(m.expiration
          ? {
              ephemeralExpiration:
                m.expiration
            }
          : {})
      },
      {
        quoted:
          quoted === null
            ? undefined
            : quoted || raw,

        ...sendOptions
      }
    )

    return rememberResponse(
      jid,
      sent,
      keep
    )
  }

  // Send message without quoting.
  m.send = async (
    text,
    options = {}
  ) => {
    const content =
      typeof text === 'string'
        ? { text }
        : text

    const {
      jid = m.chat,
      keep = false,
      ...sendOptions
    } = options

    const sent = await sock.sendMessage(
      jid,
      content,
      sendOptions
    )

    return rememberResponse(
      jid,
      sent,
      keep
    )
  }

  // React to message.
  m.reacted = false

  m.react = (emoji) => {
    m.reacted = true

    return sock.sendMessage(
      m.chat,
      {
        react: {
          text: emoji,
          key: m.key
        }
      }
    )
  }

  // Target:
  // mention > quoted author
  m.target = (() => {
    if (m.mentions?.length)
      return m.mentions[0]

    if (m.quoted?.sender)
      return m.quoted.sender

    return null
  })()

  return m
}

/**
 * Check whether a participant has
 * admin privileges.
 */
function isAdminParticipant(participant) {
  if (!participant) return false

  return (
    participant.admin === 'admin' ||
    participant.admin === 'superadmin' ||
    participant.admin === 'owner' ||
    participant.isAdmin === true ||
    participant.isSuperAdmin === true ||
    participant.isOwner === true
  )
}

/**
 * Resolve owner, sudo and group permissions.
 *
 * Uses cached group metadata to avoid
 * WhatsApp rate-limit errors.
 */
export async function resolvePermissions(
  sock,
  m,
  sudoList = []
) {
  const owners = [
    ...config.ownerNumbers,
    m.botNumber
  ]

  m.isOwner =
    owners.includes(m.senderNumber) ||
    m.fromMe

  m.isSudo =
    m.isOwner ||
    sudoList.includes(m.senderNumber)

  m.isAdmin = false
  m.isBotAdmin = false

  m.groupMetadata = null
  m.groupName = ''
  m.participants = []

  // DMs don't need group metadata.
  if (!m.isGroup)
    return m

  /*
   * IMPORTANT:
   *
   * Do NOT call:
   *
   * sock.groupMetadata(m.chat)
   *
   * directly here.
   *
   * The cached function prevents repeated
   * WhatsApp metadata requests.
   */
  const metadata =
    await getCachedGroupMetadata(
      sock,
      m.chat
    )

  if (!metadata)
    return m

  m.groupMetadata = metadata

  m.groupName =
    metadata.subject || ''

  m.participants =
    metadata.participants || []

  const find = (jid) =>
    m.participants.find(
      (p) =>
        areJidsSameUser(
          p.id || '',
          jid || ''
        ) ||
        areJidsSameUser(
          p.jid || '',
          jid || ''
        )
    )

  const me = find(m.sender)
  const bot = find(m.botJid)

  m.isAdmin =
    isAdminParticipant(me)

  m.isBotAdmin =
    isAdminParticipant(bot)

  m.groupOwner =
    metadata.owner || ''

  return m
}

export default serialize