import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// src/lib -> repo root. Computed locally (not imported from config.js) so
// config.js can import this file without a circular dependency.
const ROOT = path.resolve(__dirname, '..', '..')

/**
 * Where a runtime-set MongoDB URI lives.
 *
 * Chicken-and-egg problem: a URI set from WhatsApp cannot be stored in the
 * database it is meant to open. So it goes to a small local file instead,
 * and (best effort) into .env as well, so a plain restart picks it up even
 * if the JSON file is cleaned.
 *
 * The file holds live credentials. It is gitignored - never commit it.
 */
export const STORE_FILE = path.join(ROOT, 'mongo.local.json')
const ENV_FILE = path.join(ROOT, '.env')

/** @returns {{uri:string, db:string, setAt?:string}} empty strings when unset */
export function readMongoOverride() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'))
    return {
      uri: String(raw.uri || '').trim(),
      db: String(raw.db || '').trim(),
      setAt: raw.setAt
    }
  } catch {
    return { uri: '', db: '' }
  }
}

/** Persist a URI set at runtime. Returns where it managed to write. */
export function writeMongoOverride(uri, dbName = '') {
  const written = []
  const payload = {
    uri: String(uri).trim(),
    db: String(dbName || '').trim(),
    setAt: new Date().toISOString(),
    note: 'Set with .setmongo from WhatsApp. Contains credentials - do not commit.'
  }
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2))
    written.push('mongo.local.json')
  } catch {}

  if (upsertEnv(payload)) written.push('.env')
  return written
}

/** Forget the runtime URI and fall back to .env / the built-in cluster. */
export function clearMongoOverride() {
  try {
    fs.unlinkSync(STORE_FILE)
  } catch {}
  upsertEnv({ uri: '', db: '' })
}

/** Rewrite MONGO_URI / MONGO_DB inside .env without disturbing the rest. */
function upsertEnv({ uri, db }) {
  try {
    let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : ''
    const set = (key, value) => {
      const line = `${key}=${value}`
      const re = new RegExp(`^${key}=.*$`, 'm')
      if (re.test(text)) text = text.replace(re, line)
      else text += `${text.endsWith('\n') || text === '' ? '' : '\n'}${line}\n`
    }
    set('MONGO_URI', uri)
    if (db) set('MONGO_DB', db)
    fs.writeFileSync(ENV_FILE, text)
    return true
  } catch {
    // read-only filesystem (some panels) - the JSON file still covers us
    return false
  }
}

/** Hide the password before showing a URI in chat or logs. */
export function maskMongoUri(uri) {
  if (!uri) return '(none)'
  return String(uri).replace(/\/\/([^:/@]+):([^@]+)@/, (_, user) => `//${user}:••••••••@`)
}

/** Cheap sanity check before we bother opening a socket. */
export function looksLikeMongoUri(uri) {
  return /^mongodb(\+srv)?:\/\/[^\s]+$/i.test(String(uri || '').trim())
}

/** Pull the default database name out of a URI path, if it has one. */
export function dbNameFromUri(uri) {
  try {
    const m = String(uri).match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i)
    return m ? decodeURIComponent(m[1]) : ''
  } catch {
    return ''
  }
}
