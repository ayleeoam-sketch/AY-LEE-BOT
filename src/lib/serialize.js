import {
  getContentType,
  jidNormalizedUser,
  downloadMediaMessage,
  isJidGroup,
  areJidsSameUser
} from 'baileys'
import config from '../config.js'
import { getVar } from './vars.js'

/**
 * Turns a raw Baileys message into a flat, predictable object.
 * Every plugin receives this as `m`, so plugins never touch proto internals.
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
  m.timestamp = Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000)

  // bot's own jid
  const botJid = jidNormalizedUser(sock.user?.id || '')
  m.botJid = botJid
  m.botNumber = botJid.split('@')[0].split(':')[0]

  // sender resolution: in groups the participant is the real author
  m.sender = m.isGroup
    ? jidNormalizedUser(raw.key.participant || raw.participant || '')
    : m.fromMe
      ? botJid
      : jidNormalizedUser(m.chat)
  m.senderNumber = (m.sender || '').split('@')[0].split(':')[0]

  // unwrap ephemeral / view-once / device-sent envelopes
  let content = raw.message
  if (content.ephemeralMessage) content = content.ephemeralMessage.message
  if (content.viewOnceMessage) content = content.viewOnceMessage.message
  if (content.viewOnceMessageV2) content = content.viewOnceMessageV2.message
  if (content.viewOnceMessageV2Extension) content = content.viewOnceMessageV2Extension.message
  if (content.documentWithCaptionMessage) content = content.documentWithCaptionMessage.message
  if (content.deviceSentMessage) content = content.deviceSentMessage.message
  m.message = content

  m.type = getContentType(content) || Object.keys(content)[0]
  m.msg = content[m.type]

  // plain text body across every message shape
  m.body =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    content.eventMessage?.name ||
    ''
  m.text = m.body

  m.mentions = m.msg?.contextInfo?.mentionedJid || []
  m.expiration = m.msg?.contextInfo?.expiration || null
  m.isMedia = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(m.type)

  /* ------------------------- quoted message ------------------------- */
  const ctx = m.msg?.contextInfo
  const quotedRaw = ctx?.quotedMessage
  if (quotedRaw) {
    let q = quotedRaw
    if (q.ephemeralMessage) q = q.ephemeralMessage.message
    if (q.viewOnceMessage) q = q.viewOnceMessage.message
    if (q.viewOnceMessageV2) q = q.viewOnceMessageV2.message
    if (q.viewOnceMessageV2Extension) q = q.viewOnceMessageV2Extension.message
    if (q.documentWithCaptionMessage) q = q.documentWithCaptionMessage.message

    const qType = getContentType(q) || Object.keys(q)[0]
    const qSender = jidNormalizedUser(ctx.participant || '')

    m.quoted = {
      raw: quotedRaw,
      message: q,
      type: qType,
      msg: q[qType],
      id: ctx.stanzaId,
      sender: qSender,
      senderNumber: qSender.split('@')[0].split(':')[0],
      fromMe: areJidsSameUser(qSender, botJid),
      isMedia: ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(qType),
      body:
        q.conversation ||
        q.extendedTextMessage?.text ||
        q.imageMessage?.caption ||
        q.videoMessage?.caption ||
        q.documentMessage?.caption ||
        '',
      mentions: q[qType]?.contextInfo?.mentionedJid || [],
      /** message key, needed to react/delete/reply to the quoted message */
      key: {
        remoteJid: m.chat,
        fromMe: areJidsSameUser(qSender, botJid),
        id: ctx.stanzaId,
        participant: m.isGroup ? qSender : undefined
      },
      /** download the quoted media into a Buffer */
      download: () =>
        downloadMediaMessage(
          { key: { remoteJid: m.chat, id: ctx.stanzaId, fromMe: false, participant: qSender }, message: q },
          'buffer',
          {},
          { reuploadRequest: sock.updateMediaMessage }
        )
    }
    m.quoted.text = m.quoted.body
  } else {
    m.quoted = null
  }

  /* --------------------------- helpers --------------------------- */

  /** Download this message's media as a Buffer. */
  m.download = () =>
    downloadMediaMessage(raw, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })

  /** Reply to this message. Accepts a string or a full Baileys content object. */
  m.reply = async (text, options = {}) => {
    const content = typeof text === 'string' ? { text } : text
    return sock.sendMessage(
      options.jid || m.chat,
      { ...content, ...(m.expiration ? { ephemeralExpiration: m.expiration } : {}) },
      { quoted: options.quoted === null ? undefined : options.quoted || raw, ...options }
    )
  }

  /** Send to this chat without quoting. */
  m.send = async (text, options = {}) => {
    const content = typeof text === 'string' ? { text } : text
    return sock.sendMessage(options.jid || m.chat, content, options)
  }

  /**
   * React to this message with an emoji.
   *
   * Sets m.reacted so the handler knows the plugin is managing its own
   * feedback and should not append an automatic ✅/❌ on top.
   */
  m.reacted = false
  m.react = (emoji) => {
    m.reacted = true
    return sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
  }

  /** The jid this command targets: mention > quoted author > argument. */
  m.target = (() => {
    if (m.mentions?.length) return m.mentions[0]
    if (m.quoted?.sender) return m.quoted.sender
    return null
  })()

  return m
}

/** Owner / sudo / admin permission resolution for a serialized message. */
export async function resolvePermissions(sock, m, sudoList = []) {
  const owners = [...config.ownerNumbers, m.botNumber]
  m.isOwner = owners.includes(m.senderNumber) || m.fromMe
  m.isSudo = m.isOwner || sudoList.includes(m.senderNumber)

  m.isAdmin = false
  m.isBotAdmin = false
  m.groupMetadata = null
  m.groupName = ''
  m.participants = []

  if (m.isGroup) {
    try {
      m.groupMetadata = await sock.groupMetadata(m.chat)
      m.groupName = m.groupMetadata.subject
      m.participants = m.groupMetadata.participants || []

      const find = (jid) =>
        m.participants.find((p) => areJidsSameUser(p.id, jid) || areJidsSameUser(p.jid || '', jid))

      const me = find(m.sender)
      const bot = find(m.botJid)
      m.isAdmin = !!(me?.admin === 'admin' || me?.admin === 'superadmin' || me?.isAdmin || me?.isSuperAdmin)
      m.isBotAdmin = !!(bot?.admin === 'admin' || bot?.admin === 'superadmin' || bot?.isAdmin || bot?.isSuperAdmin)
      m.groupOwner = m.groupMetadata.owner
    } catch {
      /* metadata fetch can fail on huge groups - treat as non-admin */
    }
  }
  return m
}

export default serialize
