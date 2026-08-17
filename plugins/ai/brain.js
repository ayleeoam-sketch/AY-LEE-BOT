import { chat } from '../../src/lib/ai.js'
import { collection } from '../../src/lib/database.js'
import config from '../../src/config.js'

/**
 * VENOM BRAIN — the bot as a real assistant.
 *
 * `.brain` gives VENOM MD a warm, sharp, genuinely helpful assistant
 * personality: it answers like a human, works step-by-step, admits when it
 * is unsure, and — most importantly — REMEMBERS each person.
 *
 * Memory is stored per-user in the `brain` collection (MongoDB or JSON),
 * so it survives restarts, redeploys and even a full re-clone. This is the
 * difference between "a command that answers" and "a bot that knows you".
 *
 *   .brain <question>            ask anything
 *   .brain remember <fact>       save something about you
 *   .brain mymemory              see what it remembers
 *   .brain forget                wipe your memory
 *   (reply to its answer in a DM to keep talking — no command needed)
 */

const brain = collection('brain')

const HISTORY_LIMIT = 12 // conversation turns kept per user
const FACTS_LIMIT = 40 // remembered facts kept per user

const SYSTEM = `You are VENOM MD — a warm, sharp, genuinely helpful assistant living inside WhatsApp.
This is who you are, and how you talk:

1. ANSWER FIRST. Give the direct answer up front, then explain if it helps.
2. For "how do I..." questions, give clear numbered steps in order.
3. Be accurate. If you are not sure, say so honestly — never invent facts, links or numbers.
4. Keep it readable in WhatsApp: short paragraphs, *bold* for the key points, _italic_ sparingly. No headings, no markdown lists, no code fences unless the user asks for code.
5. Match their energy. Casual in, casual out. Serious in, serious out. You are a friend who happens to know everything.
6. Never be robotic. No "As an AI language model" filler. Just talk like a sharp, helpful person.
7. If the user is upset or confused, be patient and kind first, then solve the problem.
8. You can hold a conversation. Ask ONE short follow-up question only when it is genuinely useful.
9. When a question is vague, make your best guess, answer it, then offer the alternative in one line.`

const NAME_HINTS = [
  /(?:my name is|call me|i'm called)\s+([A-Za-z][A-Za-z'-]{1,24})/i,
  /(?:you can call me|just call me)\s+([A-Za-z][A-Za-z'-]{1,24})/i
]

const STOP_WORDS = new Set(['good', 'fine', 'okay', 'ok', 'sure', 'here', 'there', 'happy', 'tired', 'back', 'busy', 'bored', 'excited'])

/** Load (or create) a user's memory document. */
const getMemory = async (id) => (await brain.findOne({ id })) || { id, name: '', facts: [], history: [] }

/** Save a user's memory document. */
const saveMemory = (id, data) => brain.set({ id }, { ...data, id, lastSeen: Date.now() })

/** Try to learn the user's name from what they just wrote. */
function learnName(text, mem) {
  if (mem.name) return mem
  for (const re of NAME_HINTS) {
    const m = re.exec(text)
    if (m) {
      const name = m[1]
      if (name && name.length >= 2 && !STOP_WORDS.has(name.toLowerCase())) {
        mem.name = name[0].toUpperCase() + name.slice(1)
        break
      }
    }
  }
  return mem
}

/** Build the personalised system prompt. */
function systemFor(mem) {
  let sys = SYSTEM
  if (mem.name) sys += `\n\nThe user's name is ${mem.name}. Use their name naturally, but do not overuse it.`
  if (mem.facts?.length) {
    sys += `\n\nThings you remember about this user (keep them in mind):\n` + mem.facts.map((f) => `- ${f}`).join('\n')
  }
  return sys
}

export default {
  name: 'brain',
  alias: ['me', 'assistant', 'jarvis', 'venomai'],
  category: 'AI',
  desc: 'Your personal AI assistant that remembers you',
  usage: '.brain <question> | .brain remember <fact> | .brain mymemory | .brain forget',
  cooldown: 4,

  async run({ m, args, text, config: cfg }) {
    const id = m.sender
    const sub = (args[0] || '').toLowerCase()
    const mem = await getMemory(id)

    /* ---------- memory management sub-commands ---------- */
    if (sub === 'remember' && args.length > 1) {
      const fact = args.slice(1).join(' ').trim()
      if (fact.length < 3) return m.reply('🧠 What should I remember? e.g. *.brain remember I love football*')
      mem.facts = mem.facts || []
      if (!mem.facts.includes(fact)) {
        mem.facts.push(fact)
        if (mem.facts.length > FACTS_LIMIT) mem.facts.shift()
      }
      await saveMemory(id, mem)
      return m.reply(`🧠 Got it. I'll remember that about you.${mem.name ? ` ${mem.name}` : ''}\n\n_Ask *.brain mymemory* to see what I know._`)
    }

    if (sub === 'forget' || sub === 'reset' || sub === 'clear') {
      await brain.delete({ id })
      return m.reply('🧠 Memory wiped. It is like we just met. 🫡')
    }

    if (sub === 'mymemory' || sub === 'whoami' || sub === 'mem') {
      const facts = mem.facts?.length ? mem.facts.map((f) => `• ${f}`).join('\n') : '• nothing yet — say *.brain remember I like X*'
      return m.reply(
        `🧠 *WHAT I KNOW ABOUT YOU*${mem.name ? `\n\n👤 Name: *${mem.name}*` : ''}\n\n${facts}\n\n` +
          `_I remember this across restarts and redeploys._`
      )
    }

    /* ---------- the actual conversation ---------- */
    const prompt = text || m.quoted?.text
    if (!prompt) {
      return m.reply(
        `🧠 *${cfg.botName} BRAIN*\n\n` +
          `I'm your personal assistant — I answer anything, work step-by-step, and I *remember you*.\n\n` +
          `*.brain explain gravity to a 5 year old*\n` +
          `*.brain write a birthday message for my mum*\n` +
          `*.brain remember I support Chelsea*\n` +
          `*.brain mymemory*\n` +
          `*.brain forget*\n\n` +
          `_In a private chat, just reply to my answer to keep talking._`
      )
    }

    learnName(prompt, mem)
    await saveMemory(id, mem)

    const history = (mem.history || []).slice(-HISTORY_LIMIT)
    const messages = [...history, { role: 'user', content: prompt }]

    await m.react('🧠')
    try {
      const res = await chat(messages, { system: systemFor(mem), maxTokens: 1200 })
      history.push({ role: 'user', content: prompt }, { role: 'assistant', content: res.text })
      while (history.length > HISTORY_LIMIT) history.shift()
      mem.history = history
      await saveMemory(id, mem)
      await m.reply(res.text.slice(0, 3800))
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  },

  /**
   * Natural follow-up: in a PRIVATE chat, if you reply to one of my answers
   * with normal text (no command), I keep the conversation going.
   */
  async before({ sock, m }) {
    if (m.fromMe || !m.body || m.isStatus || m.isGroup) return false
    if (m.body.startsWith(config.prefix)) return false
    if (!m.quoted?.fromMe) return false

    const mem = await getMemory(m.sender)
    if (!mem.history?.length) return false

    try {
      await sock.sendPresenceUpdate('composing', m.chat)
      const history = mem.history.slice(-HISTORY_LIMIT)
      const res = await chat([...history, { role: 'user', content: m.body }], {
        system: systemFor(mem),
        maxTokens: 1200
      })
      history.push({ role: 'user', content: m.body }, { role: 'assistant', content: res.text })
      while (history.length > HISTORY_LIMIT) history.shift()
      await saveMemory(m.sender, { ...mem, history })
      await m.reply(res.text.slice(0, 3800))
    } catch {
      // stay silent rather than spam errors on a natural reply
    }
    return true
  }
}
