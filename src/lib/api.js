import axios from 'axios'

/**
 * Shared HTTP helper for every plugin that touches the internet.
 *
 * Third-party free APIs go down constantly. Everything here fails soft:
 * plugins get a clear Error they can show the user instead of crashing.
 */
export const http = axios.create({
  timeout: 25_000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
  },
  maxRedirects: 5,
  validateStatus: (s) => s >= 200 && s < 400
})

/** GET JSON with a friendly error. */
export async function getJson(url, options = {}) {
  try {
    const { data } = await http.get(url, options)
    return data
  } catch (e) {
    throw new Error(friendly(e))
  }
}

/** GET raw bytes (images, audio, video). */
export async function getBuffer(url, options = {}) {
  try {
    const { data } = await http.get(url, { ...options, responseType: 'arraybuffer' })
    return Buffer.from(data)
  } catch (e) {
    throw new Error(friendly(e))
  }
}

/** Try several endpoints in order; first success wins. */
export async function race(sources) {
  const errors = []
  for (const fn of sources) {
    try {
      const result = await fn()
      if (result) return result
    } catch (e) {
      errors.push(e.message)
    }
  }
  throw new Error(`All sources failed. ${errors[0] || ''}`.trim())
}

function friendly(e) {
  if (e.code === 'ECONNABORTED') return 'The service took too long to respond.'
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return 'Could not reach the service (network/DNS).'
  const s = e.response?.status
  if (s === 404) return 'Nothing found for that query.'
  if (s === 429) return 'Rate limited - try again in a minute.'
  if (s >= 500) return 'The service is having problems right now.'
  return e.message || 'Request failed.'
}

export default { http, getJson, getBuffer, race }
