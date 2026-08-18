import config from '../config.js'
import DB, { mongoClient, isMongo } from './database.js'
import { hostedList } from './hosted.js'

/**
 * Fleet totals across every VENOM deploy that still uses the shared cluster
 * (hub-hosted bots AND people who launched on Render / Railway / a panel).
 *
 * Each of those bots writes into its own database: venom_<owner>.
 * Unique users = union of every `users` collection we can see.
 */

const skipDb = (name) =>
  /^(admin|local|config|venom_test|venom_hub)$/i.test(name) || name.startsWith('test')

export async function thisBotCounts() {
  const [users, groups, hosted, deploys] = await Promise.all([
    DB.users.count({}),
    DB.groups.count({}),
    DB.hosted.count({}),
    DB.deploys.count({})
  ])
  return { users, groups, hosted, deploys, db: config.mongoDb }
}

export async function fleetStats() {
  const local = await thisBotCounts()
  const liveHosted = hostedList().filter((h) => h.alive)
  const unique = new Set()
  const bots = []

  const addUsers = (rows, dbName) => {
    let n = 0
    for (const row of rows) {
      const id = String(row.id || row.number || '').replace(/[^0-9]/g, '')
      if (!id) continue
      unique.add(id)
      n++
    }
    bots.push({ db: dbName, users: n })
  }

  if (!isMongo() || !mongoClient()) {
    const rows = await DB.users.all()
    addUsers(rows, local.db || 'local')
    return {
      mongo: false,
      bots,
      botCount: 1,
      usersHere: local.users,
      usersUnique: unique.size,
      groupsHere: local.groups,
      hostedAlive: liveHosted.length,
      hostedSaved: local.hosted,
      tokens: local.deploys,
      db: local.db
    }
  }

  const client = mongoClient()
  let names = [config.mongoDb]
  try {
    const listed = await client.db().admin().listDatabases({ nameOnly: true })
    names = (listed.databases || []).map((d) => d.name).filter((n) => !skipDb(n))
    if (!names.includes(config.mongoDb)) names.push(config.mongoDb)
  } catch {
    /* Atlas user may not be allowed to list DBs — still count this one + known siblings */
    names = [config.mongoDb]
  }

  for (const name of names) {
    try {
      const rows = await client.db(name).collection('users').find({}, { projection: { id: 1, number: 1 } }).toArray()
      addUsers(rows, name)
    } catch {
      /* empty or no users collection */
    }
  }

  let tokens = local.deploys
  try {
    tokens = await client.db('venom_hub').collection('sessions').countDocuments()
  } catch {
    /* hub db may not exist yet */
  }

  const here = bots.find((b) => b.db === config.mongoDb)?.users || local.users

  return {
    mongo: true,
    bots: bots.sort((a, b) => b.users - a.users),
    botCount: bots.length,
    usersHere: here,
    usersUnique: unique.size,
    groupsHere: local.groups,
    hostedAlive: liveHosted.length,
    hostedSaved: local.hosted,
    tokens,
    db: local.db
  }
}

export function formatFleet(stats) {
  const extra = Math.max(0, stats.usersUnique - stats.usersHere)
  return (
    `📊 *VENOM NETWORK*\n\n` +
    `╭━━━〔 *BOTS* 〕━━━╮\n` +
    `┃ 🤖 Deploys seen: *${stats.botCount}*\n` +
    `┃ 🟢 Hosted on this hub now: *${stats.hostedAlive}*\n` +
    `┃ 🎟️ Pair tokens minted: *${stats.tokens}*\n` +
    `┃ 🗄️ This bot: \`${stats.db}\`\n` +
    `╰━━━━━━━━━━━━━━━╯\n\n` +
    `╭━━━〔 *USERS* 〕━━━╮\n` +
    `┃ 👥 Unique people: *${stats.usersUnique.toLocaleString()}*\n` +
    `┃ 📍 On this bot: *${stats.usersHere.toLocaleString()}*\n` +
    `┃ 🌐 On other deploys: *${extra.toLocaleString()}*\n` +
    `┃ 🏘️ Groups here: *${stats.groupsHere}*\n` +
    `╰━━━━━━━━━━━━━━━╯\n\n` +
    `_Hosted bots live on THIS server — if this hub sleeps, they sleep._\n` +
    `_Render / Railway deploys keep running on their own and still count here._`
  )
}

export default { fleetStats, formatFleet, thisBotCounts }
