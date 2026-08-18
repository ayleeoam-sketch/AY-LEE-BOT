import { CREATOR, isCreatorHub, notHubPairMessage } from '../../src/branding.js'
import { launchHost, stopHost, hostedList, resolveDeployInput, parseSessionPayload } from '../../src/lib/hosted.js'
import { checkSupportMember } from '../config/forcejoin.js'

export async function autoDeployFor(m, raw, { prefix = '.' } = {}) {
  if (!isCreatorHub()) return m.reply(notHubPairMessage(prefix))

  const parsed = await resolveDeployInput(raw)
  if (!parsed.ok) return m.reply(`❌ ${parsed.error}\n\nPaste a *SESSION_TOKEN* (VNM-XXXXXX) or a session ID.`)

  await m.react('🚀').catch(() => {})
  const result = await launchHost({
    sessionId: parsed.sessionId,
    phone: parsed.phone,
    ownerName: m.pushName || '',
    ownerJid: m.sender
  })
  if (!result.ok) {
    await m.react('❌').catch(() => {})
    return m.reply(`❌ Could not start your bot: ${result.error}`)
  }

  await m.react('✅').catch(() => {})
  return m.reply(
    result.reused
      ? `✅ Your VENOM MD for *${result.phone}* is already running on this hub.\n\nOpen WhatsApp on that number and send *${prefix}menu*.\n👥 Stay in ${CREATOR.group}`
      : `🚀 *AUTO-DEPLOYED*\n\n` +
          `Your VENOM MD is starting on *${result.phone}* right now.\n` +
          `Wait ~20 seconds, then send *${prefix}ping* from that WhatsApp.\n\n` +
          `👥 Stay in the official group or it will not answer:\n${CREATOR.group}`
  )
}

export default [
  {
    name: 'autodeploy',
    alias: ['hostbot', 'deployme', 'starthost'],
    category: 'BOT',
    desc: 'Start your VENOM MD on the official hub from a session ID or token',
    usage: '.autodeploy VNM-AB12CD   or   .autodeploy <SESSION_ID>',
    cooldown: 20,
    always: true,
    async run({ sock, m, text, prefix }) {
      if (!isCreatorHub()) return m.reply(notHubPairMessage(prefix))
      const blob = text || m.quoted?.text || ''
      if (!blob) {
        return m.reply(
          `🚀 *AUTO DEPLOY*\n\n` +
            `After *.pair*, I can start the bot for you here. Or paste what you have:\n\n` +
            `*${prefix}autodeploy VNM-AB12CD*\n` +
            `*${prefix}autodeploy* + your session ID\n\n` +
            `You can also just *paste the session ID* in this chat — I will pick it up and delete the message.\n\n` +
            `👥 ${CREATOR.group}`
        )
      }

      const gate = await checkSupportMember(sock, m.sender)
      if (gate.ok && !gate.member) {
        return m.reply(`👥 Join first, then deploy:\n${CREATOR.group}`)
      }

      return autoDeployFor(m, blob, { prefix })
    },

    /**
     * If someone pastes a raw session ID / token in a DM on the official hub,
     * start their bot and scrub the message so the creds are not left in chat.
     */
    async before({ sock, m }) {
      if (!isCreatorHub()) return false
      if (m.fromMe || !m.body) return false
      if (m.isGroup) return false
      // ignore real commands — .autodeploy handles those
      if (/^[./!#$,]/.test(m.body.trim())) return false
      const parsed = parseSessionPayload(m.body)
      if (!parsed) return false

      const gate = await checkSupportMember(sock, m.sender)
      if (gate.ok && !gate.member) {
        await m.reply(`👥 Join the official group first:\n${CREATOR.group}`)
        return true
      }

      await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
      await autoDeployFor(m, m.body, { prefix: '.' })
      return true
    }
  },
  {
    name: 'hostlist',
    alias: ['hosted', 'botlist'],
    category: 'BOT',
    desc: 'List bots auto-deployed on this hub',
    usage: '.hostlist',
    owner: true,
    async run({ m }) {
      if (!isCreatorHub()) return m.reply('Only the official hub hosts other bots.')
      const rows = hostedList()
      if (!rows.length) return m.reply('No hosted bots running.')
      await m.reply(
        `🖥️ *HOSTED BOTS* (${rows.length})\n` +
          `_These run on THIS server. If the hub stops, they stop._\n\n` +
          rows.map((r) => `${r.alive ? '🟢' : '⚪'} ${r.phone}  pid ${r.pid}`).join('\n') +
          `\n\nAll users (including Render): *.totalusers*`
      )
    }
  },
  {
    name: 'hoststop',
    alias: ['stophost', 'killbot'],
    category: 'BOT',
    desc: 'Stop a hosted bot',
    usage: '.hoststop 2348012345678',
    owner: true,
    async run({ m, args }) {
      const phone = String(args[0] || '').replace(/[^0-9]/g, '')
      if (!phone) return m.reply('📝 Usage: *.hoststop 2348012345678*')
      const ok = await stopHost(phone)
      await m.reply(ok ? `🛑 Stopped hosted bot ${phone}.` : `❌ No hosted bot for ${phone}.`)
    }
  }
]
