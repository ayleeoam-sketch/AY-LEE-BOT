import { MongoClient } from 'mongodb'
import fs from 'fs'
import path from 'path'
import config, { ROOT } from '../config.js'
import log from './logger.js'

/**
 * Thin storage layer.
 *
 *   MONGO_URI -> MongoDB, the supported backend
 *   unset     -> JSON files in ./data so a fresh clone still boots
 *
 * Both implement the same seven methods, so plugins never know which is
 * active. Mongo is what you should run: the bot's data is document-shaped
 * (nested inventories, per-group flag sets that plugins extend freely) and
 * Atlas M0 is free without ever sleeping.
 */

let client = null
let db = null
let usingMongo = false

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
    if (config.sharedCluster) {
      log.warn(
        `Using the shared built-in cluster. Your data lives in its own database ` +
          `(${config.mongoDb}), but anyone with this repo holds the credentials - ` +
          `run .setmongo <your uri> for a private one.`
      )
    }
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

/**
 * Try a URI without touching the live connection.
 * Used by .setmongo so we never save a URI that does not work.
 * @returns {Promise<{ok:boolean, error?:string, collections?:number, dbName:string}>}
 */
export async function testMongoUri(uri, dbName = config.mongoDb) {
  const probe = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
  try {
    await probe.connect()
    const target = probe.db(dbName)
    await target.command({ ping: 1 })
    const collections = (await target.listCollections().toArray()).length
    return { ok: true, collections, dbName }
  } catch (e) {
    return { ok: false, error: e.message, dbName }
  } finally {
    await probe.close().catch(() => {})
  }
}

/**
 * Swap the live database at runtime (.setmongo) with no restart.
 * On failure the previous connection is already closed, so the bot drops to
 * JSON files rather than writing to the wrong place.
 */
export async function reconnectDB(uri, dbName) {
  if (client) await client.close().catch(() => {})
  client = null
  db = null
  usingMongo = false

  config.mongoUri = String(uri || '').trim()
  if (dbName) config.mongoDb = dbName
  process.env.MONGO_URI = config.mongoUri
  if (dbName) process.env.MONGO_DB = dbName

  return connectDB()
}

/** Raw driver handle for admin work (stats, compaction). Null on JSON. */
export const rawDb = () => (usingMongo ? db : null)

export const isMongo = () => usingMongo
/** The URI currently in use (may hold credentials - mask before printing). */
export const currentUri = () => config.mongoUri
/** Human-readable name of the active backend, for .stats and boot logs. */
export const backend = () => (usingMongo ? 'MongoDB' : 'JSON files')

export async function closeDB() {
  if (client) await client.close().catch(() => {})
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
      return fileRead(name).filter((r) => matches(r, query))
    },

    async findOne(query = {}) {
      if (usingMongo) return db.collection(name).findOne(query)
      return fileRead(name).find((r) => matches(r, query)) || null
    },

    /** upsert by `query`, merging `data` into the document */
    async set(query, data) {
      if (usingMongo) {
        await db.collection(name).updateOne(query, { $set: { ...query, ...data } }, { upsert: true })
        return
      }
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
      fileWrite(name, fileRead(name).filter((r) => !matches(r, query)))
    },

    async all() {
      if (usingMongo) return db.collection(name).find({}).toArray()
      return fileRead(name)
    },

    async count(query = {}) {
      if (usingMongo) return db.collection(name).countDocuments(query)
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
  customcmd: collection('customcmd'), // user defined commands (.setcmd)
  roles: collection('roles'),        // staff ladder: admin/editor/mod/vip
  referrals: collection('referrals'), // affiliate programme claims
  tasks: collection('tasks'),        // reminders / scheduled messages
  school: collection('school'),      // classroom state (VENOM SCHOOL)
  attendance: collection('attendance'), // who showed up to each class
  voices: collection('voices'),          // saved voice-clone samples
  deploys: collection('deploys'),         // local copy of .pair session tokens
  hosted: collection('hosted')           // auto-deployed bots on the official hub
}

/** Underlying Mongo client (null on the JSON fallback). Used by the hub store. */
export const mongoClient = () => client

export default DB
