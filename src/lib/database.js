import { MongoClient } from 'mongodb'
import fs from 'fs'
import path from 'path'
import config, { ROOT } from '../config.js'
import log from './logger.js'

/**
 * Thin storage layer with three interchangeable backends.
 *
 *   MONGO_URI     -> MongoDB          (recommended: schemaless, no migrations)
 *   SUPABASE_URL  -> Supabase/Postgres (each collection is a jsonb table)
 *   neither       -> JSON files in ./data so a fresh clone still boots
 *
 * Every backend implements the same seven methods, so plugins never know
 * or care which one is active.
 */

let client = null
let db = null
let usingMongo = false
let supa = null
let usingSupabase = false

const FILE_DIR = path.join(ROOT, 'data')

/* --------------------------- file fallback --------------------------- */

function filePath(name) {
  if (!fs.existsSync(FILE_DIR)) fs.mkdirSync(FILE_DIR, { recursive: true })
  return path.join(FILE_DIR, `${name}.json`)
}

function fileRead(name) {
  const p = filePath(name)
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return []
  }
}

function fileWrite(name, rows) {
  fs.writeFileSync(filePath(name), JSON.stringify(rows, null, 2))
}

const matches = (row, query) =>
  Object.entries(query).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k])
    return row[k] === v
  })

/* ------------------------------ connect ------------------------------ */

export async function connectDB() {
  /* ---- Supabase (Postgres) ---- */
  if (!config.mongoUri && config.supabaseUrl && config.supabaseKey) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      supa = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: false }
      })
      // a trivial read proves both the URL and the key are valid
      const { error } = await supa.from('vars').select('key').limit(1)
      if (error) throw new Error(error.message)
      usingSupabase = true
      log.ok('Supabase connected')
      return supa
    } catch (e) {
      log.error('Supabase connection failed:', e.message)
      if (/does not exist|schema cache|relation/i.test(e.message)) {
        log.warn('Run the SQL in docs/supabase-schema.sql to create the tables.')
      }
      log.warn('Falling back to local JSON storage in ./data')
      usingSupabase = false
      supa = null
      return null
    }
  }

  if (!config.mongoUri) {
    log.warn('No MONGO_URI set - falling back to local JSON storage in ./data')
    usingMongo = false
    return null
  }
  try {
    client = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 15000,
      retryWrites: true
    })
    await client.connect()
    db = client.db(config.mongoDb)
    await db.command({ ping: 1 })
    usingMongo = true
    log.ok(`MongoDB connected -> ${config.mongoDb}`)
    return db
  } catch (e) {
    log.error('MongoDB connection failed:', e.message)
    log.warn('Falling back to local JSON storage in ./data')
    usingMongo = false
    client = null
    db = null
    return null
  }
}

export const isMongo = () => usingMongo
export const isSupabase = () => usingSupabase
/** Human-readable name of the active backend, for .stats and boot logs. */
export const backend = () => (usingMongo ? 'MongoDB' : usingSupabase ? 'Supabase' : 'JSON files')

export async function closeDB() {
  if (client) await client.close().catch(() => {})
}

/* --------------------------- supabase helpers ------------------------ *
 *
 * Every collection is one table: id text primary key, doc jsonb.
 * Keeping the document in jsonb preserves Mongo's schemaless behaviour, so
 * a plugin adding a new field never needs a Postgres migration.
 */

/** Deterministic primary key derived from the query that identifies a doc. */
const supaKey = (query) =>
  Object.keys(query).length
    ? Object.entries(query)
        .filter(([, v]) => typeof v !== 'object')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('|')
    : '__singleton__'

async function supaFind(name, query = {}) {
  const { data, error } = await supa.from(name).select('doc')
  if (error) {
    log.error(`Supabase read (${name}):`, error.message)
    return []
  }
  return (data || []).map((r) => r.doc).filter((d) => d && matches(d, query))
}

async function supaSet(name, query, patch) {
  const existing = (await supaFind(name, query))[0] || {}
  const doc = { ...existing, ...query, ...patch }
  const { error } = await supa.from(name).upsert({ id: supaKey(query), doc }, { onConflict: 'id' })
  if (error) log.error(`Supabase write (${name}):`, error.message)
}

async function supaDelete(name, query) {
  // delete by primary key when the query fully identifies a row
  const key = supaKey(query)
  const { error } = await supa.from(name).delete().eq('id', key)
  if (!error) return
  // otherwise fall back to matching in memory
  const rows = await supaFind(name, query)
  for (const r of rows) {
    await supa.from(name).delete().eq('id', supaKey(r)).catch?.(() => {})
  }
}

/* ---------------------------- collections ---------------------------- */

/**
 * Returns a tiny CRUD wrapper that behaves the same on Mongo and on files.
 * @param {string} name collection name
 */
export function collection(name) {
  return {
    async find(query = {}) {
      if (usingMongo) return db.collection(name).find(query).toArray()
      if (usingSupabase) return supaFind(name, query)
      return fileRead(name).filter((r) => matches(r, query))
    },

    async findOne(query = {}) {
      if (usingMongo) return db.collection(name).findOne(query)
      if (usingSupabase) return (await supaFind(name, query))[0] || null
      return fileRead(name).find((r) => matches(r, query)) || null
    },

    /** upsert by `query`, merging `data` into the document */
    async set(query, data) {
      if (usingMongo) {
        await db.collection(name).updateOne(query, { $set: { ...query, ...data } }, { upsert: true })
        return
      }
      if (usingSupabase) return supaSet(name, query, data)
      const rows = fileRead(name)
      const i = rows.findIndex((r) => matches(r, query))
      if (i === -1) rows.push({ ...query, ...data })
      else rows[i] = { ...rows[i], ...data }
      fileWrite(name, rows)
    },

    /** atomically add to a numeric field (balances, warns, xp...) */
    async inc(query, field, amount = 1) {
      if (usingMongo) {
        await db.collection(name).updateOne(query, { $inc: { [field]: amount }, $setOnInsert: query }, { upsert: true })
        return
      }
      if (usingSupabase) {
        const row = (await supaFind(name, query))[0]
        return supaSet(name, query, { [field]: (row?.[field] || 0) + amount })
      }
      const rows = fileRead(name)
      const i = rows.findIndex((r) => matches(r, query))
      if (i === -1) rows.push({ ...query, [field]: amount })
      else rows[i][field] = (rows[i][field] || 0) + amount
      fileWrite(name, rows)
    },

    async delete(query) {
      if (usingMongo) {
        await db.collection(name).deleteMany(query)
        return
      }
      if (usingSupabase) return supaDelete(name, query)
      fileWrite(name, fileRead(name).filter((r) => !matches(r, query)))
    },

    async all() {
      if (usingMongo) return db.collection(name).find({}).toArray()
      if (usingSupabase) return supaFind(name, {})
      return fileRead(name)
    },

    async count(query = {}) {
      if (usingMongo) return db.collection(name).countDocuments(query)
      if (usingSupabase) return (await supaFind(name, query)).length
      return fileRead(name).filter((r) => matches(r, query)).length
    }
  }
}

/* named collections used across plugins */
export const DB = {
  vars: collection('vars'),          // runtime config (.setvar)
  users: collection('users'),        // economy, xp, profile
  groups: collection('groups'),      // per-group settings (antilink, welcome...)
  warns: collection('warns'),
  notes: collection('notes'),
  banned: collection('banned'),
  sudo: collection('sudo'),
  afk: collection('afk'),
  antidelete: collection('antidelete'),
  session: collection('session'),    // baileys auth keys
  mods: collection('mods'),          // moderator tier below sudo
  filters: collection('filters'),    // autoreply keyword -> response
  customcmd: collection('customcmd') // user defined commands (.setcmd)
}

export default DB
