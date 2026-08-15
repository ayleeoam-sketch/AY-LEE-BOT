import { MongoClient } from 'mongodb'
import fs from 'fs'
import path from 'path'
import config, { ROOT } from '../config.js'
import log from './logger.js'

/**
 * Thin storage layer.
 * Uses MongoDB when MONGO_URI is set, otherwise transparently falls back to
 * JSON files in ./data so the bot still boots on a fresh machine.
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
  session: collection('session')     // baileys auth keys
}

export default DB
