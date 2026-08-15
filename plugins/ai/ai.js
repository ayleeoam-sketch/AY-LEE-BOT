import axios from 'axios'
import { getJson, race } from '../../src/lib/api.js'
import config from '../../src/config.js'

/**
 * AI chat.
 *
 * Uses your own API keys when present in .env (OPENAI_API_KEY / GEMINI_API_KEY).
 * Without keys it falls back to free keyless endpoints, which are less reliable
 * but keep the commands usable out of the box.
 */

async function openai(prompt, model = 'gpt-4o-mini') {
  if (!config.keys.openai) throw new Error('no key')
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model, messages: [{ role: 'user', content: prompt }], max_tokens: 1000 },
    { headers: { Authorization: `Bearer ${config.keys.openai}`, 'Content-Type': 'application/json' }, timeout: 60_000 }
  )
  return data.choices?.[0]?.message?.content
}

async function gemini(prompt) {
  if (!config.keys.gemini) throw new Error('no key')
  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.keys.gemini}`,
    { contents: [{ parts: [{ text: prompt }] }] },
    { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 }
  )
  return data.candidates?.[0]?.content?.parts?.[0]?.text
}

/** Keyless community endpoints - may rate limit or disappear. */
async function freeAI(prompt) {
  return race([
    async () => {
      const { data } = await axios.post(
        'https://text.pollinations.ai/',
        { messages: [{ role: 'user', content: prompt }], model: 'openai' },
        { timeout: 45_000, headers: { 'Content-Type': 'application/json' } }
      )
      return typeof data === 'string' ? data : data?.choices?.[0]?.message?.content
    },
    async () => {
      const { data } = await axios.get(
        `https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
        { timeout: 45_000, responseType: 'text' }
      )
      return typeof data === 'string' ? data : null
    }
  ])
}

/** Try the best available provider in order. */
async function ask(prompt, prefer = 'auto') {
  const chain = []
  if (prefer === 'gemini') chain.push(() => gemini(prompt))
  if (prefer === 'openai') chain.push(() => openai(prompt))
  if (config.keys.openai) chain.push(() => openai(prompt))
  if (config.keys.gemini) chain.push(() => gemini(prompt))
  chain.push(() => freeAI(prompt))

  for (const fn of chain) {
    try {
      const out = await fn()
      if (out?.trim()) return out.trim()
    } catch {}
  }
  throw new Error('All AI providers failed. Add OPENAI_API_KEY or GEMINI_API_KEY to .env for reliable results.')
}

const aiCommand = ({ name, alias, desc, prefer, system }) => ({
  name,
  alias,
  category: 'AI',
  desc,
  usage: `.${name} your question`,
  cooldown: 5,
  async run({ m, text }) {
    const prompt = text || m.quoted?.text
    if (!prompt) return m.reply(`🤖 Ask me something: *.${name} explain gravity simply*`)
    await m.react('🤖')
    try {
      const answer = await ask(system ? `${system}\n\nUser: ${prompt}` : prompt, prefer)
      await m.reply(answer.slice(0, 4000))
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(`❌ ${e.message}`)
    }
  }
})

export default [
  aiCommand({ name: 'ai', alias: ['chat', 'chatbot', 'askai'], desc: 'Ask the AI anything' }),
  aiCommand({ name: 'gpt', alias: ['openai', 'chatgpt'], desc: 'Ask ChatGPT', prefer: 'openai' }),
  aiCommand({ name: 'gemini', desc: 'Ask Google Gemini', prefer: 'gemini' }),
  aiCommand({
    name: 'coder',
    alias: ['code'],
    desc: 'Get help writing code',
    system: 'You are an expert programmer. Answer with clean, working code and a short explanation.'
  }),
  aiCommand({
    name: 'reasoning',
    alias: ['think'],
    desc: 'Ask for step-by-step reasoning',
    system: 'Think step by step and show your reasoning clearly before giving the final answer.'
  }),
  aiCommand({
    name: 'translate',
    alias: ['tr'],
    desc: 'Translate text into another language',
    system: 'You are a translator. Detect the input language and translate it. If the user names a target language, use it; otherwise translate to English. Reply with only the translation.'
  }),
  aiCommand({
    name: 'summarize',
    alias: ['tldr'],
    desc: 'Summarise a long message',
    system: 'Summarise the following clearly in at most 5 bullet points.'
  }),
  aiCommand({
    name: 'grammar',
    alias: ['fix'],
    desc: 'Fix grammar and spelling',
    system: 'Correct the grammar and spelling. Reply with only the corrected text.'
  }),
  {
    name: 'imagine',
    alias: ['aiimg', 'text2img', 'dalle'],
    category: 'AI',
    desc: 'Generate an image from a text prompt',
    usage: '.imagine a cat riding a bicycle',
    cooldown: 15,
    async run({ m, text }) {
      const prompt = text || m.quoted?.text
      if (!prompt) return m.reply('🎨 Describe an image: *.imagine a sunset over Lagos*')
      await m.react('🎨')
      try {
        const { getBuffer } = await import('../../src/lib/api.js')
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now() % 100000}`
        const buffer = await getBuffer(url, { timeout: 90_000 })
        if (buffer.length < 1000) throw new Error('empty image returned')
        await m.reply({ image: buffer, caption: `🎨 *${prompt}*` })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ Image generation failed: ${e.message}`)
      }
    }
  },
  {
    name: 'aistatus',
    category: 'AI',
    desc: 'Show which AI providers are configured',
    usage: '.aistatus',
    owner: true,
    async run({ m }) {
      await m.reply(
        `🤖 *AI PROVIDERS*\n\n` +
          `${config.keys.openai ? '✅' : '❌'} OpenAI (OPENAI_API_KEY)\n` +
          `${config.keys.gemini ? '✅' : '❌'} Gemini (GEMINI_API_KEY)\n` +
          `✅ Free fallback (pollinations)\n\n` +
          `Add keys to .env for faster, more reliable answers.`
      )
    }
  }
]
