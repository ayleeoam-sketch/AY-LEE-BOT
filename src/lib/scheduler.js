import DB from './database.js'
import log from './logger.js'

/**
 * Persistent scheduler.
 *
 * Reminders and scheduled messages live in the database, not in a timer, so
 * they survive a restart, a redeploy and a crash. A tick every 20 seconds
 * fires whatever is due. That is plenty of resolution for "remind me in 10
 * minutes" and costs nothing.
 *
 * Anything that was due while the bot was offline fires on the next tick
 * with a note saying it is late - silently dropping a reminder is worse than
 * delivering it a few minutes behind.
 */

const TICK_MS = 20_000

let sock = null
let timer = null

/** Called once the socket is open. */
export function attachScheduler(socket) {
  sock = socket
  if (timer) return
  timer = setInterval(() => tick().catch((e) => log.error('Scheduler tick failed:', e.message)), TICK_MS)
  if (timer.unref) timer.unref()
  log.info('Scheduler running (reminders survive restarts)')
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * Parse a human duration: 10m, 2h30m, 45s, 1d, or "90" (minutes).
 * @returns {number} milliseconds, 0 when unparseable
 */
export function parseDuration(input) {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s) * 60_000 // bare number = minutes

  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  let total = 0
  let matched = false
  for (const [, amount, unit] of s.matchAll(/(\d+)\s*([smhdw])/g)) {
    total += Number(amount) * units[unit]
    matched = true
  }
  return matched ? total : 0
}

/** Human countdown: 5400000 -> "1h 30m" */
export function humanDelay(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m'
}

/**
 * Queue something to be sent later.
 *
 * @param {object} task
 * @param {string} task.chat    where to send it
 * @param {string} task.text    what to send
 * @param {number} task.at      epoch ms to fire at
 * @param {string} [task.owner] who asked for it (mentioned on delivery)
 * @param {string} [task.kind]  'reminder' | 'message'
 */
export async function schedule({ chat, text, at, owner = '', kind = 'reminder' }) {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase()
  await DB.tasks.set({ id }, { chat, text, at, owner, kind, created: Date.now() })
  return id
}

export async function listTasks(owner = '') {
  const all = await DB.tasks.all()
  const mine = owner ? all.filter((t) => t.owner === owner) : all
  return mine.sort((a, b) => a.at - b.at)
}

export async function cancelTask(id) {
  const row = await DB.tasks.findOne({ id: String(id).toUpperCase() })
  if (!row) return null
  await DB.tasks.delete({ id: row.id })
  return row
}

/** Fire everything that is due. Exported so tests can drive it directly. */
export async function tick(now = Date.now()) {
  if (!sock) return 0
  const due = (await DB.tasks.all()).filter((t) => t.at <= now)
  let sent = 0

  for (const task of due) {
    try {
      const late = now - task.at
      const body =
        task.kind === 'reminder'
          ? `⏰ *REMINDER*\n\n${task.text}` +
            (task.owner ? `\n\n_for @${task.owner}_` : '') +
            (late > 120_000 ? `\n\n_(late by ${humanDelay(late)} — the bot was offline)_` : '')
          : task.text

      await sock.sendMessage(task.chat, {
        text: body,
        mentions: task.owner ? [`${task.owner}@s.whatsapp.net`] : []
      })
      sent++
    } catch (e) {
      log.error(`Scheduled task ${task.id} failed:`, e.message)
    } finally {
      await DB.tasks.delete({ id: task.id })
    }
  }
  return sent
}

export default { attachScheduler, schedule, listTasks, cancelTask, parseDuration, humanDelay, tick }
