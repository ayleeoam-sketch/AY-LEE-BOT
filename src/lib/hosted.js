import { spawn } from 'child_process'
import path from 'path'
import config, { ROOT } from '../config.js'
import log from './logger.js'
import DB from './database.js'
import {
  isToken, readSession, decodeSessionId, phoneFromCreds, parseSessionPayload
} from './deployStore.js'

/**
 * Auto-deploy on the official hub.
 *
 * After someone pairs (or pastes a SESSION_ID) we spawn a child Node process
 * that is a full VENOM MD for *their* WhatsApp. Their data lives in
 * venom_<theirNumber>, so they never share the official bot's economy.
 *
 * The child binds no HTTP port (KEEP_ALIVE=false) so it cannot fight the hub
 * for $PORT. Logout only kills the child, never the official bot.
 */

const children = new Map() // phone -> { proc, startedAt, owner }

export function hostedList() {
  return [...children.entries()].map(([phone, row]) => ({
    phone,
    pid: row.proc?.pid || 0,
    alive: Boolean(row.proc && !row.proc.killed),
    startedAt: row.startedAt,
    owner: row.owner
  }))
}

export function isHosted(phone) {
  const n = String(phone || '').replace(/[^0-9]/g, '')
  const row = children.get(n)
  return Boolean(row?.proc && !row.proc.killed)
}

async function persist(phone, data) {
  await DB.hosted.set({ phone }, { ...data, phone, updatedAt: Date.now() })
}

/**
 * Turn a pasted token / SESSION_ID into { phone, sessionId }.
 */
export async function resolveDeployInput(text) {
  const parsed = parseSessionPayload(text)
  if (!parsed) return { ok: false, error: 'That is not a SESSION_TOKEN or a session ID.' }

  if (parsed.kind === 'token') {
    const row = await readSession(parsed.value)
    if (!row?.sessionId) return { ok: false, error: `Token ${parsed.value} was not found. Pair again with *.pair*.` }
    const creds = decodeSessionId(row.sessionId)
    const phone = row.phone || phoneFromCreds(creds)
    if (!phone) return { ok: false, error: 'That token has no phone number on it.' }
    return { ok: true, phone, sessionId: row.sessionId, token: parsed.value }
  }

  const phone = parsed.phone
  if (!phone) return { ok: false, error: 'That session ID has no WhatsApp number inside it. Pair again.' }
  return { ok: true, phone, sessionId: parsed.value }
}

/**
 * Launch (or replace) a hosted bot for this session.
 * @returns {{ok:boolean, phone?:string, error?:string, reused?:boolean}}
 */
export async function launchHost({ sessionId, phone, ownerName = '', ownerJid = '' } = {}) {
  const number = String(phone || '').replace(/[^0-9]/g, '')
  if (number.length < 10) return { ok: false, error: 'Need a phone number to host.' }
  if (!decodeSessionId(sessionId)) return { ok: false, error: 'That session ID is not valid.' }

  if (isHosted(number)) {
    await persist(number, { sessionId, ownerName, ownerJid, status: 'running' })
    return { ok: true, phone: number, reused: true }
  }

  const live = hostedList().filter((h) => h.alive)
  if (live.length >= config.maxHosted) {
    return {
      ok: false,
      error: `The hub is full (${live.length}/${config.maxHosted} bots). Try again later or deploy on Render with your SESSION_TOKEN.`
    }
  }

  const child = spawn(process.execPath, [path.join(ROOT, 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      OWNER_NUMBER: number,
      OWNER_NAME: ownerName || number,
      BOT_ID: number,
      SESSION_ID: sessionId,
      SESSION_TOKEN: '',
      PAIR_HUB: 'false',
      AUTH_METHOD: 'qr',
      KEEP_ALIVE: 'false',
      STARTUP_MESSAGE: 'true',
      FORCE_JOIN: 'true',
      VENOM_HOSTED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const prefix = `[host ${number}]`
  child.stdout.on('data', (d) => {
    const line = String(d).trim()
    if (line) log.info(prefix, line.slice(0, 240))
  })
  child.stderr.on('data', (d) => {
    const line = String(d).trim()
    if (line) log.warn(prefix, line.slice(0, 240))
  })
  child.on('exit', (code) => {
    log.warn(`${prefix} exited (${code})`)
    children.delete(number)
    persist(number, { sessionId, ownerName, ownerJid, status: 'stopped' }).catch(() => {})
  })

  children.set(number, { proc: child, startedAt: Date.now(), owner: ownerJid || number })
  await persist(number, { sessionId, ownerName, ownerJid, status: 'running', startedAt: Date.now() })
  log.ok(`Hosted bot started for ${number} (pid ${child.pid})`)
  return { ok: true, phone: number, pid: child.pid }
}

export async function stopHost(phone) {
  const number = String(phone || '').replace(/[^0-9]/g, '')
  const row = children.get(number)
  if (!row?.proc) return false
  try {
    row.proc.kill('SIGTERM')
  } catch {
    /* already dead */
  }
  children.delete(number)
  await persist(number, { status: 'stopped' })
  return true
}

/** Bring back hosted bots after the official hub restarts. */
export async function resumeHosts() {
  const rows = await DB.hosted.find({ status: 'running' })
  let started = 0
  for (const row of rows) {
    if (!row.sessionId || !row.phone) continue
    const r = await launchHost({
      sessionId: row.sessionId,
      phone: row.phone,
      ownerName: row.ownerName,
      ownerJid: row.ownerJid
    })
    if (r.ok) started++
  }
  if (started) log.ok(`Resumed ${started} hosted bot(s)`)
  return started
}

export { parseSessionPayload }
export default { launchHost, stopHost, hostedList, isHosted, resumeHosts, resolveDeployInput, parseSessionPayload }
