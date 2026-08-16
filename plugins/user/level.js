import { prefixes } from '../../src/config.js'
import DB from '../../src/lib/database.js'
import { getUser, saveUser, comma, rand } from '../../src/lib/economy.js'
import { getBuffer } from '../../src/lib/api.js'

/**
 * Chat XP system - the single biggest retention feature a group bot has.
 *
 * Every plain message earns 1-5 XP (throttled to one grant per 20s so spam
 * does not cook the numbers, and commands do not count). Levels live on the
 * SAME users record as the economy, so both systems reinforce each other:
 * levelling up pays a coin bonus, and .profile already shows the level.
 *
 *   .rank [@user]  -> level card
 *   .topranks      -> leaderboard (group members in groups, global in DM)
 *
 * Toggle the announcements/grants with: .setvar level_up off
 */

// jid -> last grant timestamp
const lastGrant = new Map()
const GRANT_INTERVAL = 20_000

const isCommand = (body) => {
  const list = prefixes()
  if (list.includes('')) return true // no-prefix mode: everything is a command anyway
  return list.some((p) => p && body.startsWith(p))
}

async function grantChatXp(m) {
  const now = Date.now()
  if (now - (lastGrant.get(m.sender) || 0) < GRANT_INTERVAL) return null
  lastGrant.set(m.sender, now)

  const u = await getUser(m.sender)
  u.msgs = (u.msgs || 0) + 1
  u.xp += rand(1, 5)

  let leveledUp = false
  while (u.xp >= u.level * 100) {
    u.xp -= u.level * 100
    u.level++
    leveledUp = true
  }
  if (leveledUp) u.wallet += u.level * 50 // level-up coin bonus
  await saveUser(u)
  return leveledUp ? u.level : null
}

/** All users sorted best-first: level, then progress into the level. */
async function rankedUsers() {
  const rows = await DB.users.all()
  return rows.sort(
    (a, b) => (b.level || 1) * 100000 + (b.xp || 0) - ((a.level || 1) * 100000 + (a.xp || 0))
  )
}

const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`

function bar(xp, needed, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round((xp / needed) * size)))
  return '█'.repeat(filled) + '░'.repeat(size - filled)
}

export default [
  {
    name: 'levelsystem',
    hidden: true,
    async before({ sock, m, getVar }) {
      if (!getVar('LEVEL_UP')) return
      if (!m.body || m.fromMe || !m.sender) return
      if (isCommand(m.body)) return // chatting earns XP, commands do not

      const level = await grantChatXp(m)
      if (level === null) return

      await sock
        .sendMessage(
          m.chat,
          {
            text:
              `🏆 @${m.senderNumber} just reached *Level ${level}*!\n` +
              `+${level * 50} coins bonus added to your wallet 💰\n` +
              `_Check your card with .rank_`,
            mentions: [m.sender]
          },
          { quoted: m.raw }
        )
        .catch(() => {})
    }
  },
  {
    name: 'rank',
    alias: ['level', 'lvl', 'mylevel', 'rankcard'],
    category: 'USER',
    desc: 'See your level, XP and rank card',
    usage: '.rank [@user]',
    cooldown: 5,
    async run({ sock, m, args }) {
      const target =
        m.mentions?.[0] ||
        m.quoted?.sender ||
        (args[0] && /\d{6,}/.test(args[0]) ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : m.sender)

      try {
        const u = await getUser(target)
        const rows = await rankedUsers()
        const pos = rows.findIndex((r) => r.id === u.id)
        const needed = u.level * 100

        const caption =
          `╭━━━〔 *RANK CARD* 〕━━━╮\n` +
          `┃ 👤 @${target.split('@')[0]}\n` +
          `┃ 🎯 Level: *${u.level}*\n` +
          `┃ ⭐ ${bar(u.xp, needed)} ${comma(u.xp)}/${comma(needed)} XP\n` +
          `┃ 💬 Messages: ${comma(u.msgs || 0)}\n` +
          `┃ 🏅 Position: ${pos === -1 ? 'unranked' : `#${pos + 1}`}\n` +
          `╰━━━━━━━━━━━━━━━━━╯`

        const pp = await sock.profilePictureUrl(target, 'image').catch(() => null)
        const img = pp ? await getBuffer(pp).catch(() => null) : null
        await m.reply(img ? { image: img, caption, mentions: [target] } : { text: caption, mentions: [target] })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'topranks',
    alias: ['xpboard', 'toplv', 'levelboard'],
    category: 'USER',
    desc: 'Level leaderboard (top chatters)',
    usage: '.topranks',
    cooldown: 10,
    async run({ sock, m }) {
      try {
        let rows = await rankedUsers()
        let title = 'GLOBAL RANKS'

        if (m.isGroup) {
          // show only members of this group
          const meta = m.groupMetadata || (await sock.groupMetadata(m.chat).catch(() => null))
          if (meta) {
            const members = new Set(meta.participants.map((p) => (p.id || '').split('@')[0].split(':')[0]))
            rows = rows.filter((r) => members.has(r.id))
            title = `TOP RANKED - ${meta.subject}`.toUpperCase().slice(0, 40)
          }
        }

        rows = rows.filter((r) => (r.level || 1) > 1 || (r.xp || 0) > 0).slice(0, 10)
        if (!rows.length) {
          return m.reply('🏆 Nobody has any XP yet - just chat and you will level up!')
        }

        const text =
          `🏆 *${title}*\n\n` +
          rows
            .map(
              (r, i) =>
                `${medal(i)} @${r.id}\n` +
                `   🎯 Level ${r.level || 1}  ⭐ ${comma(r.xp || 0)}/${comma((r.level || 1) * 100)}  💬 ${comma(r.msgs || 0)}`
            )
            .join('\n\n') +
          `\n\n💡 Earn 1-5 XP for every message. Level ups pay coins!`

        await m.reply({ text, mentions: rows.map((r) => `${r.id}@s.whatsapp.net`) })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
