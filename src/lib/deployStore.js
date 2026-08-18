import crypto from 'crypto'
import axios from 'axios'
import config from '../config.js'
import DB, { mongoClient, isMongo } from './database.js'

/**
 * Short-lived session tokens minted by official *.pair*.
 *
 * Why a token instead of a 4 KB SESSION_ID:
 *   the user never copies creds. They paste SESSION_TOKEN=VNM-AB12CD
 *   into Render/Railway. The new bot pulls the session from the shared
 *   hub database (or the official site) on first boot.
 *
 * Hub data lives in database `venom_hub` on the shared cluster so every
 * deploy can read it, not just the official bot's private venom_<owner> db.
 */

const HUB_DB = 'venom_hub'
const TOKEN_RE = /^VNM-[A-Z0-9]{6}$/

export function makeToken() {
  const raw = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)
  return `VNM-${raw}`
}

export const isToken = (s) => TOKEN_RE.test(String(s || '').trim().toUpperCase())

/** Decode a base64 creds blob. Returns the parsed object or null. */
export function decodeSessionId(raw) {
  try {
    const json = Buffer.from(String(raw || '').trim(), 'base64').toString('utf-8')
    const parsed = JSON.parse(json)
    if (!parsed?.me && !parsed?.noiseKey) return null
    return parsed
  } catch {
    return null
  }
}

export function phoneFromCreds(creds) {
  const id = creds?.me?.id || creds?.me?.lid || ''
  return String(id).split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
}

/**
 * Pull a token or a raw SESSION_ID out of whatever the user pasted.
 * Never logs the blob — treat it like a password.
 */
export function parseSessionPayload(text) {
  const t = String(text || '').trim()
  if (!t) return null
  const tokenHit = t.toUpperCase().match(/\bVNM-[A-Z0-9]{6}\b/)
  if (tokenHit) return { kind: 'token', value: tokenHit[0] }

  const blob = t.match(/[A-Za-z0-9+/]{80,}={0,2}/)?.[0]
  if (!blob) return null
  const creds = decodeSessionId(blob)
  if (!creds) return null
  return { kind: 'session', value: blob, creds, phone: phoneFromCreds(creds) }
}

function hubCol() {
  const client = mongoClient()
  if (!client || !isMongo()) return null
  return client.db(HUB_DB).collection('sessions')
}

/** Save a freshly paired session. Returns the public token. */
export async function saveSession({ phone, sessionId, ownerName = '' }) {
  const token = makeToken()
  const row = {
    token,
    phone: String(phone || '').replace(/[^0-9]/g, ''),
    sessionId: String(sessionId || '').trim(),
    ownerName: String(ownerName || '').slice(0, 40),
    createdAt: Date.now(),
    usedAt: 0
  }
  if (!row.sessionId) throw new Error('no session to store')

  const col = hubCol()
  if (col) await col.updateOne({ token }, { $set: row }, { upsert: true })
  await DB.deploys.set({ token }, row)
  return token
}

/** Read a token. Marks it used so a stolen leftover is obvious in .pairstats. */
export async function readSession(token) {
  const key = String(token || '').trim().toUpperCase()
  if (!isToken(key)) return null

  const col = hubCol()
  let row = col ? await col.findOne({ token: key }) : null
  if (!row) row = await DB.deploys.findOne({ token: key })
  if (!row?.sessionId) return null

  const usedAt = Date.now()
  if (col) await col.updateOne({ token: key }, { $set: { usedAt } }).catch(() => {})
  await DB.deploys.set({ token: key }, { usedAt }).catch(() => {})
  return row
}

/**
 * Resolve a SESSION_TOKEN at boot.
 *  1. shared hub database (same cluster as this bot)
 *  2. official / this instance HTTP fallback
 */
export async function fetchSessionByToken(token, { hubUrl } = {}) {
  const local = await readSession(token)
  if (local?.sessionId) return local.sessionId

  const bases = [
    hubUrl,
    config.deployHubUrl,
    config.publicUrl
  ].filter(Boolean)

  for (const base of bases) {
    try {
      const { data } = await axios.get(`${String(base).replace(/\/$/, '')}/api/session/${token}`, {
        timeout: 20_000,
        headers: { Accept: 'application/json' },
        validateStatus: (s) => s >= 200 && s < 500
      })
      if (data?.sessionId) return data.sessionId
    } catch {
      /* try the next origin */
    }
  }
  return ''
}

export async function listRecent(limit = 15) {
  const col = hubCol()
  const rows = col
    ? await col.find({}).sort({ createdAt: -1 }).limit(limit).toArray()
    : (await DB.deploys.all()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit)
  return rows.map((r) => ({
    token: r.token,
    phone: r.phone,
    createdAt: r.createdAt,
    usedAt: r.usedAt || 0
  }))
}

export default {
  makeToken, isToken, saveSession, readSession, fetchSessionByToken, listRecent,
  decodeSessionId, phoneFromCreds, parseSessionPayload
}
