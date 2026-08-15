import DB from './database.js'

/** Currency + item definitions shared by every ECONOMY plugin. */
export const CURRENCY = '💰'
export const NAME = 'coins'

export const SHOP = {
  fishingrod: { price: 500, emoji: '🎣', desc: 'Required for .fish' },
  pickaxe: { price: 750, emoji: '⛏️', desc: 'Required for .mine' },
  rifle: { price: 1000, emoji: '🔫', desc: 'Required for .hunt' },
  laptop: { price: 5000, emoji: '💻', desc: 'Boosts .work earnings by 50%' },
  lockpick: { price: 2500, emoji: '🗝️', desc: 'Improves .rob success' },
  vault: { price: 10000, emoji: '🏦', desc: 'Protects 50% of your wallet from robbery' },
  car: { price: 25000, emoji: '🚗', desc: 'Flex item' },
  house: { price: 100000, emoji: '🏠', desc: 'Flex item' },
  yacht: { price: 500000, emoji: '🛥️', desc: 'Ultimate flex' }
}

const DEFAULTS = {
  wallet: 0,
  bank: 0,
  bankLimit: 10000,
  inventory: {},
  lastDaily: 0,
  lastWork: 0,
  lastRob: 0,
  lastBeg: 0,
  lastCrime: 0,
  lastFish: 0,
  lastMine: 0,
  lastHunt: 0,
  lastHeist: 0,
  streak: 0,
  loan: 0,
  xp: 0,
  level: 1
}

/** Fetch a user's economy record, creating it on first use. */
export async function getUser(jid) {
  const id = jid.split('@')[0].split(':')[0]
  const row = (await DB.users.findOne({ id })) || {}
  return { id, ...DEFAULTS, ...row, inventory: row.inventory || {} }
}

export async function saveUser(user) {
  const { id, ...data } = user
  await DB.users.set({ id }, data)
}

/** Add (or remove, with a negative amount) coins from the wallet. */
export async function addWallet(jid, amount) {
  const u = await getUser(jid)
  u.wallet = Math.max(0, u.wallet + amount)
  await saveUser(u)
  return u.wallet
}

export const netWorth = (u) =>
  u.wallet + u.bank + Object.entries(u.inventory).reduce(
    (sum, [item, qty]) => sum + (SHOP[item]?.price || 0) * qty, 0
  )

/** Cooldown helper: returns remaining ms, 0 when ready. */
export function cooldownLeft(last, durationMs) {
  const left = last + durationMs - Date.now()
  return left > 0 ? left : 0
}

export function prettyTime(ms) {
  const s = Math.ceil(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

export const COOLDOWNS = {
  daily: 24 * 60 * 60 * 1000,
  work: 60 * 60 * 1000,
  rob: 2 * 60 * 60 * 1000,
  beg: 5 * 60 * 1000,
  crime: 90 * 60 * 1000,
  fish: 10 * 60 * 1000,
  mine: 15 * 60 * 1000,
  hunt: 20 * 60 * 1000,
  heist: 6 * 60 * 60 * 1000
}

/** XP + automatic level ups. */
export async function addXp(jid, amount) {
  const u = await getUser(jid)
  u.xp += amount
  const needed = u.level * 100
  let leveled = false
  while (u.xp >= u.level * 100) {
    u.xp -= u.level * 100
    u.level++
    leveled = true
  }
  await saveUser(u)
  return { leveled, level: u.level }
}

export const comma = (n) => Number(n || 0).toLocaleString('en-US')
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

export default { getUser, saveUser, addWallet, netWorth, cooldownLeft, prettyTime, COOLDOWNS, SHOP, CURRENCY, NAME, addXp, comma, rand }
