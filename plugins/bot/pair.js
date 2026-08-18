import { CREATOR, isCreatorHub, notHubPairMessage, getBotCard } from '../../src/branding.js'
import { startPairing, cleanPhone } from '../../src/lib/pair.js'
import { listRecent } from '../../src/lib/deployStore.js'
import { launchHost } from '../../src/lib/hosted.js'

function deployHelp(token, prefix = '.') {
  return (
    `✅ *LINKED — your VENOM MD session is ready*\n\n` +
    `🎟️ *SESSION_TOKEN*\n\`${token}\`\n` +
    `_Paste that one short code. Do not copy a giant SESSION_ID._\n\n` +
    `👥 *Now join the official group or the bot will not answer you:*\n` +
    `${CREATOR.group}\n\n` +
    `*Deploy (pick one)*\n` +
    `▸ Render — New Web Service → this repo → env:\n` +
    `   SESSION_TOKEN=${token}\n` +
    `   OWNER_NUMBER=yournumber\n` +
    `   OWNER_NAME=yourname\n` +
    `▸ Railway / Koyeb / Heroku — same three env vars\n` +
    `▸ Panel — upload the repo, same env, \`npm start\`\n\n` +
    `Repo: ${CREATOR.repo}\n` +
    `Need the card again? *${prefix}getbot*`
  )
}

export default [
  {
    name: 'pair',
    alias: ['getsession', 'session', 'linkme'],
    category: 'BOT',
    desc: 'Pair your WhatsApp on the official VENOM MD and get a deploy token',
    usage: '.pair 2348012345678',
    cooldown: 20,
    always: true,
    async run({ sock, m, args, text, prefix }) {
      if (!isCreatorHub()) return m.reply(notHubPairMessage(prefix))

      const raw = args[0] || ''
      const phone = cleanPhone(raw) || m.senderNumber
      if (raw && !cleanPhone(raw)) {
        return m.reply(`📝 *Usage:* ${prefix}pair 2348012345678\n\nDigits only, country code, no +.\nLeave the number off to pair *this* WhatsApp.`)
      }
      if (phone.length < 10) {
        return m.reply(`📝 Give a full international number:\n*${prefix}pair 2348012345678*`)
      }

      const { checkSupportMember } = await import('../config/forcejoin.js')
      const gate = await checkSupportMember(sock, m.sender)
      if (gate.ok && !gate.member) {
        return m.reply(
          `👥 *Join the official VENOM MD group first.*\n` +
            `Pairing starts after you are in.\n\n` +
            `${CREATOR.group}\n\n` +
            `Tap the link, then send *${prefix}pair ${phone}* again.`
        )
      }

      await m.react('⏳')
      await m.reply(
        `🔗 *PAIRING ${phone}*\n\n` +
          `I am asking WhatsApp for a code. On your phone:\n` +
          `*WhatsApp → Linked devices → Link with phone number*\n\n` +
          `_You have about 2 minutes._`
      )

      const result = await startPairing({
        phone,
        ownerName: m.pushName || '',
        onCode: async (pretty) => {
          await m.reply(
            `╭━━━〔 *PAIRING CODE* 〕━━━╮\n` +
              `┃ 🔢  *${pretty}*\n` +
              `┃ 📱  ${phone}\n` +
              `╰━━━━━━━━━━━━━━━━━╯\n\n` +
              `Type that code on the phone *now*.\n` +
              `Do not share it.`
          )
        }
      })

      if (!result.ok) {
        await m.react('❌')
        return m.reply(`❌ Pairing failed: ${result.error}\n\n_Join ${CREATOR.group} and try *${prefix}pair* again._`)
      }

      await m.react('✅')
      await m.reply(deployHelp(result.token, prefix))

      const hosted = await launchHost({
        sessionId: result.sessionId,
        phone: result.phone,
        ownerName: m.pushName || '',
        ownerJid: m.sender
      })
      if (hosted.ok) {
        await m.reply(
          `🚀 *I started your bot here — you do not need Render for this.*\n\n` +
            `Number: *${hosted.phone}*\n` +
            `Wait ~20 seconds, then send *.ping* on that WhatsApp.\n\n` +
            `Want your own server later? Use token \`${result.token}\`.`
        )
      } else {
        await m.reply(
          `⚠️ Could not auto-start on this hub: ${hosted.error}\n\n` +
            `You can still deploy yourself with *SESSION_TOKEN=${result.token}*,\n` +
            `or send *.autodeploy ${result.token}*`
        )
      }
    }
  },
  {
    name: 'getbot',
    alias: ['deploy', 'wantbot', 'mybot'],
    category: 'BOT',
    desc: 'How to get your own VENOM MD bot',
    usage: '.getbot',
    cooldown: 8,
    always: true,
    async run({ m, prefix }) {
      await m.reply(getBotCard(prefix))
    }
  },
  {
    name: 'pairstats',
    alias: ['sessions'],
    category: 'BOT',
    desc: 'Recent official pairing tokens (creator hub only)',
    usage: '.pairstats',
    owner: true,
    async run({ m }) {
      if (!isCreatorHub()) return m.reply('This instance is not the official pairing hub.')
      const rows = await listRecent(12)
      if (!rows.length) return m.reply('No sessions minted yet.')
      await m.reply(
        `🎟️ *RECENT PAIR TOKENS*\n\n` +
          rows
            .map((r) => {
              const when = new Date(r.createdAt).toLocaleString()
              const used = r.usedAt ? 'used' : 'waiting'
              return `• \`${r.token}\`  ${r.phone}  ${used}\n   ${when}`
            })
            .join('\n')
      )
    }
  }
]
