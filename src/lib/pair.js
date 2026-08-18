import fs from 'fs'
import os from 'os'
import path from 'path'
import makeWASocket, {
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers
} from 'baileys'
import { waLogger } from './logger.js'
import { saveSession } from './deployStore.js'

/**
 * Mint a brand-new WhatsApp session for someone else.
 *
 * A temporary Baileys socket (its own empty auth folder) requests a pairing
 * code. When WhatsApp marks it registered we read creds.json, store it under
 * a short token, and close the socket WITHOUT logging out — so the session
 * stays valid for their Render/Railway deploy.
 *
 * Never reuse the host bot's session directory.
 */

const jobs = new Map() // phone -> job
const MAX_JOBS = 4
const WAIT_MS = 150_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function activeJobs() {
  return [...jobs.values()].map((j) => ({ phone: j.phone, status: j.status, at: j.at }))
}

export function jobFor(phone) {
  return jobs.get(cleanPhone(phone)) || null
}

export function cleanPhone(n) {
  return String(n || '').replace(/[^0-9]/g, '')
}

function rmDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function readCreds(dir) {
  const credsPath = path.join(dir, 'creds.json')
  if (!fs.existsSync(credsPath)) return null
  try {
    const raw = fs.readFileSync(credsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed?.noiseKey && !parsed?.me) return null
    return { raw, parsed }
  } catch {
    return null
  }
}

/**
 * @param {{phone:string, ownerName?:string, onCode?:(pretty:string)=>void, onStatus?:(s:string)=>void}} opts
 * @returns {Promise<{ok:boolean, token?:string, sessionId?:string, code?:string, error?:string}>}
 */
export async function startPairing({ phone, ownerName = '', onCode, onStatus } = {}) {
  const number = cleanPhone(phone)
  if (number.length < 10 || number.length > 15) {
    return { ok: false, error: 'Give a full international number, digits only — e.g. 2348012345678' }
  }
  if (jobs.has(number)) {
    return { ok: false, error: 'A pairing for that number is already running. Wait for it to finish (about 2 minutes).' }
  }
  if (jobs.size >= MAX_JOBS) {
    return { ok: false, error: 'Too many people pairing right now. Try again in a minute.' }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venom-pair-'))
  const job = { phone: number, status: 'starting', at: Date.now(), dir, sock: null, codeRequested: false }
  jobs.set(number, job)

  const finish = (result) => {
    try {
      job.sock?.end(undefined)
    } catch {
      /* already closed */
    }
    rmDir(dir)
    jobs.delete(number)
    return result
  }

  try {
    onStatus?.('starting')
    const { state, saveCreds } = await useMultiFileAuthState(dir)
    const { version } = await fetchLatestBaileysVersion()
    const sock = makeWASocket({
      version,
      logger: waLogger,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    })
    job.sock = sock
    sock.ev.on('creds.update', saveCreds)

    const linked = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for the phone to confirm. Run *.pair* again.')),
        WAIT_MS
      )
      const done = (err) => {
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }
      const check = () => {
        if (state.creds?.registered) done()
      }
      sock.ev.on('creds.update', check)
      sock.ev.on('connection.update', (u) => {
        // Unpaired sockets flap "close" while they handshake. Ignore that
        // until we have actually handed the user a code — otherwise .pair
        // dies before the code is even shown.
        if (state.creds?.registered || u.connection === 'open') return done()
        if (job.codeRequested && u.connection === 'close' && !state.creds?.registered) {
          const status = u.lastDisconnect?.error?.output?.statusCode
          // 428 / 515 are "restart required" after a successful pair — treat as success if creds landed
          if (readCreds(dir) && (status === 515 || status === 428 || state.creds?.me)) return done()
          done(new Error('WhatsApp closed the pairing socket. Run *.pair* again.'))
        }
      })
    })

    // requesting too early makes WA reject the code
    await sleep(3000)
    const code = await sock.requestPairingCode(number)
    if (!code) throw new Error('WhatsApp did not give a pairing code. Try again in a minute.')
    const pretty = String(code).match(/.{1,4}/g)?.join('-') || String(code)
    job.status = 'waiting'
    job.code = pretty
    job.codeRequested = true
    await Promise.resolve(onCode?.(pretty)).catch(() => {})
    onStatus?.('waiting')

    await linked
    job.status = 'saving'
    onStatus?.('saving')

    await sleep(600)
    const creds = readCreds(dir)
    if (!creds) throw new Error('Pairing finished but no session file was written.')
    const sessionId = Buffer.from(creds.raw).toString('base64')
    const token = await saveSession({ phone: number, sessionId, ownerName })
    return finish({ ok: true, token, sessionId, code: pretty, phone: number })
  } catch (e) {
    return finish({ ok: false, error: e.message || String(e) })
  }
}

export default { startPairing, jobFor, activeJobs, cleanPhone }
