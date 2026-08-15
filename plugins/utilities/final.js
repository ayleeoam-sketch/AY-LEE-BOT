import sharp from 'sharp'
import { getBuffer, getJson, race } from '../../src/lib/api.js'

export default [
  {
    name: 'wm',
    alias: ['watermark'],
    category: 'UTILITIES',
    desc: 'Add a text watermark to an image',
    usage: '.wm YOUR TEXT (reply to an image)',
    cooldown: 6,
    async run({ sock, m, text, config }) {
      const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
      if (!src) return m.reply('💧 Reply to an image with *.wm YOUR TEXT*')
      const label = (text || config.botName).slice(0, 40)

      await m.react('💧')
      try {
        const input = await src.download()
        const meta = await sharp(input).metadata()
        const w = Math.min(meta.width || 800, 1400)
        const scaled = await sharp(input).resize(w, null, { withoutEnlargement: true }).png().toBuffer()
        const h = (await sharp(scaled).metadata()).height

        const size = Math.max(18, Math.round(w / 22))
        const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <text x="${w - 14}" y="${h - 14}" font-family="'DejaVu Sans',sans-serif" font-size="${size}"
                font-weight="bold" fill="#ffffff" fill-opacity="0.82" text-anchor="end"
                stroke="#000000" stroke-opacity="0.55" stroke-width="${Math.max(1, size / 18)}"
                paint-order="stroke">${esc}</text>
        </svg>`

        const out = await sharp(scaled)
          .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
          .jpeg({ quality: 92 })
          .toBuffer()

        await m.reply({ image: out, caption: `💧 Watermarked: *${label}*` })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'pdf',
    alias: ['topdf', 'imgtopdf'],
    category: 'UTILITIES',
    desc: 'Convert an image into a PDF document',
    usage: '.pdf (reply to an image)',
    cooldown: 10,
    async run({ m }) {
      const src = m.type === 'imageMessage' ? m : m.quoted?.type === 'imageMessage' ? m.quoted : null
      if (!src) return m.reply('📄 Reply to an image with *.pdf*')

      await m.react('📄')
      try {
        const input = await src.download()
        // fit the image onto A4 at 72dpi
        const A4 = { w: 595, h: 842 }
        const img = sharp(input)
        const meta = await img.metadata()
        const scale = Math.min(A4.w / (meta.width || A4.w), A4.h / (meta.height || A4.h), 1)
        const tw = Math.round((meta.width || A4.w) * scale)
        const th = Math.round((meta.height || A4.h) * scale)
        const jpeg = await img.resize(tw, th).jpeg({ quality: 88 }).toBuffer()

        // minimal, valid PDF wrapping a single JPEG (DCTDecode)
        const x = Math.round((A4.w - tw) / 2)
        const y = Math.round((A4.h - th) / 2)
        const objs = []
        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
        objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
        objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
        const stream = `q ${tw} 0 0 ${th} ${x} ${y} cm /Im0 Do Q`

        const chunks = []
        const offsets = []
        let pos = 0
        const push = (buf) => { chunks.push(buf); pos += buf.length }
        push(Buffer.from('%PDF-1.4\n'))

        for (let i = 1; i <= 5; i++) {
          offsets[i] = pos
          if (i === 4) {
            push(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${meta.width} /Height ${meta.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`))
            push(jpeg)
            push(Buffer.from('\nendstream\nendobj\n'))
          } else if (i === 5) {
            push(Buffer.from(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`))
          } else {
            push(Buffer.from(`${i} 0 obj\n${objs[i]}\nendobj\n`))
          }
        }

        const xref = pos
        let table = `xref\n0 6\n0000000000 65535 f \n`
        for (let i = 1; i <= 5; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
        push(Buffer.from(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))

        const pdf = Buffer.concat(chunks)
        await m.reply({
          document: pdf,
          mimetype: 'application/pdf',
          fileName: 'venom-md.pdf',
          caption: `📄 *PDF created*\n💾 ${(pdf.length / 1024).toFixed(0)} KB`
        })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'temp-url',
    alias: ['tempurl', 'tmpurl'],
    category: 'UTILITIES',
    desc: 'Upload media to a temporary host (expires)',
    usage: '.temp-url (reply to media)',
    cooldown: 15,
    async run({ m }) {
      const src = m.isMedia ? m : m.quoted?.isMedia ? m.quoted : null
      if (!src) return m.reply('⏳ Reply to any media with *.temp-url*')
      await m.react('⬆️')
      try {
        const buffer = await src.download()
        const mb = buffer.length / 1048576
        if (mb > 190) throw new Error(`file is ${mb.toFixed(1)}MB, too large`)

        const FormData = (await import('form-data')).default
        const axios = (await import('axios')).default
        const { extOf } = await import('../../src/lib/media.js')
        const ext = await extOf(buffer, 'bin')

        // litterbox is catbox's temporary sibling - files auto-delete
        const form = new FormData()
        form.append('reqtype', 'fileupload')
        form.append('time', '24h')
        form.append('fileToUpload', buffer, { filename: `venom.${ext}` })
        const { data } = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
          headers: form.getHeaders(),
          timeout: 120_000
        })
        const url = String(data).trim()
        if (!/^https?:\/\//.test(url)) throw new Error('the host rejected the upload')

        await m.reply(
          `⏳ *TEMPORARY LINK*\n\n${url}\n\n` +
            `🗓️ Expires in 24 hours\n💾 ${mb < 1 ? `${(buffer.length / 1024).toFixed(0)} KB` : `${mb.toFixed(2)} MB`}`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'ngl',
    alias: ['anon', 'anonmsg'],
    category: 'UTILITIES',
    desc: 'Send an anonymous message to someone in the group',
    usage: '.ngl @user your message',
    group: true,
    cooldown: 30,
    async run({ sock, m, text }) {
      const target = m.mentions?.[0]
      if (!target) return m.reply('🕵️ Usage: *.ngl @user your secret message*')
      const body = text.replace(/@\d+/g, '').trim()
      if (!body) return m.reply('🕵️ Add a message: *.ngl @user you are great*')
      if (body.length > 500) return m.reply('❌ Keep it under 500 characters.')

      try {
        await sock.sendMessage(target, {
          text:
            `🕵️ *ANONYMOUS MESSAGE*\n\n${body}\n\n` +
            `━━━━━━━━━━━━━━\n_Sent anonymously from *${m.groupName || 'a group'}*._\n` +
            `_The sender's identity is not stored._`
        })
        // delete the command so the group cannot see who sent it
        if (m.isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
        await m.send('✅ Anonymous message delivered.')
      } catch (e) {
        await m.reply(`❌ Could not deliver it: ${e.message}\n\n_They may need to message the bot first._`)
      }
    }
  },
  {
    name: 'audio2text',
    alias: ['transcribe', 'stt'],
    category: 'UTILITIES',
    desc: 'Transcribe a voice note into text',
    usage: '.audio2text (reply to a voice note)',
    cooldown: 20,
    async run({ m }) {
      const src =
        m.type === 'audioMessage' ? m : m.quoted?.type === 'audioMessage' ? m.quoted : null
      if (!src) return m.reply('🎤 Reply to a voice note or audio with *.audio2text*')

      await m.react('🎤')
      try {
        const buffer = await src.download()
        const mb = buffer.length / 1048576
        if (mb > 20) throw new Error('audio is too long — keep it under about 5 minutes')

        const { toMp3, extOf } = await import('../../src/lib/media.js')
        const mp3 = await toMp3(buffer, await extOf(buffer, 'ogg'))

        const FormData = (await import('form-data')).default
        const axios = (await import('axios')).default
        const form = new FormData()
        form.append('file', mp3, { filename: 'audio.mp3', contentType: 'audio/mpeg' })
        form.append('model', 'whisper-1')

        // uses your own OpenAI key when present - Whisper has no free tier
        const key = (await import('../../src/config.js')).default.keys.openai
        if (!key) {
          await m.react('❌')
          return m.reply(
            '🎤 Transcription needs an OpenAI key.\n\n' +
              'Add *OPENAI_API_KEY* to your .env and restart.\n\n' +
              '_No free speech-to-text service is reliable enough to ship here._'
          )
        }

        const { data } = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${key}` },
          timeout: 120_000
        })
        if (!data?.text) throw new Error('no transcription returned')
        await m.reply(`🎤 *TRANSCRIPTION*\n\n${String(data.text).slice(0, 3500)}`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.response?.data?.error?.message || e.message}`)
      }
    }
  },
  {
    name: 'subtitle',
    alias: ['subs', 'subtitlesearch'],
    category: 'SEARCH',
    desc: 'Search for movie or show subtitles',
    usage: '.subtitle inception',
    cooldown: 12,
    async run({ m, text }) {
      if (!text) return m.reply('🎬 Usage: *.subtitle inception*')
      await m.react('🔎')
      try {
        // OpenSubtitles' REST API needs a key, but their legacy search page
        // and the TVsubtitles mirror are open. Use OMDb-style lookup to at
        // least confirm the title, then link to the subtitle sources.
        const d = await race([
          async () => {
            const r = await getJson(
              `https://api.duckduckgo.com/?q=${encodeURIComponent(text + ' movie')}&format=json&no_html=1`
            )
            if (!r.AbstractText && !r.Heading) throw new Error('none')
            return { title: r.Heading || text, about: r.AbstractText }
          }
        ]).catch(() => ({ title: text, about: '' }))

        const q = encodeURIComponent(text)
        await m.reply(
          `🎬 *SUBTITLE SEARCH*\n_${d.title}_\n\n` +
            (d.about ? `📝 ${d.about.slice(0, 300)}\n\n` : '') +
            `Direct search links:\n\n` +
            `1️⃣ OpenSubtitles\n   https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-${q}\n\n` +
            `2️⃣ Subscene\n   https://subscene.com/subtitles/searchbytitle?query=${q}\n\n` +
            `3️⃣ YIFY Subtitles\n   https://yifysubtitles.ch/search?q=${q}\n\n` +
            `_Subtitle sites block automated downloads, so these are search links rather than direct files._`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'shazam',
    alias: ['whatsong', 'identify'],
    category: 'SEARCH',
    desc: 'Identify a song from audio',
    usage: '.shazam (reply to audio)',
    cooldown: 20,
    async run({ m }) {
      const src = m.isMedia ? m : m.quoted?.isMedia ? m.quoted : null
      if (!src) return m.reply('🎵 Reply to an audio or video clip with *.shazam*')
      await m.reply(
        `🎵 *Song identification*\n\n` +
          `Audio fingerprinting needs a paid service — ACRCloud and AudD both require an API key, ` +
          `and every free mirror I tested was dead.\n\n` +
          `*What works instead:*\n` +
          `• *.lyrics artist - song* if you know part of the words\n` +
          `• *.ai what song goes "lyrics here"* — the AI often recognises it\n\n` +
          `_If you get an AudD key, this becomes a 20-line plugin — see the README._`
      )
    }
  }
]
