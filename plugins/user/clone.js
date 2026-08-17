/**
 * Profile cloning - make the bot look exactly like someone else.
 *
 *   .clone <number | @mention | reply>   copy their name, bio & profile picture
 *   .clonestatus <text>                  keep the cloned identity but set your own bio
 *   .cloneinfo                           show what the bot currently looks like
 *   .unclone                             restore the bot's original identity
 *
 * The bot's real identity (name, bio, profile picture) is captured in the DB
 * the FIRST time anything is changed, so .unclone always brings it back even
 * after a restart. Cloned profiles are cached per target, so re-cloning the
 * same person later is instant.
 *
 * Owner only - these commands change the bot account itself.
 *
 * Note: WhatsApp throttles profile changes. If you get an error while
 * clone/unclone spam-testing, wait a few minutes and try again.
 */
import { collection } from '../../src/lib/database.js'
import { toJid } from '../../src/lib/utils.js'
import { getBuffer } from '../../src/lib/api.js'
import { jidNormalizedUser } from 'baileys'

const clones = collection('clone')

/** WhatsApp's hard limit for the about/bio text */
const MAX_BIO = 139

/** The bot's own jid without the :device suffix - what WhatsApp APIs expect. */
const botJidOf = (sock) => jidNormalizedUser(sock.user?.id || '')

/* ------------------------------ helpers ------------------------------ */

/**
 * fetchStatus returns an array of { status, setAt, id } - one entry per jid
 * queried. Pick our target's entry out of it.
 */
async function fetchStatusOf(sock, jid) {
  const res = await sock.fetchStatus(jid)
  if (Array.isArray(res)) {
    const hit = res.find((r) => r?.id === jid)
    return typeof hit?.status === 'string' ? hit.status : null
  }
  return typeof res?.status === 'string' ? res.status : null
}

/** Save the bot's current identity once, as the restore point. */
async function captureOriginal(sock) {
  const row = await clones.findOne({ id: '__original__' })
  if (row?.captured) return

  const name = sock.user?.name || 'VENOM MD BOT'
  let bio = ''
  let pp = null
  try {
    const s = await fetchStatusOf(sock, botJidOf(sock))
    if (s) bio = s
  } catch {
    /* bio stays '' - never fatal */
  }
  try {
    pp = await sock.profilePictureUrl(botJidOf(sock), 'image')
  } catch {
    /* the bot may not have a picture yet */
  }
  await clones.set({ id: '__original__' }, { captured: true, name, bio, pp })
}

/**
 * A target's display name. WhatsApp does not expose push names over usync
 * (fetchStatus gives the BIO), so the name comes from:
 *   1. their own message - the pushName they signed it with ("clone me")
 *   2. the group roster - participants[].notify
 * Otherwise null -> the bot keeps its current name.
 */
async function fetchName(sock, m, jid) {
  if (jid === m.sender) return (m.pushName || '').trim() || null
  if (m.isGroup) {
    try {
      const g = await sock.groupMetadata(m.chat)
      const p = g?.participants?.find((p) => p.id === jid)
      if (p?.notify) return String(p.notify).trim() || null
    } catch {
      /* ignore */
    }
  }
  return null
}

/** A target's bio. Empty string when they have none / it's hidden. */
async function fetchBio(sock, jid) {
  try {
    return (await fetchStatusOf(sock, jid)) || ''
  } catch {
    /* hidden */
  }
  return ''
}

/** A target's profile picture URL, or null if hidden/unavailable. */
async function fetchPp(sock, m, jid) {
  try {
    return await sock.profilePictureUrl(jid, 'image')
  } catch {
    /* hidden or default picture */
  }
  if (m?.isGroup) {
    try {
      const g = await sock.groupMetadata(m.chat)
      return g?.participants?.find((p) => p.id === jid)?.imgUrl || null
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * Push name + bio + picture onto the bot account.
 * Returns per-part results: true = applied, string = error message.
 */
async function applyProfile(sock, { name, bio, pp }) {
  const applied = { name: !name, bio: bio === undefined || bio === null, pic: !pp }
  if (name) {
    try {
      await sock.updateProfileName(name)
      applied.name = true
    } catch (e) {
      applied.name = e.message
    }
  }
  if (bio !== undefined && bio !== null) {
    try {
      await sock.updateProfileStatus(String(bio).slice(0, MAX_BIO))
      applied.bio = true
    } catch (e) {
      applied.bio = e.message
    }
  }
  if (pp) {
    try {
      await sock.updateProfilePicture(botJidOf(sock), await getBuffer(pp))
      applied.pic = true
    } catch (e) {
      applied.pic = e.message
    }
  }
  return applied
}

const partLine = (ok, copied) => (ok === true ? copied : `⚠️ failed (${ok})`)

/* ------------------------------ commands ------------------------------ */

export default [
  {
    name: 'clone',
    category: 'USER',
    desc: 'Clone someone\'s profile (name, bio & picture) onto the bot',
    usage: '.clone @user | .clone 2348012345678 | .clone (reply to their message)',
    owner: true,
    async run({ sock, m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : m.sender)
      if (args[0] && !/\d{5,}/.test(args[0])) {
        return m.reply('🧬 *CLONE*\n\nTag someone, reply to their message, or give their number:\n*.clone 2348012345678*\n\n(Or just *.clone* to clone yourself.)\n\nUndo anytime with *.unclone*')
      }
      if (target.split('@')[0].split(':')[0] === m.botNumber) return m.reply('🙃 That\'s me. Clone someone else.')
      await m.react('🧬').catch(() => {})

      try {
        // Use the cached profile when re-cloning the same person
        let data = await clones.findOne({ id: target })
        if (!data) {
          const [name, bio, pp] = await Promise.all([
            fetchName(sock, m, target),
            fetchBio(sock, target),
            fetchPp(sock, m, target)
          ])
          if (!name && !bio && !pp) {
            return m.reply('❌ Couldn\'t read their profile - their privacy settings hide it, or the number isn\'t on WhatsApp.')
          }
          data = { id: target, name, bio, pp, clonedAt: Date.now() }
          await clones.set({ id: target }, data)
        }

        await captureOriginal(sock)
        const applied = await applyProfile(sock, data)
        await clones.set({ id: '__active__' }, { target, at: Date.now() })

        await m.reply(
          `🧬 *PROFILE CLONED*\n\n` +
            `👤 Name: ${data.name ? partLine(applied.name, data.name) : '⚠️ not copied (names are readable from messages or group rosters only)'}\n` +
            `📝 Bio: ${data.bio ? partLine(applied.bio, data.bio) : '⚠️ none / hidden'}\n` +
            `🖼️ Pic: ${data.pp ? partLine(applied.pic, '✅ copied') : '⚠️ not copied (hidden/private)'}\n\n` +
            `Target: @${target.split('@')[0]}\n` +
            `Undo with *.unclone*`,
          { mentions: [target] }
        )
      } catch (e) {
        await m.reply(`❌ Clone failed: ${e.message}`)
      }
    }
  },
  {
    name: 'clonestatus',
    category: 'USER',
    desc: 'Keep the cloned identity but set your own bio',
    usage: '.clonestatus your own status text here',
    owner: true,
    async run({ sock, m, text }) {
      if (!text) return m.reply('📝 Usage: .clonestatus <your own bio text>')
      try {
        await captureOriginal(sock)
        await sock.updateProfileStatus(text.slice(0, MAX_BIO))
        await clones.set({ id: '__status__' }, { bio: text.slice(0, MAX_BIO), at: Date.now() })
        await m.reply(`✅ Bio set to:\n\n${text.slice(0, MAX_BIO)}`)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'cloneinfo',
    category: 'USER',
    desc: 'Show what identity the bot is currently wearing',
    usage: '.cloneinfo',
    owner: true,
    async run({ m }) {
      const active = await clones.findOne({ id: '__active__' })
      if (!active) return m.reply('🧼 The bot is using its own identity - nothing cloned.')
      const row = await clones.findOne({ id: active.target })
      const override = await clones.findOne({ id: '__status__' })
      await m.reply(
        `🧬 *CURRENT PROFILE*\n\n` +
          `👤 Name: ${row?.name || '*kept original (name not copied)*'}\n` +
          `📝 Bio: ${override ? override.bio : row?.bio || '—'}${override ? ' *(overridden)*' : ''}\n` +
          `🖼️ Pic: ${row?.pp ? 'cloned from target' : 'not copied'}\n\n` +
          `Origin: @${(active.target || '').split('@')[0]}\n` +
          `Cloned: ${new Date(active.at || Date.now()).toLocaleString()}\n\n` +
          `Restore yourself with *.unclone*`
      )
    }
  },
  {
    name: 'unclone',
    alias: ['resetprofile', 'restoreme'],
    category: 'USER',
    desc: 'Restore the bot\'s original name, bio & picture',
    usage: '.unclone',
    owner: true,
    async run({ sock, m }) {
      const orig = await clones.findOne({ id: '__original__' })
      if (!orig?.captured) return m.reply('🧼 Nothing to undo - the bot is already itself.')
      try {
        const applied = await applyProfile(sock, { name: orig.name, bio: orig.bio || '', pp: orig.pp })
        const failed = [
          applied.name === true ? null : `name (${applied.name})`,
          applied.bio === true ? null : `bio (${applied.bio})`,
          applied.pic === true ? null : `picture (${applied.pic})`
        ].filter(Boolean)
        if (!failed.length) {
          await clones.delete({})
          return m.reply('🧼 *UNCLONED*\n\nRestored the original name, bio & picture. Back to normal. ✌️')
        }
        // keep the backup so a retry can finish the job
        return m.reply(`⚠️ *PARTIALLY RESTORED*\n\nCouldn't restore: ${failed.join(', ')}.\nThe backup is kept - wait a moment, then try *.unclone* again.`)
      } catch (e) {
        await m.reply(`❌ Couldn't fully restore (${e.message}) - the backup is kept, try .unclone again.`)
      }
    }
  }
]
