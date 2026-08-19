import {
  getContentType,
  jidNormalizedUser,
  downloadMediaMessage,
  isJidGroup,
  areJidsSameUser
} from 'baileys'
import config from '../config.js'

/* ============================================================
 * GROUP METADATA CACHE
 * ============================================================ */

/*
 * WhatsApp can rate-limit groupMetadata() if it is requested
 * repeatedly.
 *
 * We use:
 * 1. A cache
 * 2. An in-flight request lock
 * 3. A longer TTL
 *
 * This prevents multiple messages arriving at the same time
 * from creating multiple groupMetadata() requests.
 */

const groupMetadataCache = new Map()
const groupMetadataRequests = new Map()

const GROUP_CACHE_TTL = 5 * 60 * 1000

async function getCachedGroupMetadata(sock, jid) {
  if (!jid) return null

  const now = Date.now()
  const cached = groupMetadataCache.get(jid)

  /* Use valid cached metadata */
  if (
    cached &&
    cached.metadata &&
    now - cached.timestamp < GROUP_CACHE_TTL
  ) {
    return cached.metadata
  }

  /*
   * If another request for this same group is already running,
   * wait for that request instead of creating another one.
   */
  if (groupMetadataRequests.has(jid)) {
    return groupMetadataRequests.get(jid)
  }

  const request = (async () => {
    try {
      const metadata = await sock.groupMetadata(jid)

      if (metadata) {
        groupMetadataCache.set(jid, {
          metadata,
          timestamp: Date.now()
        })
      }

      return metadata || cached?.metadata || null
    } catch (error) {
      /*
       * Do not spam the console when WhatsApp rate-limits us.
       * The bot can continue using old cached metadata if available.
       */
      const message =
        error?.message ||
        String(error || '')

      if (
        message.includes('rate-overlimit') ||
        message.includes('rate-over-limit')
      ) {
        if (cached?.metadata) {
          return cached.metadata
        }

        return null
      }

      console.error(
        '[PERMISSIONS] Group metadata error:',
        message
      )

      return cached?.metadata || null
    } finally {
      groupMetadataRequests.delete(jid)
    }
  })()

  groupMetadataRequests.set(jid, request)

  return request
}

/* ============================================================
 * MESSAGE SERIALIZER
 * ============================================================ */

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

  /* ==========================================================
   * BOT JID
   * ========================================================== */

  const botJid = jidNormalizedUser(
    sock.user?.id || ''
  )

  m.botJid = botJid

  m.botNumber = botJid
    .split('@')[0]
    .split(':')[0]

  /* ==========================================================
   * SENDER
   * ========================================================== */

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

  /* ==========================================================
   * UNWRAP MESSAGE
   * ========================================================== */

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
    content =
      content.documentWithCaptionMessage.message

  if (content.deviceSentMessage)
    content =
      content.deviceSentMessage.message

  m.message = content

  m.type =
    getContentType(content) ||
    Object.keys(content)[0]

  m.msg = content[m.type]

  /* ==========================================================
   * MESSAGE TEXT
   * ========================================================== */

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

  /* ==========================================================
   * QUOTED MESSAGE
   * ========================================================== */

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
      q =
        q.viewOnceMessageV2Extension.message

    if (q.documentWithCaptionMessage)
      q =
        q.documentWithCaptionMessage.message

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
        q[qType]?.contextInfo?.mentionedJid ||
        [],

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

  /* ==========================================================
   * HELPERS
   * ========================================================== */

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

  /* ==========================================================
   * REPLY
   * ========================================================== */

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

  /* ==========================================================
   * SEND
   * ========================================================== */

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

  /* ==========================================================
   * REACT
   * ========================================================== */

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

  /* ==========================================================
   * TARGET
   * ========================================================== */

  m.target = (() => {
    if (m.mentions?.length)
      return m.mentions[0]

    if (m.quoted?.sender)
      return m.quoted.sender

    return null
  })()

  return m
}

/* ============================================================
 * ADMIN CHECK
 * ============================================================ */

function isAdminParticipant(participant) {
  if (!participant)
    return false

  return (
    participant.admin === 'admin' ||
    participant.admin === 'superadmin' ||
    participant.admin === 'owner' ||
    participant.isAdmin === true ||
    participant.isSuperAdmin === true ||
    participant.isOwner === true
  )
}

/* ============================================================
 * PERMISSIONS
 * ============================================================ */

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

  /* DMs do not need group metadata */
  if (!m.isGroup)
    return m

  /*
   * IMPORTANT:
   *
   * Never call sock.groupMetadata(m.chat)
   * directly here.
   *
   * Always use the cache + request lock.
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