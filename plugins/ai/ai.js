import AI, { PROVIDERS, chat, available, getKey, setKey, clearKey, remember, history, forget } from '../../src/lib/ai.js'
import { getBuffer } from '../../src/lib/api.js'
import config from '../../src/config.js'

/**
 * AI commands.
 *
 * All of these route through src/lib/ai.js, which tries every provider you
 * have a key for (best first) and falls back to a keyless endpoint so the
 * commands still work out of the box.
 */

const say = async (m, text, meta) =>
  m.reply(`${text}\n\n╰─ _${meta.provider} · ${meta.model}_`)

/** Build a command bound to one specific provider. */
const providerCommand = ({ name, alias, provider, label, emoji = '🤖', system }) => ({
  name,
  alias,
  category: 'AI',
  desc: `Ask ${label}`,
  usage: `.${name} your question`,
  cooldown: 5,
  async run({ m, text }) {
    const prompt = text || m.quoted?.text
    if (!prompt) {
      const keyed = getKey(provider)
      return m.reply(
        `${emoji} *${label}*\n\n` +
          `Ask me something:\n*.${name} explain quantum computing simply*\n\n` +
          (keyed
            ? `✅ Your ${label} key is active.`
            : `⚠️ No ${label} key set — I'll use another provider or the free fallback.\n` +
              `Add one with *.setkey ${provider} <key>*`)
      )
    }
    await m.react(emoji)
    try {
      const res = await chat(prompt, { provider, system })
      await say(m, res.text.slice(0, 3800), res)
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

export default [
  /* ---------------- general ---------------- */
  {
    name: 'ai',
    alias: ['ask', 'venom'],
    category: 'AI',
    desc: 'Ask the AI anything (uses your best provider)',
    usage: '.ai why is the sky blue',
    cooldown: 5,
    async run({ m, text, config: cfg }) {
      const prompt = text || m.quoted?.text
      if (!prompt) {
        const list = available()
        return m.reply(
          `🤖 *${cfg.botName} AI*\n\n` +
            `Ask me anything:\n*.ai explain gravity to a 5 year old*\n\n` +
            (list.length
              ? `⚡ Active providers: ${list.map((n) => PROVIDERS[n].label).join(', ')}`
              : `⚠️ No API key configured — using the free fallback.\nRun *.aikeys* to see free options.`)
        )
      }
      await m.react('🤖')
      try {
        const res = await chat(prompt, {
          system: `You are ${cfg.botName}, a helpful WhatsApp assistant. Be concise and friendly. Use WhatsApp formatting (*bold*, _italic_) sparingly.`
        })
        await say(m, res.text.slice(0, 3800), res)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },

  /* ---------------- per-provider ---------------- */
  providerCommand({ name: 'gpt', alias: ['openai', 'chatgpt'], provider: 'openai', label: 'ChatGPT', emoji: '💬' }),
  providerCommand({ name: 'gemini', alias: ['bard'], provider: 'gemini', label: 'Gemini', emoji: '✨' }),
  providerCommand({ name: 'deepseek', alias: ['ds'], provider: 'deepseek', label: 'DeepSeek', emoji: '🐋' }),
  providerCommand({ name: 'groq', alias: ['llama', 'llama3'], provider: 'groq', label: 'Llama on Groq', emoji: '⚡' }),
  providerCommand({ name: 'mistral', provider: 'mistral', label: 'Mistral', emoji: '🌬️' }),
  providerCommand({ name: 'cohere', alias: ['command'], provider: 'cohere', label: 'Cohere Command', emoji: '🔷' }),
  providerCommand({ name: 'cerebras', provider: 'cerebras', label: 'Cerebras', emoji: '🧠' }),
  providerCommand({ name: 'openrouter', alias: ['orouter'], provider: 'openrouter', label: 'OpenRouter', emoji: '🔀' }),
  providerCommand({
    name: 'bidara', provider: 'gemini', label: 'BIDARA (bio-inspired design)', emoji: '🧬',
    system:
      'You are BIDARA, a biomimicry design assistant created by NASA. Help the user solve design ' +
      'problems using strategies found in biology and nature. Cite the organism behind each idea.'
  }),

  /* ---------------- specialised ---------------- */
  {
    name: 'coder',
    alias: ['code', 'dev'],
    category: 'AI',
    desc: 'Programming help and code generation',
    usage: '.coder python script to rename files',
    cooldown: 6,
    async run({ m, text }) {
      const prompt = text || m.quoted?.text
      if (!prompt) return m.reply('👨‍💻 Usage: *.coder a node function to debounce*')
      await m.react('👨‍💻')
      try {
        // prefer models that are strong at code
        const res = await chat(prompt, {
          provider: getKey('deepseek') ? 'deepseek' : getKey('groq') ? 'groq' : undefined,
          system:
            'You are an expert programmer. Give working, complete code with brief comments. ' +
            'State the language first. Keep explanations short — the code matters most.',
          temperature: 0.3
        })
        await say(m, res.text.slice(0, 3800), res)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'reasoning',
    alias: ['think', 'reason'],
    category: 'AI',
    desc: 'Careful step-by-step reasoning',
    usage: '.reasoning if a bat and ball cost 1.10...',
    cooldown: 8,
    async run({ m, text }) {
      const prompt = text || m.quoted?.text
      if (!prompt) return m.reply('🧠 Usage: *.reasoning 3 people check into a hotel...*')
      await m.react('🧠')
      try {
        const res = await chat(prompt, {
          system:
            'Think through the problem step by step, showing your working. ' +
            'Double-check the answer before stating it. Finish with a clear final answer.',
          temperature: 0.2,
          maxTokens: 2000
        })
        await say(m, res.text.slice(0, 3800), res)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'chatbot',
    alias: ['convo'],
    category: 'AI',
    desc: 'Conversational mode that remembers context',
    usage: '.chatbot on | off | clear',
    cooldown: 3,
    async run({ m, args, text, config: cfg }) {
      const sub = (args[0] || '').toLowerCase()
      const DB = (await import('../../src/lib/database.js')).default

      if (sub === 'on' || sub === 'off') {
        if (!m.isOwner && !m.isAdmin) return m.reply('🔒 Only an admin or the owner can toggle chatbot mode.')
        await DB.groups.set({ id: m.chat }, { chatbot: sub === 'on' })
        return m.reply(
          sub === 'on'
            ? `🤖 Chatbot mode *on*. I'll reply to every message here and remember the conversation.\n\n_Turn it off with *.chatbot off*_`
            : '🤖 Chatbot mode *off*.'
        )
      }
      if (sub === 'clear' || sub === 'reset') {
        forget(m.chat)
        return m.reply('🧹 Conversation memory cleared.')
      }
      if (!text) {
        const row = await DB.groups.findOne({ id: m.chat })
        return m.reply(
          `🤖 *CHATBOT*\n\n` +
            `Status: *${row?.chatbot ? 'on' : 'off'}*\n` +
            `Remembered turns: ${history(m.chat).length}\n\n` +
            `*.chatbot on* — reply to everything here\n` +
            `*.chatbot off* — stop\n` +
            `*.chatbot clear* — forget the conversation\n` +
            `*.chatbot <message>* — one-off with memory`
        )
      }

      await m.react('💭')
      try {
        remember(m.chat, 'user', text)
        const res = await chat(history(m.chat), {
          system: `You are ${cfg.botName} in a WhatsApp chat. Reply naturally and briefly, like a friend texting.`
        })
        remember(m.chat, 'assistant', res.text)
        await m.reply(res.text.slice(0, 3500))
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    },

    /** When chatbot mode is on, answer ordinary messages too. */
    async before({ sock, m }) {
      if (m.fromMe || !m.body || m.body.startsWith(config.prefix)) return false
      if (m.isStatus) return false
      const DB = (await import('../../src/lib/database.js')).default
      const row = await DB.groups.findOne({ id: m.chat })
      if (!row?.chatbot) return false

      // in groups only respond when mentioned or replied to
      if (m.isGroup) {
        const mentioned = m.mentions?.includes(m.botJid)
        const repliedToBot = m.quoted?.fromMe
        if (!mentioned && !repliedToBot) return false
      }

      try {
        await sock.sendPresenceUpdate('composing', m.chat)
        remember(m.chat, 'user', m.body)
        const res = await chat(history(m.chat), {
          system: `You are ${config.botName} in a WhatsApp chat. Reply naturally and briefly, like a friend texting. No markdown headings.`
        })
        remember(m.chat, 'assistant', res.text)
        await m.reply(res.text.slice(0, 3500))
      } catch {
        // stay silent on failure rather than spamming errors
      }
      return true
    }
  },

  /* ---------------- key management ---------------- */
  {
    name: 'aikeys',
    alias: ['aiproviders', 'freeai'],
    category: 'AI',
    desc: 'List AI providers and how to get free keys',
    usage: '.aikeys',
    async run({ m, prefix }) {
      const lines = Object.entries(PROVIDERS)
        .sort((a, b) => b[1].quality - a[1].quality)
        .map(([name, p]) => {
          const on = getKey(name)
          return (
            `${on ? '✅' : '⬜'} *${p.label}*\n` +
            `   ${p.free}\n` +
            (on ? `   _key active_\n` : `   🔗 ${p.signup}\n   ↳ \`${prefix}setkey ${name} <your-key>\`\n`)
          )
        })
      await m.reply(
        `🔑 *AI PROVIDERS*\n\n` +
          lines.join('\n') +
          `\n_Keys are stored in the database, never shown in chat, and the message you send them in is deleted automatically._\n\n` +
          `Recommended free picks: *Groq* (fast, generous) and *Gemini* (very capable).`
      )
    }
  },
  {
    name: 'setkey',
    alias: ['addkey'],
    category: 'AI',
    desc: 'Add an AI provider key',
    usage: '.setkey groq gsk_xxx',
    owner: true,
    async run({ sock, m, args, prefix }) {
      const name = (args[0] || '').toLowerCase()
      const value = args.slice(1).join(' ').trim()

      if (!name || !value) {
        return m.reply(
          `🔑 Usage: *${prefix}setkey <provider> <key>*\n\n` +
            `Providers: ${Object.keys(PROVIDERS).join(', ')}\n\n` +
            `Example: *${prefix}setkey groq gsk_abc123...*\n\n` +
            `_Send this in a private chat with me. I delete the message immediately after saving._`
        )
      }
      if (!PROVIDERS[name]) {
        return m.reply(`❌ Unknown provider "${name}".\n\nValid: ${Object.keys(PROVIDERS).join(', ')}`)
      }

      // wipe the message containing the secret as fast as possible
      await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})

      await setKey(PROVIDERS[name].env, value)

      // prove the key works before claiming success
      await m.send(`🔑 Saved *${PROVIDERS[name].label}* key. Testing it...`)
      try {
        const res = await chat('Reply with exactly: OK', { provider: name, noFallback: true, maxTokens: 20 })
        await m.send(
          `✅ *${PROVIDERS[name].label}* is working.\n\n` +
            `Model: ${res.model}\nTest reply: ${res.text.slice(0, 60)}\n\n` +
            `_Your original message with the key has been deleted._`
        )
      } catch (e) {
        await m.send(
          `⚠️ Key saved but the test failed:\n${e.message.slice(0, 300)}\n\n` +
            `Check the key is correct and has credit. Remove it with *${prefix}delkey ${name}*.`
        )
      }
    }
  },
  {
    name: 'delkey',
    alias: ['removekey'],
    category: 'AI',
    desc: 'Remove an AI provider key',
    usage: '.delkey groq',
    owner: true,
    async run({ m, args }) {
      const name = (args[0] || '').toLowerCase()
      if (!PROVIDERS[name]) return m.reply(`❌ Valid providers: ${Object.keys(PROVIDERS).join(', ')}`)
      await clearKey(PROVIDERS[name].env)
      await m.reply(`🗑️ Removed the *${PROVIDERS[name].label}* key.\n\n_If it is also set in .env it stays active until you remove it there._`)
    }
  },
  {
    name: 'aistatus',
    alias: ['aitest'],
    category: 'AI',
    desc: 'Test every configured AI provider',
    usage: '.aistatus',
    cooldown: 20,
    async run({ m, prefix }) {
      const list = available()
      if (!list.length) {
        return m.reply(
          `🤖 *AI STATUS*\n\n` +
            `No API keys configured — running on the free keyless fallback.\n\n` +
            `Run *${prefix}aikeys* for free options (Groq and Gemini are both free and excellent).`
        )
      }
      await m.react('⏳')
      const msg = await m.reply(`🤖 Testing ${list.length} provider${list.length > 1 ? 's' : ''}...`)
      const results = []
      for (const name of list) {
        const t0 = Date.now()
        try {
          const res = await chat('Reply with exactly: OK', { provider: name, noFallback: true, maxTokens: 20 })
          results.push(`✅ *${PROVIDERS[name].label}* — ${Date.now() - t0}ms\n   ${res.model}`)
        } catch (e) {
          results.push(`❌ *${PROVIDERS[name].label}* — ${String(e.message).slice(0, 70)}`)
        }
      }
      await m.reply(`🤖 *AI STATUS*\n\n${results.join('\n\n')}\n\n_Requests use the highest-quality working provider first._`)
      await m.react('✅')
    }
  },

  /* ---------------- text utilities ---------------- */
  {
    name: 'translate',
    alias: ['tr'],
    category: 'AI',
    desc: 'Translate text with AI',
    usage: '.translate french | good morning',
    cooldown: 5,
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('🌍 Usage: *.translate spanish | how are you*')
      const [langRaw, ...rest] = body.split('|')
      const target = rest.length ? langRaw.trim() : 'English'
      const source = rest.length ? rest.join('|').trim() : body
      await m.react('🌍')
      try {
        const res = await chat(
          `Translate the following into ${target}. Reply with only the translation, nothing else.\n\n${source}`,
          { temperature: 0.2 }
        )
        await m.reply(`🌍 *${target}*\n\n${res.text.slice(0, 3000)}`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'summarize',
    alias: ['summary', 'tldr'],
    category: 'AI',
    desc: 'Summarise long text',
    usage: '.summarize (reply to a long message)',
    cooldown: 6,
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('📝 Reply to a long message with *.summarize*')
      if (body.length < 120) return m.reply('📝 That is already short enough.')
      await m.react('📝')
      try {
        const res = await chat(`Summarise this in a few clear bullet points:\n\n${body.slice(0, 8000)}`, {
          temperature: 0.3
        })
        await m.reply(`📝 *SUMMARY*\n\n${res.text.slice(0, 3000)}`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'grammar',
    alias: ['fix', 'proofread'],
    category: 'AI',
    desc: 'Fix spelling and grammar',
    usage: '.grammar (reply to text)',
    cooldown: 5,
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('✍️ Reply to a message with *.grammar*')
      await m.react('✍️')
      try {
        const res = await chat(
          `Correct the spelling and grammar. Reply with only the corrected text.\n\n${body.slice(0, 4000)}`,
          { temperature: 0.2 }
        )
        await m.reply(`✍️ *CORRECTED*\n\n${res.text.slice(0, 3000)}`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'imagine',
    alias: ['img2', 'aiimage', 'dalle'],
    category: 'AI',
    desc: 'Generate an image from a description',
    usage: '.imagine a cat astronaut on mars',
    cooldown: 15,
    async run({ m, text }) {
      const prompt = text || m.quoted?.text
      if (!prompt) return m.reply('🎨 Usage: *.imagine a neon city in the rain*')
      await m.react('🎨')
      try {
        const url =
          `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
          `?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`
        const buffer = await getBuffer(url, { timeout: 120_000 })
        if (buffer.length < 5000) throw new Error('the image service returned nothing')
        await m.reply({ image: buffer, caption: `🎨 *${prompt.slice(0, 200)}*` })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
