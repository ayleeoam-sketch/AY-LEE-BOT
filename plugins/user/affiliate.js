import config from '../../src/config.js'
import { getVar, setVar } from '../../src/lib/vars.js'
import { codeFor, stats, claim, leaderboard, linkFor } from '../../src/lib/affiliate.js'
import { ROLES } from '../../src/lib/roles.js'
import { CURRENCY, NAME } from '../../src/lib/economy.js'

/**
 * Affiliate programme — give people a reason to spread the bot.
 *
 * Everyone has a permanent code and a share link. A newcomer runs
 * `.ref <code>` once: the inviter earns coins, the newcomer gets a starter
 * bonus, and enough invites promotes the inviter to VIP automatically.
 */

const salt = () => config.botId || 'default'
const numberOf = (jid) => String(jid).split('@')[0].split(':')[0]

export default [
  {
    name: 'affiliate',
    alias: ['aff', 'reflink', 'mycode', 'invite2'],
    category: 'USER',
    desc: 'Your referral code, link and earnings',
    usage: '.affiliate',
    async run({ m, prefix }) {
      const me = numberOf(m.sender)
      const code = codeFor(me, salt())
      const s = await stats(me)
      const link = linkFor(code)
      const reward = Number(getVar('REF_REWARD')) || 0
      const bonus = Number(getVar('REF_BONUS')) || 0
      const target = Number(getVar('REF_VIP_AT')) || 0
      const role = ROLES[m.role] || ROLES.user

      const toVip = target > 0 && s.count < target ? target - s.count : 0

      await m.reply(
        `╭━━━〔 *AFFILIATE* 〕━━━╮\n` +
          `┃ 🎟️ Code: *${code}*\n` +
          `┃ 👥 Invited: *${s.count}*\n` +
          `┃ ${CURRENCY} Earned: *${s.earned.toLocaleString()}* ${NAME}\n` +
          `┃ ${role.emoji} Role: *${role.label}*\n` +
          (toVip ? `┃ 💎 ${toVip} more invite${toVip === 1 ? '' : 's'} for VIP\n` : '') +
          `╰━━━━━━━━━━━━━━━╯\n\n` +
          (link ? `🔗 *Your link*\n${link}\n\n` : '') +
          `*How it works*\n` +
          `1. Share your code or link\n` +
          `2. They send *${prefix}ref ${code}* to me\n` +
          `3. You get ${CURRENCY} ${reward.toLocaleString()}, they get ${CURRENCY} ${bonus.toLocaleString()}\n` +
          (target ? `4. ${target} invites and you are ${ROLES.vip.emoji} VIP — half cooldowns, forever\n` : '') +
          `\n_Leaderboard: ${prefix}reftop_`
      )
    }
  },
  {
    name: 'ref',
    alias: ['refclaim', 'usecode', 'invitedby'],
    category: 'USER',
    desc: 'Claim the code of whoever invited you',
    usage: '.ref V7K2M9',
    cooldown: 10,
    async run({ m, args, prefix }) {
      const code = (args[0] || '').trim()
      if (!code) {
        return m.reply(
          `🎟️ *Usage:* ${prefix}ref <code>\n\n` +
            `Someone shared a code with you? Send it here and you both get paid.\n` +
            `Your own code lives in *${prefix}affiliate*.`
        )
      }

      const me = numberOf(m.sender)
      const res = await claim(me, code, salt())

      if (!res.ok) {
        const why = {
          already: `❌ You have already been referred. One claim per person.`,
          unknown: `❌ No one here owns the code *${code.toUpperCase()}*.\n\n_Check the spelling — codes look like V7K2M9._`,
          self: `😄 That is your own code. Nice try.`,
          loop: `❌ You invited them, so they cannot invite you back.`
        }
        return m.reply(why[res.reason] || '❌ That did not work.')
      }

      await m.reply({
        text:
          `✅ *Referral accepted!*\n\n` +
          `┃ 🤝 Invited by: @${res.referrer}\n` +
          `┃ ${CURRENCY} You received: *${res.bonus.toLocaleString()}* ${NAME}\n` +
          `┃ ${CURRENCY} They received: *${res.reward.toLocaleString()}* ${NAME}\n` +
          (res.promoted ? `┃ 💎 They just hit VIP!\n` : '') +
          `\n_Now share your own: ${prefix}affiliate_`,
        mentions: [`${res.referrer}@s.whatsapp.net`]
      })
    }
  },
  {
    name: 'reftop',
    alias: ['afftop', 'topref', 'leaderboard2'],
    category: 'USER',
    desc: 'Top affiliates',
    usage: '.reftop',
    cooldown: 10,
    async run({ m, prefix }) {
      const rows = await leaderboard(10)
      if (!rows.length) {
        return m.reply(`🏆 Nobody has referred anyone yet.\n\nBe first: *${prefix}affiliate*`)
      }
      const medal = ['🥇', '🥈', '🥉']
      const body = rows
        .map((r, i) => `${medal[i] || `${i + 1}.`} @${r.number} — *${r.count}* invite${r.count === 1 ? '' : 's'}`)
        .join('\n')
      await m.reply({
        text: `╭━━━〔 *TOP AFFILIATES* 〕━━━╮\n${body}\n╰━━━━━━━━━━━━━━━━━╯\n\n_Join them: ${prefix}affiliate_`,
        mentions: rows.map((r) => `${r.number}@s.whatsapp.net`)
      })
    }
  },
  {
    name: 'refstats',
    alias: ['affstats'],
    category: 'USER',
    desc: 'Who you invited, and who invited you',
    usage: '.refstats',
    async run({ m, prefix }) {
      const me = numberOf(m.sender)
      const s = await stats(me)
      const mentions = s.invited.map((n) => `${n}@s.whatsapp.net`)
      if (s.by) mentions.push(`${s.by}@s.whatsapp.net`)

      await m.reply({
        text:
          `╭━━━〔 *REFERRALS* 〕━━━╮\n` +
          `┃ 🎟️ Code: *${codeFor(me, salt())}*\n` +
          `┃ 🤝 Invited by: ${s.by ? `@${s.by}` : '_nobody yet_'}\n` +
          `┃ 👥 You invited: *${s.count}*\n` +
          `┃ ${CURRENCY} Earned: *${s.earned.toLocaleString()}*\n` +
          `╰━━━━━━━━━━━━━━━╯\n` +
          (s.invited.length ? `\n${s.invited.map((n) => `• @${n}`).join('\n')}` : `\n_Share ${prefix}affiliate to start._`),
        mentions
      })
    }
  },
  {
    name: 'setaffiliate',
    alias: ['setafflink', 'setreflink'],
    category: 'CONFIG',
    desc: 'Set where your affiliate links point',
    usage: '.setaffiliate https://your-deploy-page.com',
    owner: true,
    async run({ m, args, prefix }) {
      const url = (args[0] || '').trim()
      if (!/^https?:\/\//i.test(url)) {
        return m.reply(
          `🔗 *Usage:* ${prefix}setaffiliate <url>\n\n` +
            `Currently: ${getVar('AFFILIATE_URL') || '_unset_'}\n\n` +
            `Point it at your repo, deploy page or channel. Codes are appended as *?ref=CODE*, ` +
            `so you can see who sent the traffic.\n\n` +
            `Rewards: *${prefix}setvar REF_REWARD 500* · *${prefix}setvar REF_BONUS 250* · ` +
            `*${prefix}setvar REF_VIP_AT 5*`
        )
      }
      await setVar('AFFILIATE_URL', url)
      await m.reply(
        `✅ Affiliate links now point to:\n${url}\n\n` +
          `Example: ${linkFor(codeFor(m.senderNumber, salt()))}`
      )
    }
  }
]
