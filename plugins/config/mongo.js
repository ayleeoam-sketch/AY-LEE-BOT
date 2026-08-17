import {
  testMongoUri,
  reconnectDB,
  isMongo,
  backend,
  currentUri
} from '../../src/lib/database.js'
import {
  readMongoOverride,
  writeMongoOverride,
  clearMongoOverride,
  maskMongoUri,
  looksLikeMongoUri,
  dbNameFromUri
} from '../../src/lib/mongoStore.js'
import config from '../../src/config.js'
import { builtinKey } from '../../src/builtin-keys.js'

/**
 * Point the bot at your own MongoDB from WhatsApp, after it is already
 * hosted — no panel, no redeploy, no .env editing.
 *
 * The URI is tested first, saved to mongo.local.json (and .env when the
 * filesystem allows it), then the live connection is swapped in place.
 */

const USAGE =
  '🗄️ *Usage:* .setmongo <connection string>\n\n' +
  'Example:\n`.setmongo mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`\n\n' +
  'Optional database name as a second word:\n`.setmongo mongodb+srv://... mybotdb`\n\n' +
  '*Get a free one in 3 minutes:*\n' +
  '1. https://cloud.mongodb.com → free *M0* cluster\n' +
  '2. *Database Access* → add a user, copy the password\n' +
  '3. *Network Access* → allow `0.0.0.0/0`\n' +
  '4. *Connect → Drivers* → copy the string, replace `<db_password>`\n\n' +
  '_Send it in my DM. I delete your message the moment I read it._'

export default [
  {
    name: 'setmongo',
    alias: ['setmongouri', 'setdb', 'setdatabase'],
    category: 'CONFIG',
    desc: 'Point the bot at your own MongoDB, live',
    usage: '.setmongo mongodb+srv://user:pass@cluster.mongodb.net/',
    owner: true,
    async run({ sock, m, args, prefix }) {
      const uri = (args[0] || '').trim()
      if (!uri) return m.reply(USAGE.replaceAll('.setmongo', `${prefix}setmongo`))

      // The message holds a live password — get rid of it before anything else.
      await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})

      if (!looksLikeMongoUri(uri)) {
        return m.send(
          `❌ That does not look like a MongoDB URI.\n\nIt must start with *mongodb://* or *mongodb+srv://*\n\n${USAGE.replaceAll('.setmongo', `${prefix}setmongo`)}`
        )
      }
      if (uri.includes('<db_password>') || uri.includes('<password>')) {
        return m.send('❌ You left the placeholder in. Replace `<db_password>` with your real password first.')
      }

      const dbName = (args[1] || dbNameFromUri(uri) || config.mongoDb || 'venom').trim()

      await m.send(`🔌 Testing that connection (up to 15s)...`)
      const result = await testMongoUri(uri, dbName)
      if (!result.ok) {
        return m.send(
          `❌ *Could not connect.* Nothing was changed — the bot is still on ${backend()}.\n\n` +
            `\`\`\`${String(result.error).slice(0, 300)}\`\`\`\n\n` +
            `*Usual causes*\n` +
            `• *Network Access* is not set to \`0.0.0.0/0\` — hosts have no fixed IP\n` +
            `• wrong password, or \`<db_password>\` left in the string\n` +
            `• a password containing \`@ : / ? # [ ] %\` that needs URL-encoding\n` +
            `• the cluster is paused`
        )
      }

      const written = writeMongoOverride(uri, dbName)
      await reconnectDB(uri, dbName)

      await m.send(
        `✅ *Connected to your MongoDB.*\n\n` +
          `┃ 🗄️ Database: *${dbName}*\n` +
          `┃ 📦 Collections: *${result.collections}*\n` +
          `┃ 🔗 ${maskMongoUri(uri)}\n` +
          `┃ 💾 Saved to: *${written.length ? written.join(' + ') : 'memory only'}*\n` +
          `┃ ⚡ Live now — no restart needed\n\n` +
          (written.length
            ? `_It will still be here after a restart._`
            : `⚠️ _This filesystem is read-only, so I could not save it. It works until the next restart — put MONGO_URI in your panel's environment variables to make it permanent._`) +
          `\n\n_Your message with the password has been deleted._\n` +
          `_Undo any time with *${prefix}delmongo*._`
      )
    }
  },
  {
    name: 'getmongo',
    alias: ['mongo', 'dbinfo', 'getdb'],
    category: 'CONFIG',
    desc: 'Show which database the bot is using',
    usage: '.getmongo',
    owner: true,
    async run({ m, prefix }) {
      const override = readMongoOverride()
      const active = currentUri()
      const builtin = builtinKey('MONGO_URI')

      let source = 'none — using local JSON files in ./data'
      if (active && override.uri && active === override.uri) source = `set with *${prefix}setmongo*`
      else if (active && builtin && active === builtin) source = 'built-in shared cluster (src/builtin-keys.js)'
      else if (active) source = 'MONGO_URI from the environment / .env'

      await m.reply(
        `╭━━━〔 *DATABASE* 〕━━━╮\n` +
          `┃ 🗄️ Backend: *${backend()}*\n` +
          `┃ 📛 Database: *${config.mongoDb}*\n` +
          `┃ 🔗 ${maskMongoUri(active)}\n` +
          `┃ 📍 Source: ${source}\n` +
          (override.setAt ? `┃ 🕒 Set: ${new Date(override.setAt).toLocaleString()}\n` : '') +
          `╰━━━━━━━━━━━━━━━━╯\n\n` +
          (isMongo()
            ? `_Data survives restarts._`
            : `⚠️ _Running on JSON files — most hosts wipe these on redeploy. Fix it with *${prefix}setmongo <uri>*._`) +
          `\n\nChange it: *${prefix}setmongo <uri>*`
      )
    }
  },
  {
    name: 'delmongo',
    alias: ['resetmongo', 'unsetmongo'],
    category: 'CONFIG',
    desc: 'Forget your MongoDB and go back to the default',
    usage: '.delmongo',
    owner: true,
    async run({ m, prefix }) {
      const override = readMongoOverride()
      if (!override.uri) return m.reply(`ℹ️ No custom URI is saved. Nothing to reset.`)

      clearMongoOverride()

      const fallback = builtinKey('MONGO_URI')
      if (fallback) {
        const res = await testMongoUri(fallback, builtinKey('MONGO_DB') || 'venom')
        if (res.ok) {
          await reconnectDB(fallback, builtinKey('MONGO_DB') || 'venom')
          return m.reply(
            `♻️ Your URI has been removed.\n\nBack on the built-in shared cluster — *${backend()}*.\n\n` +
              `_Your own database was not touched; its data is still there if you *${prefix}setmongo* again._`
          )
        }
      }
      await reconnectDB('', config.mongoDb)
      await m.reply(
        `♻️ Your URI has been removed. Now on *${backend()}*.\n\n` +
          `_Set a new one with *${prefix}setmongo <uri>*._`
      )
    }
  }
]
