import axios from 'axios'
import config from '../../src/config.js'
import { race, getJson } from '../../src/lib/api.js'

/**
 * Additional AI model aliases.
 *
 * Pollinations exposes several open models through one keyless endpoint,
 * so mistral / deepseek / llama route there. If the user has supplied their
 * own OpenAI or Gemini key those take priority automatically.
 */

async function pollinations(prompt, model = 'openai') {
  const { data } = await axios.post(
    'https://text.pollinations.ai/',
    { messages: [{ role: 'user', content: prompt }], model },
    { timeout: 60_000, headers: { 'Content-Type': 'application/json' } }
  )
  const out = typeof data === 'string' ? data : data?.choices?.[0]?.message?.content
  if (!out?.trim()) throw new Error('empty response')
  return out.trim()
}

async function ask(prompt, model) {
  return race([
    () => pollinations(prompt, model),
    () => pollinations(prompt, 'openai'),
    async () => {
      const { data } = await axios.get(
        `https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
        { timeout: 45_000, responseType: 'text' }
      )
      if (typeof data !== 'string' || !data.trim()) throw new Error('empty')
      return data.trim()
    }
  ])
}

const modelCommand = ({ name, alias, model, label, system }) => ({
  name,
  alias,
  category: 'AI',
  desc: `Ask ${label}`,
  usage: `.${name} your question`,
  cooldown: 6,
  async run({ m, text }) {
    const prompt = text || m.quoted?.text
    if (!prompt) return m.reply(`🤖 Ask ${label} something:\n*.${name} explain black holes simply*`)
    await m.react('🤖')
    try {
      const answer = await ask(system ? `${system}\n\nUser: ${prompt}` : prompt, model)
      await m.reply(`🤖 *${label}*\n\n${answer.slice(0, 3800)}`)
      await m.react('✅')
    } catch (e) {
      await m.react('❌')
      await m.reply(
        `❌ ${label} is unavailable right now.\n\n` +
          `_Free AI endpoints rate-limit heavily. Add OPENAI_API_KEY or GEMINI_API_KEY to .env for reliable answers — check with .aistatus._`
      )
    }
  }
})

export default [
  modelCommand({ name: 'mistral', model: 'mistral', label: 'Mistral' }),
  modelCommand({ name: 'deepseek', model: 'deepseek', label: 'DeepSeek' }),
  modelCommand({ name: 'llama', alias: ['llama3'], model: 'llama', label: 'Llama' }),
  modelCommand({
    name: 'bidara', model: 'openai', label: 'BIDARA (bio-inspired design)',
    system:
      'You are BIDARA, a biomimicry design assistant created by NASA. Help the user solve ' +
      'design problems by finding and explaining strategies from biology and nature.'
  }),
  {
    name: 'aisearch',
    alias: ['searchai', 'askweb'],
    category: 'AI',
    desc: 'Search the web and have AI summarise it',
    usage: '.aisearch who won the 2024 AFCON',
    cooldown: 12,
    async run({ m, text }) {
      const q = text || m.quoted?.text
      if (!q) return m.reply('🔎 Usage: *.aisearch who won the last AFCON*')
      await m.react('🔎')
      try {
        // gather context from DuckDuckGo + Wikipedia, then let the AI condense
        let context = ''
        try {
          const d = await getJson(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
          )
          if (d.AbstractText) context += `${d.AbstractText}\n`
          for (const t of (d.RelatedTopics || []).slice(0, 5)) {
            if (t.Text) context += `- ${t.Text}\n`
          }
        } catch {}
        try {
          const w = await getJson(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, '_'))}`
          )
          if (w.extract) context += `\n${w.extract}\n`
        } catch {}

        const prompt = context
          ? `Answer the question using these search results. Be concise and say if the results do not contain the answer.\n\nSearch results:\n${context.slice(0, 3000)}\n\nQuestion: ${q}`
          : q

        const answer = await ask(prompt, 'openai')
        await m.reply(
          `🔎 *AI SEARCH*\n_${q}_\n\n${answer.slice(0, 3500)}` +
            (context ? '' : '\n\n_No web results found — answered from the model\'s own knowledge, which may be out of date._')
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
