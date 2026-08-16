/**
 * Snipe: reveal the last deleted / edited message in this chat.
 *
 * The hooks ride on top of the existing in-memory messageStore that
 * connection.js already keeps for retries, so nothing extra is persisted -
 * it's all short-lived RAM (last 5 per chat, wiped on restart).
 *
 *   .snipe      -> last deleted message
 *   .editsnipe  -> last edited message (before -> after)
 */

const MAX_PER_CHAT = 5
const deletedStore = new Map() // chatJid -> [{ sender, when, type, text }]
const editedStore = new Map()

/** Pull displayable text out of any raw message shape. */
export function messageToText(msg) {
  if (!msg) return null
  let m = msg
  if (m.message) m = m.message
  if (m.ephemeralMessage) m = m.ephemeralMessage.message
  if (m.viewOnceMessage) m = m.viewOnceMessage.message
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message
  if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message
  if (m.deviceSentMessage) m = m.deviceSentMessage.message

  if (typeof m.conversation === 'string') return { type: 'text', text: m.conversation }
  if (m.extendedTextMessage?.text) return { type: 'text', text: m.extendedTextMessage.text }
  const caps = ['imageMessage', 'videoMessage', 'stickerMessage', 'audioMessage', 'documentMessage']
  for (const t of caps) {
    if (m[t]) {
      const label = { imageMessage: '📷 image', videoMessage: '🎬 video', stickerMessage: '🧩 sticker', audioMessage: '🎧 audio', documentMessage: '📄 document' }[t]
      const cap = m[t].caption ? `: ${m[t].caption}` : ''
      return { type: 'media', text: `${label}${cap}` }
    }
  }
  return { type: 'other', text: `[${Object.keys(m)[0] || 'unknown'}]` }
}

function push(store, chat, entry) {
  if (!store.has(chat)) store.set(chat, [])
  const list = store.get(chat)
  list.push(entry)
  if (list.length > MAX_PER_CHAT) list.shift()
}

const ago = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ${min % 60}m ago`
}

export default [
  {
    name: 'snipe-hook',
    hidden: true,
    async onDelete({ key, messageStore }) {
      try {
        const raw = messageStore?.get(key.id)
        const info = messageToText(raw?.message)
        if (!info?.text || !key.remoteJid) return
        push(deletedStore, key.remoteJid, {
          sender: (key.participant || key.remoteJid || '').split('@')[0].split(':')[0],
          when: Date.now(),
          ...info
        })
      } catch {}
    },
    async onEdit({ key, edited, messageStore }) {
      try {
        const before = messageToText(messageStore?.get(key.id)?.message)
        const after = messageToText(edited)
        if (!after?.text || !key.remoteJid) return
        push(editedStore, key.remoteJid, {
          sender: (key.participant || key.remoteJid || '').split('@')[0].split(':')[0],
          when: Date.now(),
          before: before?.text || null,
          after: after.text
        })
      } catch {}
    }
  },
  {
    name: 'snipe',
    alias: ['del', 'deletedmsg', 'readdeleted'],
    category: 'TOOLS',
    desc: 'Show the most recently deleted message in this chat',
    usage: '.snipe [number of entries]',
    cooldown: 5,
    async run({ m, args }) {
      const count = Math.min(Math.max(parseInt(args[0]) || 1, 1), MAX_PER_CHAT)
      const list = (deletedStore.get(m.chat) || []).slice(-count).reverse()
      if (!list.length) {
        return m.reply('🔫 Nothing to snipe - no deleted messages recorded yet.\n\n_(Only messages the bot saw arrive can be revealed.)_')
      }

      const body = list
        .map(
          (e, i) =>
            `*${i + 1}.* 👤 ${e.sender} · 🕑 ${ago(e.when)}\n${e.text}`
        )
        .join('\n\n')
      await m.reply(`🔫 *SNIPE - deleted messages*\n\n${body}`)
    }
  },
  {
    name: 'editsnipe',
    alias: ['esnipe', 'editedmsg'],
    category: 'TOOLS',
    desc: 'Show the most recently edited message (before and after)',
    usage: '.editsnipe',
    cooldown: 5,
    async run({ m, args }) {
      const count = Math.min(Math.max(parseInt(args[0]) || 1, 1), MAX_PER_CHAT)
      const list = (editedStore.get(m.chat) || []).slice(-count).reverse()
      if (!list.length) return m.reply('✏️ No edited messages recorded yet.')

      const body = list
        .map(
          (e, i) =>
            `*${i + 1}.* 👤 ${e.sender} · 🕑 ${ago(e.when)}\n` +
            (e.before ? `~~${e.before}~~\n` : '') +
            `→ ${e.after}`
        )
        .join('\n\n')
      await m.reply(`✏️ *EDIT SNIPE*\n\n${body}`)
    }
  }
]
