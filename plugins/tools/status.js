import { getVar } from '../../src/lib/vars.js'
import config from '../../src/config.js'

/**
 * Status (story) automation.
 *
 * Status updates arrive as normal messages on the "status@broadcast" jid.
 * The handler short-circuits those before command parsing, so this plugin
 * hooks `onStatus`, which the handler calls for us.
 */
export default {
  name: 'statusinfo',
  alias: ['statusconfig'],
  category: 'CONFIG',
  desc: 'Show the current status automation settings',
  usage: '.statusinfo',
  owner: true,

  async run({ m }) {
    await m.reply(
      `╭━━━〔 *STATUS AUTOMATION* 〕━━━╮\n` +
        `┃ 👁️ Auto view: ${getVar('AUTO_READ_STATUS') ? 'on' : 'off'}\n` +
        `┃ 💚 Auto like: ${getVar('LIKE_STATUS') ? 'on' : 'off'}\n` +
        `┃ 😀 Like emoji: ${getVar('STATUS_EMOJI')}\n` +
        `┃ 💾 Auto save: ${getVar('SAVE_STATUS') ? 'on' : 'off'}\n` +
        `╰━━━━━━━━━━━━━━━━━╯\n\n` +
        `Toggle with:\n.readstatus on\n.likestatus on\n.savestatus on\n.statusemoji 🔥`
    )
  },

  /** Called by the handler for every status@broadcast message. */
  async onStatus({ sock, m }) {
    try {
      if (getVar('AUTO_READ_STATUS')) {
        await sock.readMessages([m.key]).catch(() => {})
      }

      if (getVar('LIKE_STATUS') && m.sender) {
        // status reactions must be sent with the author as participant
        await sock
          .sendMessage(
            'status@broadcast',
            { react: { text: getVar('STATUS_EMOJI') || '💚', key: m.key } },
            { statusJidList: [m.sender] }
          )
          .catch(() => {})
      }

      if (getVar('SAVE_STATUS')) {
        const owner = config.ownerNumbers[0]
        if (owner && !m.fromMe) {
          const to = `${owner}@s.whatsapp.net`
          const label =
            `💾 *Saved status*\n` +
            `👤 @${m.senderNumber}\n` +
            (m.body ? `💬 ${m.body.slice(0, 200)}` : '')
          await sock.sendMessage(to, { text: label, mentions: [m.sender] }).catch(() => {})
          if (m.isMedia) {
            const buffer = await m.download().catch(() => null)
            if (buffer) {
              const map = {
                imageMessage: { image: buffer },
                videoMessage: { video: buffer },
                audioMessage: { audio: buffer, mimetype: 'audio/mpeg' }
              }
              if (map[m.type]) await sock.sendMessage(to, map[m.type]).catch(() => {})
            }
          }
        }
      }
    } catch {
      /* never let status automation break the bot */
    }
  }
}
