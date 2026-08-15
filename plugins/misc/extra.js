import { getVar, setVar } from '../../src/lib/vars.js'
import DB from '../../src/lib/database.js'
import { getUser, saveUser, CURRENCY, comma } from '../../src/lib/economy.js'
import { font } from '../../src/lib/utils.js'

/** Remaining odds and ends from the original menu. */
export default [
  {
    name: 'economy',
    alias: ['econ', 'econhelp'],
    category: 'ECONOMY',
    desc: 'Explain how the economy works',
    usage: '.economy',
    async run({ m, prefix }) {
      await m.reply(
        `💰 *ECONOMY GUIDE*\n\n` +
          `*Earning*\n` +
          `${prefix}daily — biggest reward, once a day, streaks increase it\n` +
          `${prefix}work — hourly shift\n` +
          `${prefix}beg — small, every 5 minutes\n` +
          `${prefix}crime — risky, bigger payout\n` +
          `${prefix}fish ${prefix}mine ${prefix}hunt — need a tool from ${prefix}shop\n\n` +
          `*Banking*\n` +
          `${prefix}bal — check your money\n` +
          `${prefix}dep / ${prefix}with — bank money is safe from robbery\n` +
          `${prefix}bankupgrade — double your bank limit\n` +
          `${prefix}loan / ${prefix}payloan — borrow at 20% interest\n\n` +
          `*Gambling*\n` +
          `${prefix}slots ${prefix}bj ${prefix}dice ${prefix}cf ${prefix}rps ${prefix}gamble\n` +
          `${prefix}heist ${prefix}bankrob — high risk, high reward\n\n` +
          `*Social*\n` +
          `${prefix}give — send coins  ·  ${prefix}rob — steal (risky)\n` +
          `${prefix}gift — give an item  ·  ${prefix}lb — leaderboard\n\n` +
          `*Items*\n` +
          `${prefix}shop ${prefix}buy ${prefix}sell ${prefix}inv\n` +
          `A vault protects half your wallet. A lockpick improves robbery odds.`
      )
    }
  },
  {
    name: 'tax',
    category: 'ECONOMY',
    desc: 'Owner: tax everyone a percentage of their wallet',
    usage: '.tax 5',
    owner: true,
    async run({ m, args }) {
      const pct = parseFloat(args[0])
      if (!pct || pct <= 0 || pct > 50) return m.reply('📝 Usage: *.tax 5* (1-50 percent)')
      if (args[1] !== 'confirm') {
        return m.reply(`⚠️ This takes *${pct}%* of every user's wallet.\n\nType *.tax ${pct} confirm* to proceed.`)
      }
      const rows = await DB.users.all()
      let collected = 0
      let affected = 0
      for (const row of rows) {
        if (!row.wallet || row.wallet <= 0) continue
        const cut = Math.floor(row.wallet * (pct / 100))
        if (cut <= 0) continue
        await DB.users.set({ id: row.id }, { wallet: row.wallet - cut })
        collected += cut
        affected++
      }
      await m.reply(
        `🏛️ *TAX COLLECTED*\n\n` +
          `📊 Rate: ${pct}%\n` +
          `👥 Users taxed: ${affected}\n` +
          `💰 Total collected: ${CURRENCY} ${comma(collected)}`
      )
    }
  },
  {
    name: 'q',
    alias: ['quotemsg'],
    category: 'MISC',
    desc: 'Turn a replied message into a quote card',
    usage: '.q (reply to a message)',
    cooldown: 5,
    async run({ m }) {
      if (!m.quoted) return m.reply('💬 Reply to a message with *.q*')
      const body = m.quoted.text
      if (!body) return m.reply('💬 That message has no text to quote.')
      await m.reply(
        `╭──────────────\n` +
          `│ 💬 *${m.quoted.senderNumber === m.senderNumber ? 'You' : '@' + m.quoted.senderNumber}*\n` +
          `│\n` +
          body.split('\n').slice(0, 20).map((l) => `│ ${l}`).join('\n') +
          `\n╰──────────────`,
        { mentions: [m.quoted.sender] }
      )
    }
  },
  {
    name: 'font',
    alias: ['fancytext', 'style'],
    category: 'UTILITIES',
    desc: 'Convert text into fancy unicode fonts',
    usage: '.font VENOM MD',
    cooldown: 5,
    async run({ m, text }) {
      const body = text || m.quoted?.text
      if (!body) return m.reply('🔤 Usage: *.font VENOM MD*')
      if (body.length > 60) return m.reply('❌ Keep it under 60 characters.')
      await m.reply(
        `🔤 *FONT STYLES*\n\n` +
          `1. ${font.bold(body)}\n\n` +
          `2. ${font.italic(body)}\n\n` +
          `3. ${font.mono(body)}\n\n` +
          `4. ${font.fancy(body)}\n\n` +
          `5. ${[...body].join(' ')}\n\n` +
          `6. ${[...body].reverse().join('')}\n\n` +
          `7. ${body.toUpperCase()}\n\n` +
          `8. ${body.toLowerCase()}`
      )
    }
  },
  {
    name: 'trt',
    alias: ['translate2'],
    category: 'UTILITIES',
    desc: 'Translate text to another language',
    usage: '.trt en Hola amigo',
    cooldown: 8,
    async run({ m, args, text }) {
      const to = (args[0] || '').toLowerCase()
      const body = args.slice(1).join(' ') || m.quoted?.text
      if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(to) || !body) {
        return m.reply(
          '🌍 Usage: *.trt en Hola amigo*\n\n' +
            'Language codes: en es fr de pt ar hi zh ja ko ru it yo ig ha sw'
        )
      }
      await m.react('🌍')
      try {
        const { getJson } = await import('../../src/lib/api.js')
        // Google's free translate endpoint - keyless
        const d = await getJson(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(body)}`
        )
        const translated = (d?.[0] || []).map((x) => x[0]).join('')
        const detected = d?.[2] || 'auto'
        if (!translated) throw new Error('no translation returned')
        await m.reply(
          `🌍 *TRANSLATION*\n\n` +
            `📥 *${detected}:* ${body.slice(0, 500)}\n\n` +
            `📤 *${to}:* ${translated.slice(0, 1500)}`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ Translation failed: ${e.message}`)
      }
    }
  },
  {
    name: 'listoffline',
    category: 'TOOLS',
    desc: 'Show members who did not appear online',
    usage: '.listoffline',
    group: true,
    async run({ sock, m }) {
      await sock.presenceSubscribe(m.chat).catch(() => {})
      await m.reply('👀 Watching presence for 8 seconds...')
      const online = new Set()
      const listener = ({ id, presences }) => {
        if (id !== m.chat) return
        for (const [jid, p] of Object.entries(presences || {})) {
          if (p?.lastKnownPresence && p.lastKnownPresence !== 'unavailable') online.add(jid)
        }
      }
      sock.ev.on('presence.update', listener)
      await new Promise((r) => setTimeout(r, 8000))
      sock.ev.off('presence.update', listener)

      const offline = m.participants.map((p) => p.id).filter((j) => !online.has(j))
      if (!offline.length) return m.reply('🟢 Everyone appeared online.')
      await m.reply({
        text:
          `⚫ *NOT SEEN ONLINE* (${offline.length}/${m.participants.length})\n\n` +
          offline.slice(0, 60).map((j) => `• @${j.split('@')[0]}`).join('\n') +
          `\n\n_WhatsApp only reports presence for people with the chat open, so this is a rough guide._`,
        mentions: offline.slice(0, 60)
      })
    }
  },
  {
    name: 'savecmd',
    category: 'CONFIG',
    desc: 'Choose which command saves status updates',
    usage: '.savecmd send',
    owner: true,
    async run({ m, args }) {
      const word = (args[0] || '').toLowerCase()
      if (!word) {
        const row = await DB.vars.findOne({ key: 'SAVE_CMD' })
        return m.reply(
          `💾 *Status save trigger:* *${row?.value || 'send'}*\n\n` +
            `Reply to any status with that word and I will forward it to you.\n\n` +
            `Change it with *.savecmd <word>*`
        )
      }
      await DB.vars.set({ key: 'SAVE_CMD' }, { value: word })
      await m.reply(`✅ Reply to a status with *${word}* to save it.`)
    }
  },
  {
    name: 'vvcmd',
    category: 'CONFIG',
    desc: 'Choose which word reveals view-once media',
    usage: '.vvcmd open',
    owner: true,
    async run({ m, args }) {
      const word = (args[0] || '').toLowerCase()
      if (!word) {
        const row = await DB.vars.findOne({ key: 'VV_CMD' })
        return m.reply(
          `👁️ *View-once trigger:* *${row?.value || 'vv'}*\n\n` +
            `Change it with *.vvcmd <word>*`
        )
      }
      await DB.vars.set({ key: 'VV_CMD' }, { value: word })
      await m.reply(`✅ Reply to a view-once message with *${word}* to reveal it.`)
    }
  },
  {
    name: 'url',
    alias: ['upload', 'tourl'],
    category: 'UTILITIES',
    desc: 'Upload media and get a shareable link',
    usage: '.url (reply to any media)',
    cooldown: 15,
    async run({ m }) {
      const src = m.isMedia ? m : m.quoted?.isMedia ? m.quoted : null
      if (!src) return m.reply('🔗 Reply to an image, video, audio or document with *.url*')
      await m.react('⬆️')
      try {
        const buffer = await src.download()
        const mb = buffer.length / 1048576
        if (mb > 190) throw new Error(`file is ${mb.toFixed(1)}MB, over the 190MB host limit`)

        const FormData = (await import('form-data')).default
        const axios = (await import('axios')).default
        const { extOf } = await import('../../src/lib/media.js')
        const ext = await extOf(buffer, 'bin')

        const form = new FormData()
        form.append('reqtype', 'fileupload')
        form.append('fileToUpload', buffer, { filename: `venom.${ext}` })
        const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
          headers: form.getHeaders(),
          timeout: 120_000
        })
        const url = String(data).trim()
        if (!/^https?:\/\//.test(url)) throw new Error('the upload host rejected the file')

        await m.reply(
          `🔗 *UPLOADED*\n\n` +
            `${url}\n\n` +
            `📦 Type: ${ext}\n💾 Size: ${mb < 1 ? `${(buffer.length / 1024).toFixed(0)} KB` : `${mb.toFixed(2)} MB`}\n\n` +
            `_Hosted publicly on catbox.moe — do not upload anything private._`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ Upload failed: ${e.message}`)
      }
    }
  }
]
