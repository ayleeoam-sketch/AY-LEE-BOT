import crypto from 'crypto'
import DB from './database.js'
import { getVar } from './vars.js'
import { addWallet } from './economy.js'
import { getRole, setRole, atLeast } from './roles.js'

/**
 * Affiliate / referral programme.
 *
 * Everyone gets a permanent code derived from their number, plus a share
 * link pointing at wherever you want new people to land (your repo, your
 * deploy page, your channel). A newcomer runs `.ref <code>` once; both
 * sides get coins, and hitting the milestone promotes the referrer to VIP.
 *
 * Codes are derived, not stored, so they are stable across restarts and
 * survive a database wipe. Claims are stored, so nobody claims twice.
 */

const clean = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '')

/**
 * Stable 6-character code for a number.
 * Salted with the bot's own namespace so codes from another deploy do not
 * silently resolve here.
 */
export function codeFor(number, salt = '') {
  const n = clean(number)
  if (!n) return ''
  const hash = crypto.createHash('sha256').update(`${salt}:${n}`).digest('hex')
  return `V${parseInt(hash.slice(0, 10), 16).toString(36).toUpperCase().slice(0, 5).padStart(5, '0')}`
}

/** Reverse a code back to a number by checking it against known users. */
export async function numberForCode(code, salt = '') {
  const wanted = String(code || '').trim().toUpperCase()
  if (!wanted) return ''

  // anyone the bot has ever seen: economy records, referral records, roles
  const seen = new Set()
  for (const row of await DB.users.all()) if (row.id) seen.add(String(row.id))
  for (const row of await DB.referrals.all()) {
    if (row.number) seen.add(String(row.number))
    if (row.by) seen.add(String(row.by))
  }
  for (const row of await DB.roles.all()) if (row.number) seen.add(String(row.number))

  for (const n of seen) if (codeFor(n, salt) === wanted) return n
  return ''
}

/** Referral record for a number, created on first read. */
export async function stats(number) {
  const n = clean(number)
  const row = (await DB.referrals.findOne({ number: n })) || {}
  const invited = await DB.referrals.find({ by: n })
  return {
    number: n,
    by: row.by || '',            // who invited them
    claimedAt: row.claimedAt || 0,
    invited: invited.map((r) => r.number),
    count: invited.length,
    earned: row.earned || 0
  }
}

/**
 * Claim a code. Enforces: code must resolve, cannot be your own, one claim
 * per person, ever, and no A-invites-B-invites-A loops.
 *
 * @returns {Promise<{ok:boolean, reason?:string, referrer?:string, reward:number, bonus:number, promoted?:boolean}>}
 */
export async function claim(number, code, salt = '') {
  const me = clean(number)
  const reward = Number(getVar('REF_REWARD')) || 0
  const bonus = Number(getVar('REF_BONUS')) || 0

  const mine = await stats(me)
  if (mine.by) return { ok: false, reason: 'already', reward, bonus }

  const referrer = await numberForCode(code, salt)
  if (!referrer) return { ok: false, reason: 'unknown', reward, bonus }
  if (referrer === me) return { ok: false, reason: 'self', reward, bonus }

  const theirs = await stats(referrer)
  if (theirs.by === me) return { ok: false, reason: 'loop', reward, bonus }

  await DB.referrals.set({ number: me }, { by: referrer, claimedAt: Date.now() })
  await DB.referrals.set(
    { number: referrer },
    { earned: (theirs.earned || 0) + reward }
  )

  if (reward) await addWallet(`${referrer}@s.whatsapp.net`, reward)
  if (bonus) await addWallet(`${me}@s.whatsapp.net`, bonus)

  // milestone: enough invites and you are VIP, unless already higher
  let promoted = false
  const target = Number(getVar('REF_VIP_AT')) || 0
  if (target > 0) {
    const after = await stats(referrer)
    if (after.count >= target && !atLeast(await getRole(referrer), 'vip')) {
      await setRole(referrer, 'vip', 'affiliate')
      promoted = true
    }
  }

  return { ok: true, referrer, reward, bonus, promoted }
}

/** Top referrers, most invites first. */
export async function leaderboard(limit = 10) {
  const rows = await DB.referrals.all()
  const counts = new Map()
  for (const r of rows) {
    if (!r.by) continue
    counts.set(String(r.by), (counts.get(String(r.by)) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([number, count]) => ({ number, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/** The share link for a code, built from the AFFILIATE_URL var. */
export function linkFor(code) {
  const base = String(getVar('AFFILIATE_URL') || '').trim()
  if (!base) return ''
  return base.includes('?') ? `${base}&ref=${code}` : `${base}?ref=${code}`
}

export default { codeFor, numberForCode, stats, claim, leaderboard, linkFor }
