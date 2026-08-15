import DB from '../../src/lib/database.js'
import { getBuffer } from '../../src/lib/api.js'
import { toJid, pick } from '../../src/lib/utils.js'

export default [
  {
    name: 'vv',
    alias: ['viewonce', 'reveal'],
    category: 'TOOLS',
    desc: 'Reveal a view-once photo or video',
    usage: '.vv (reply to a view-once message)',
    async run({ m }) {
      if (!m.quoted) return m.reply('👁️ Reply to a view-once message with *.vv*')
      try {
        const buffer = await m.quoted.download()
        const type = m.quoted.type
        const caption = '👁️ *View-once revealed*'
        if (type === 'imageMessage') await m.reply({ image: buffer, caption })
        else if (type === 'videoMessage') await m.reply({ video: buffer, caption })
        else if (type === 'audioMessage') await m.reply({ audio: buffer, mimetype: 'audio/mpeg', ptt: true })
        else return m.reply('❌ That is not a view-once photo, video or voice note.')
      } catch (e) {
        await m.reply(`❌ Could not reveal it: ${e.message}`)
      }
    }
  },
  {
    name: 'quoted',
    alias: ['requote'],
    category: 'TOOLS',
    desc: 'Re-send the message you replied to',
    usage: '.quoted (reply to a message)',
    async run({ m, sock }) {
      if (!m.quoted) return m.reply('📩 Reply to a message with *.quoted*')
      await sock.sendMessage(m.chat, { forward: { key: m.quoted.key, message: m.quoted.message } })
    }
  },
  {
    name: 'addnote',
    category: 'UTILITIES',
    desc: 'Save a personal note',
    usage: '.addnote title | content',
    async run({ m, text }) {
      if (!text.includes('|')) return m.reply('📝 Usage: .addnote shopping | milk, bread, eggs')
      const [title, ...rest] = text.split('|')
      const content = rest.join('|').trim()
      if (!title.trim() || !content) return m.reply('📝 Both a title and content are required.')
      await DB.notes.set({ owner: m.sender, title: title.trim().toLowerCase() }, { content, at: Date.now() })
      await m.reply(`📝 Note *${title.trim()}* saved.`)
    }
  },
  {
    name: 'getnote',
    category: 'UTILITIES',
    desc: 'Read a saved note',
    usage: '.getnote title',
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .getnote shopping')
      const row = await DB.notes.findOne({ owner: m.sender, title: text.trim().toLowerCase() })
      if (!row) return m.reply(`❌ No note called "${text}".`)
      await m.reply(`📝 *${text.trim()}*\n\n${row.content}`)
    }
  },
  {
    name: 'allnotes',
    alias: ['notes'],
    category: 'UTILITIES',
    desc: 'List all your notes',
    usage: '.allnotes',
    async run({ m }) {
      const rows = await DB.notes.find({ owner: m.sender })
      if (!rows.length) return m.reply('📭 You have no notes. Create one with *.addnote title | content*')
      await m.reply(
        `📒 *YOUR NOTES* (${rows.length})\n\n` +
          rows.map((r, i) => `${i + 1}. *${r.title}*\n   ${r.content.slice(0, 60)}${r.content.length > 60 ? '...' : ''}`).join('\n\n')
      )
    }
  },
  {
    name: 'delnote',
    category: 'UTILITIES',
    desc: 'Delete a note',
    usage: '.delnote title',
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .delnote shopping')
      const title = text.trim().toLowerCase()
      const row = await DB.notes.findOne({ owner: m.sender, title })
      if (!row) return m.reply(`❌ No note called "${text}".`)
      await DB.notes.delete({ owner: m.sender, title })
      await m.reply(`🗑️ Note *${text.trim()}* deleted.`)
    }
  },
  {
    name: 'delallnote',
    alias: ['clearnotes'],
    category: 'UTILITIES',
    desc: 'Delete every note you own',
    usage: '.delallnote',
    async run({ m }) {
      await DB.notes.delete({ owner: m.sender })
      await m.reply('🗑️ All your notes were deleted.')
    }
  },
  {
    name: 'readmore',
    category: 'UTILITIES',
    desc: 'Insert a "read more" break into text',
    usage: '.readmore visible | hidden',
    async run({ m, text }) {
      if (!text.includes('|')) return m.reply('📝 Usage: .readmore short bit | the long hidden part')
      const [visible, ...rest] = text.split('|')
      await m.reply(`${visible.trim()}\u200e`.repeat(1) + '\u200b'.repeat(4000) + rest.join('|').trim())
    }
  },
  {
    name: 'tts',
    alias: ['say'],
    category: 'UTILITIES',
    desc: 'Convert text to a voice note',
    usage: '.tts hello world',
    cooldown: 8,
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('📝 Usage: .tts hello world  (or reply to a message)')
      if (body.length > 200) return m.reply('❌ Keep it under 200 characters.')
      try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(body)}&tl=en&client=tw-ob`
        const buffer = await getBuffer(url, { headers: { Referer: 'https://translate.google.com/' } })
        const { toPTT } = await import('../../src/lib/media.js')
        await m.reply({ audio: await toPTT(buffer, 'mp3'), mimetype: 'audio/ogg; codecs=opus', ptt: true })
      } catch (e) {
        await m.reply(`❌ Text-to-speech failed: ${e.message}`)
      }
    }
  },
  {
    name: 'mention',
    alias: ['hidetag'],
    category: 'TOOLS',
    desc: 'Message everyone without visible tags',
    usage: '.hidetag your message',
    group: true,
    admin: true,
    async run({ sock, m, text }) {
      const members = m.participants.map((p) => p.id)
      await sock.sendMessage(m.chat, { text: text || '📢', mentions: members })
    }
  },
  {
    name: 'ebinary',
    category: 'MISC',
    desc: 'Encode text into binary',
    usage: '.ebinary hello',
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('📝 Usage: .ebinary hello')
      const bin = [...body].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ')
      await m.reply(`🔢 *Binary*\n\n${bin.slice(0, 3000)}`)
    }
  },
  {
    name: 'dbinary',
    category: 'MISC',
    desc: 'Decode binary back into text',
    usage: '.dbinary 01101000 01101001',
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('📝 Usage: .dbinary 01101000 01101001')
      try {
        const out = body.trim().split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 2))).join('')
        await m.reply(`🔤 *Decoded*\n\n${out}`)
      } catch {
        await m.reply('❌ That is not valid binary.')
      }
    }
  },
  {
    name: 'flipcoin',
    alias: ['headsortails'],
    category: 'MISC',
    desc: 'Flip a coin (no betting)',
    usage: '.flipcoin',
    async run({ m }) {
      await m.reply(`🪙 *${pick(['HEADS', 'TAILS'])}*`)
    }
  },
  {
    name: 'rolldice',
    alias: ['d6'],
    category: 'MISC',
    desc: 'Roll a die (no betting)',
    usage: '.rolldice [sides]',
    async run({ m, args }) {
      const sides = Math.min(1000, Math.max(2, parseInt(args[0]) || 6))
      await m.reply(`🎲 You rolled a *${Math.floor(Math.random() * sides) + 1}* (d${sides})`)
    }
  },
  {
    name: 'choose',
    alias: ['pick'],
    category: 'MISC',
    desc: 'Let the bot choose for you',
    usage: '.choose pizza, rice, beans',
    async run({ m, text }) {
      if (!text.includes(',')) return m.reply('📝 Usage: .choose pizza, rice, beans')
      const options = text.split(',').map((s) => s.trim()).filter(Boolean)
      if (options.length < 2) return m.reply('❌ Give at least two options separated by commas.')
      await m.reply(`🎯 I choose: *${pick(options)}*`)
    }
  },
  {
    name: '8ball',
    alias: ['magic8', '8b'],
    category: 'MISC',
    desc: 'Ask the magic 8-ball',
    usage: '.8ball will I be rich?',
    async run({ m, text }) {
      if (!text) return m.reply('📝 Ask a question: .8ball will I be rich?')
      await m.reply(`🎱 *${text}*\n\n${pick([
        'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.',
        'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
        'Better not tell you now.', 'Do not count on it.', 'My reply is no.',
        'Very doubtful.', 'Outlook not so good.'
      ])}`)
    }
  }
]
