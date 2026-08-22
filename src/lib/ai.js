import axios from 'axios'
import config from '../config.js'
import DB from './database.js'
import { builtinKey } from '../builtin-keys.js'

/**
 * Multi-provider AI engine.
 *
 * Every provider below has a genuine free tier. Add whichever keys you have
 * to .env (or set them from WhatsApp with .setkey) and the bot automatically
 * uses the best one available, falling back down the chain if a provider is
 * down, rate-limited or out of credit.
 *
 * Nothing here is required — with no keys at all the keyless fallback still
 * answers, just less reliably.
 */

/* ------------------------------------------------------------------ *
 * Provider definitions
 * ------------------------------------------------------------------ */

export const PROVIDERS = {
  groq: {
    label: 'Groq',
    env: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    quality: 90,
    free: 'Generous free tier, extremely fast',
    signup: 'https://console.groq.com/keys'
  },

  gemini: {
    label: 'Gemini',
    env: 'GEMINI_API_KEY',
    dialect: 'gemini',
    model: 'gemini-2.0-flash',
    quality: 88,
    free: 'Free tier, very capable, handles images',
    signup: 'https://aistudio.google.com/apikey'
  },

  cerebras: {
    label: 'Cerebras',
    env: 'CEREBRAS_API_KEY',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'llama-3.3-70b',
    quality: 84,
    free: 'Free tier, fastest inference available',
    signup: 'https://cloud.cerebras.ai'
  },

 agentrouter: {
  label: 'AgentRouter',
  env: 'AGENTROUTER_API_KEY',
  url: 'https://co.agentrouter.org/v1/chat/completions',
  model: 'gpt-5.6-sol',
  quality: 95,
  free: 'AgentRouter',
  signup: 'https://co.agentrouter.org'
},

  openrouter: {
    label: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemma-4-31b-it:free',
    quality: 80,
    free: 'Many models marked :free, one key for all',
    signup: 'https://openrouter.ai/keys',
    headers: {
      'HTTP-Referer': 'https://github.com',
      'X-Title': 'VENOM MD BOT'
    }
  },

  mistral: {
    label: 'Mistral',
    env: 'MISTRAL_API_KEY',
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    quality: 76,
    free: 'Free experiment tier',
    signup: 'https://console.mistral.ai/api-keys'
  },

  cohere: {
    label: 'Cohere',
    env: 'COHERE_API_KEY',
    url: 'https://api.cohere.com/v2/chat',
    dialect: 'cohere',
    model: 'command-r-plus-08-2024',
    quality: 72,
    free: 'Free trial keys, good for chat',
    signup: 'https://dashboard.cohere.com/api-keys'
  },

  deepseek: {
    label: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    quality: 86,
    free: 'Paid but very cheap; strong at code and reasoning',
    signup: 'https://platform.deepseek.com/api_keys'
  },

  openai: {
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    quality: 92,
    free: 'Paid',
    signup: 'https://platform.openai.com/api-keys'
  }
}

/* ------------------------------------------------------------------ *
 * Key resolution
 * ------------------------------------------------------------------ */

const runtimeKeys = new Map()

export async function loadKeys() {
  try {
    const rows = await DB.vars.all()

    for (const row of rows) {
      if (row.key?.endsWith('_API_KEY') && row.value) {
        runtimeKeys.set(row.key, row.value)
      }
    }
  } catch {}
}

export function getKey(name) {
  const p = PROVIDERS[name]

  if (!p) return ''

  return (
    process.env[p.env] ||
    runtimeKeys.get(p.env) ||
    builtinKey(p.env) ||
    ''
  ).trim()
}

export async function setKey(envName, value) {
  runtimeKeys.set(envName, value)
  await DB.vars.set({ key: envName }, { value })
}

export async function clearKey(envName) {
  runtimeKeys.delete(envName)
  await DB.vars.delete({ key: envName })
}

export function available() {
  return Object.entries(PROVIDERS)
    .filter(([name]) => getKey(name))
    .sort((a, b) => b[1].quality - a[1].quality)
    .map(([name]) => name)
}

/* ------------------------------------------------------------------ *
 * Adapters
 * ------------------------------------------------------------------ */

async function callOpenAIStyle(p, key, messages, opts) {
  const { data } = await axios.post(
    p.url,
    {
      model: opts.model || p.model,
      messages,
      max_tokens: opts.maxTokens || 1500,
      temperature: opts.temperature ?? 0.7
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(p.headers || {})
      },
      timeout: opts.timeout || 90_000
    }
  )

  const out = data?.choices?.[0]?.message?.content

  if (!out?.trim()) {
    throw new Error('empty response')
  }

  return out.trim()
}

async function callGemini(p, key, messages, opts) {
  const system = messages.find(
    (m) => m.role === 'system'
  )?.content

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens || 1500,
      temperature: opts.temperature ?? 0.7
    }
  }

  if (system) {
    body.systemInstruction = {
      parts: [{ text: system }]
    }
  }

  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${
      opts.model || p.model
    }:generateContent?key=${key}`,
    body,
    {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: opts.timeout || 90_000
    }
  )

  const out = data?.candidates?.[0]?.content?.parts
    ?.map((x) => x.text)
    .join('')

  if (!out?.trim()) {
    const blocked = data?.promptFeedback?.blockReason

    throw new Error(
      blocked
        ? `blocked: ${blocked}`
        : 'empty response'
    )
  }

  return out.trim()
}

async function callCohere(p, key, messages, opts) {
  const { data } = await axios.post(
    p.url,
    {
      model: opts.model || p.model,
      messages,
      max_tokens: opts.maxTokens || 1500
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: opts.timeout || 90_000
    }
  )

  const out = data?.message?.content
    ?.map((c) => c.text)
    .join('')

  if (!out?.trim()) {
    throw new Error('empty response')
  }

  return out.trim()
}

/* ------------------------------------------------------------------ *
 * Keyless fallback
 * ------------------------------------------------------------------ */

async function callFree(messages, opts) {
  const attempts = [
    async () => {
      const { data } = await axios.post(
        'https://text.pollinations.ai/openai',
        {
          model: 'openai',
          messages
        },
        {
          timeout: 60_000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      return data?.choices?.[0]?.message?.content
    },

    async () => {
      const { data } = await axios.post(
        'https://text.pollinations.ai/openai',
        {
          model: 'mistral',
          messages
        },
        {
          timeout: 60_000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      return data?.choices?.[0]?.message?.content
    },

    async () => {
      const prompt = messages
        .map((m) => m.content)
        .join('\n')
        .slice(0, 1500)

      const { data } = await axios.get(
        `https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
        {
          timeout: 60_000,
          responseType: 'text'
        }
      )

      return typeof data === 'string'
        ? data
        : null
    }
  ]

  for (const attempt of attempts) {
    try {
      const out = await attempt()

      if (
        out?.trim() &&
        !out.includes('Payment Required')
      ) {
        return out.trim()
      }
    } catch {}
  }

  throw new Error(
    'free endpoints are rate-limited or paywalled'
  )
}

/* ------------------------------------------------------------------ *
 * Provider caller
 * ------------------------------------------------------------------ */

async function callProvider(
  name,
  messages,
  opts = {}
) {
  const p = PROVIDERS[name]
  const key = getKey(name)

  if (!p || !key) {
    throw new Error(`${name}: no key`)
  }

  if (p.dialect === 'gemini') {
    return callGemini(
      p,
      key,
      messages,
      opts
    )
  }

  if (p.dialect === 'cohere') {
    return callCohere(
      p,
      key,
      messages,
      opts
    )
  }

  return callOpenAIStyle(
    p,
    key,
    messages,
    opts
  )
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export async function chat(
  messages,
  opts = {}
) {
  if (typeof messages === 'string') {
    messages = [
      {
        role: 'user',
        content: messages
      }
    ]
  }

  if (opts.system) {
    messages = [
      {
        role: 'system',
        content: opts.system
      },
      ...messages
    ]
  }

  const chain = []

  if (
    opts.provider &&
    getKey(opts.provider)
  ) {
    chain.push(opts.provider)
  }

  for (const name of available()) {
    if (!chain.includes(name)) {
      chain.push(name)
    }
  }

  const errors = []

  for (const name of chain) {
    try {
      const text = await callProvider(
        name,
        messages,
        opts
      )

      return {
        text,
        provider: PROVIDERS[name].label,
        model:
          opts.model ||
          PROVIDERS[name].model
      }
    } catch (e) {
      const status =
        e.response?.status

      const detail =
        e.response?.data?.error?.message ||
        e.response?.data?.error ||
        e.response?.data?.message ||
        e.message ||
        'Unknown provider error'

      /*
       * IMPORTANT:
       * Do not truncate this anymore.
       * We need the complete provider error while debugging.
       */
      errors.push(
        `${PROVIDERS[name].label}: ${
          status || ''
        } ${String(detail)}`
      )
    }
  }

  /* -------------------------------------------------------------- *
   * Keyless fallback
   * -------------------------------------------------------------- */

  if (!opts.noFallback) {
    try {
      const text = await callFree(
        messages,
        opts
      )

      return {
        text,
        provider: 'Free (keyless)',
        model: 'pollinations'
      }
    } catch (e) {
      errors.push(
        `Free: ${e.message}`
      )
    }
  }

  const err = new Error(
    chain.length
      ? `Every AI provider failed.\n\n${errors.join(
          '\n'
        )}\n\n_Check *.aistatus*._`
      : 'No AI key is set, and the free keyless services are now paywalled or rate-limited.\n\n' +
        '*Fix this in 2 minutes — both are free:*\n\n' +
        '⚡ *Groq* — fastest, generous free tier\n' +
        '   https://console.groq.com/keys\n' +
        '   then: *.setkey groq gsk_xxx*\n\n' +
        '✨ *Gemini* — free, very capable\n' +
        '   https://aistudio.google.com/apikey\n' +
        '   then: *.setkey gemini AIza_xxx*\n\n' +
        '_Run *.aikeys* for all providers._'
  )

  err.providerErrors = errors

  throw err
}

/* ------------------------------------------------------------------ *
 * Convenience
 * ------------------------------------------------------------------ */

export async function ask(
  prompt,
  opts = {}
) {
  const { text } = await chat(
    prompt,
    opts
  )

  return text
}

/* ------------------------------------------------------------------ *
 * Conversation memory
 * ------------------------------------------------------------------ */

const HISTORY_LIMIT = 12

const histories = new Map()

export function history(jid) {
  return histories.get(jid) || []
}

export function remember(
  jid,
  role,
  content
) {
  const h =
    histories.get(jid) || []

  h.push({
    role,
    content
  })

  while (
    h.length > HISTORY_LIMIT
  ) {
    h.shift()
  }

  histories.set(jid, h)
}

export function forget(jid) {
  histories.delete(jid)
}

export default {
  PROVIDERS,
  chat,
  ask,
  available,
  getKey,
  setKey,
  clearKey,
  loadKeys,
  history,
  remember,
  forget
}
