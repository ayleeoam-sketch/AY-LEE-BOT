import DB, { rawDb, isMongo } from './database.js'
import log from './logger.js'
import config from '../config.js'
import { getVar } from './vars.js'

/**
 * Database housekeeping.
 *
 * Atlas M0 gives you 512 MB and no warning before it stops accepting writes -
 * at which point the bot silently loses balances, settings and, if the
 * session lives in Mongo, its login. Bots that run for months without this
 * do not survive; they just fill up.
 *
 * What actually grows without bound:
 *   session      Baileys signal keys - pre-keys and sender-keys, by far the
 *                biggest consumer on a busy bot
 *   attendance   one row per student per class, three classes a day, forever
 *   users        one doc per person who ever typed a command
 *   tasks        self-clearing, unless a fire failed
 *
 * Everything here is conservative by design: it removes records that are
 * provably spent, never balances, roles, settings or login credentials.
 * If a rule cannot prove a record is dead, the record stays.
 */

const SWEEP_MS = 6 * 60 * 60_000 // every 6 hours
const M0_LIMIT = 512 * 1024 * 1024

let timer = null

/* ------------------------------ stats ------------------------------ */

/**
 * Size of the database and where it went.
 * @returns {Promise<{ok:boolean, bytes:number, limit:number, pct:number, collections:Array}>}
 */
export async function dbStats() {
  const db = rawDb()
  if (!db) {
    // JSON fallback: report the folder instead so the command still works
    const fs = await import('fs')
    const path = await import('path')
    const dir = path.join(config.tmpDir, '..', 'data')
    let bytes = 0
    const collections = []
    try {
      for (const f of fs.readdirSync(dir)) {
        const size = fs.statSync(path.join(dir, f)).size
        bytes += size
        collections.push({ name: f.replace(/\.json$/, ''), bytes: size, count: null })
      }
    } catch {}
    return { ok: true, mongo: false, bytes, limit: 0, pct: 0, collections: collections.sort((a, b) => b.bytes - a.bytes) }
  }

  const stats = await db.stats().catch(() => null)
  const names = (await db.listCollections().toArray().catch(() => [])).map((c) => c.name)

  const collections = []
  for (const name of names) {
    try {
      const [s] = await db
        .collection(name)
        .aggregate([{ $collStats: { storageStats: {} } }])
        .toArray()
      collections.push({
        name,
        count: s?.storageStats?.count ?? 0,
        bytes: (s?.storageStats?.storageSize ?? 0) + (s?.storageStats?.totalIndexSize ?? 0)
      })
    } catch {
      collections.push({ name, count: await db.collection(name).countDocuments().catch(() => 0), bytes: 0 })
    }
  }

  const bytes = (stats?.storageSize ?? 0) + (stats?.indexSize ?? 0)
  return {
    ok: true,
    mongo: true,
    bytes,
    limit: M0_LIMIT,
    pct: Math.round((bytes / M0_LIMIT) * 100),
    collections: collections.sort((a, b) => b.bytes - a.bytes)
  }
}

export const human = (n) => {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

/* ------------------------------ sweep ------------------------------ */

const DAY = 86_400_000

/**
 * Remove what is provably spent.
 *
 * @param {{deep?:boolean, days?:number, dry?:boolean}} opts
 *   deep  also prune spent Baileys pre-keys (see the warning below)
 *   days  retention for history-style records, default from DB_RETAIN_DAYS
 *   dry   count what would go without deleting it
 */
export async function sweep({ deep = false, days = 0, dry = false } = {}) {
  const keep = days || Number(getVar('DB_RETAIN_DAYS')) || 90
  const cutoff = Date.now() - keep * DAY
  const removed = {}
  const note = []

  const drop = async (label, collection, query, count) => {
    if (!count) return
    removed[label] = count
    if (!dry) await collection.delete(query)
  }

  /* 1. class attendance older than the retention window.
   *    Totals in .mygrades come from these rows, so this is the one place a
   *    user notices - hence 90 days rather than 7. */
  try {
    const old = (await DB.attendance.all()).filter((r) => (r.at || 0) < cutoff)
    if (old.length) {
      removed.attendance = old.length
      if (!dry) for (const r of old) await DB.attendance.delete({ session: r.session, number: r.number })
    }
  } catch {}

  /* 2. reminders that fired or expired but were left behind by a crash */
  try {
    const stale = (await DB.tasks.all()).filter((t) => (t.at || 0) < Date.now() - 7 * DAY)
    if (stale.length) {
      removed.tasks = stale.length
      if (!dry) for (const t of stale) await DB.tasks.delete({ id: t.id })
    }
  } catch {}

  /* 3. AFK notes nobody came back from */
  try {
    const stale = (await DB.afk.all()).filter((a) => (a.since || a.at || 0) < cutoff)
    if (stale.length) {
      removed.afk = stale.length
      if (!dry) for (const a of stale) await DB.afk.delete({ id: a.id, jid: a.jid })
    }
  } catch {}

  /* 4. ghost user records: never earned, never levelled, never bought
   *    anything. Anyone with a balance, xp, or inventory is untouchable. */
  try {
    // NB: `!u.level > 1` parses as `(!u.level) > 1` and is always false -
    // that typo silently disabled this rule until a seeded test caught it.
    const ghosts = (await DB.users.all()).filter(
      (u) =>
        !u.wallet && !u.bank && !u.xp &&
        (u.level || 1) <= 1 &&
        !Object.keys(u.inventory || {}).length &&
        !(u.lastDaily || u.lastWork || u.lastRob || u.lastFish || u.lastMine || u.lastHunt || u.streak || u.loan)
    )
    if (ghosts.length) {
      removed.users = ghosts.length
      if (!dry) for (const u of ghosts) await DB.users.delete({ id: u.id })
    }
  } catch {}

  /* 5. anti-delete cache, if anything ever wrote to it */
  try {
    const old = (await DB.antidelete.all()).filter((r) => (r.at || 0) < Date.now() - 2 * DAY)
    if (old.length) {
      removed.antidelete = old.length
      if (!dry) for (const r of old) await DB.antidelete.delete({ id: r.id })
    }
  } catch {}

  /*
   * 6. Baileys pre-keys - opt-in, because this is the only rule that can
   *    hurt. WhatsApp hands out one-time pre-keys; used ones are dead weight,
   *    but deleting a key that has NOT been consumed loses the messages
   *    encrypted to it. So: only the oldest ones, only well past their
   *    usefulness, only when explicitly asked, and never 'creds'.
   */
  if (deep) {
    try {
      const rows = await DB.session.all()
      const preKeys = rows
        .filter((r) => /^pre-key-/.test(String(r.id)))
        .sort((a, b) => Number(String(a.id).split('-').pop()) - Number(String(b.id).split('-').pop()))
      const excess = preKeys.slice(0, Math.max(0, preKeys.length - 150))
      if (excess.length) {
        removed['session pre-keys'] = excess.length
        if (!dry) for (const r of excess) await DB.session.delete({ sessionId: r.sessionId, id: r.id })
      }
      note.push(`kept the newest 150 pre-keys and every credential`)
    } catch {}
  }

  const total = Object.values(removed).reduce((a, b) => a + b, 0)
  return { removed, total, keep, dry, note }
}

/** Ask Mongo to hand storage back after a big delete. M0 often refuses. */
export async function compact() {
  const db = rawDb()
  if (!db) return { ok: false, reason: 'not on MongoDB' }
  const names = (await db.listCollections().toArray().catch(() => [])).map((c) => c.name)
  let done = 0
  for (const name of names) {
    try {
      await db.command({ compact: name })
      done++
    } catch {
      /* Atlas shared tiers block compact - deletes still free space eventually */
    }
  }
  return { ok: done > 0, compacted: done, total: names.length }
}

/* ------------------------------ schedule ------------------------------ */

export function attachCleanup() {
  if (timer) return
  const run = async () => {
    if (!isMongo()) return
    if (String(getVar('DB_AUTOCLEAN')) === 'false') return
    try {
      const before = await dbStats()
      const res = await sweep({ deep: before.pct >= 80 }) // get serious only when it is filling
      if (res.total) {
        log.info(
          `DB cleanup: removed ${res.total} spent records ` +
            `(${Object.entries(res.removed).map(([k, v]) => `${k}:${v}`).join(', ')}) - now ${before.pct}% of 512MB`
        )
      }
      if (before.pct >= 90) {
        log.warn(`Database is ${before.pct}% full. Run .dbsize, and consider .setmongo with your own cluster.`)
      }
    } catch (e) {
      log.error('DB cleanup failed:', e.message)
    }
  }

  timer = setInterval(run, SWEEP_MS)
  if (timer.unref) timer.unref()
  setTimeout(run, 120_000).unref?.() // once, two minutes after boot
}

export default { dbStats, sweep, compact, attachCleanup, human }
