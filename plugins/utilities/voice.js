import DB from '../../src/lib/database.js'
import { analyzeVoice, cloneSpeak, speakPlain, detectLang } from '../../src/lib/voiceclone.js'

const voiceSrc = (m) => {
  if (m.type === 'audioMessage') return m
  if (m.quoted?.type === 'audioMessage') return m.quoted
  return null
}

const keyOf = (m, name) => ({ owner: m.sender, name: String(name || '').trim().toLowerCase() })

export default [
  {
    name: 'voiceclone',
    alias: ['vclone', 'clonevoice', 'clonevn'],
    category: 'VOICE',
    desc: 'Speak your text in the character of a replied voice note',
    usage: '.voiceclone I will be there in 5 minutes  (reply to a voice note)',
    cooldown: 12,
    async run({ m, text }) {
      const src = voiceSrc(m)
      const body = (text || '').trim()
      if (!src) {
        return m.reply(
          `🎙️ *VOICE CLONE*\n\n` +
            `1. Hold the mic and send a voice note (your voice)\n` +
            `2. *Reply* to that voice note with:\n` +
            `*.voiceclone how are you*\n\n` +
            `I will send back a voice note that says those words, tuned to the sample.`
        )
      }
      if (!body) return m.reply('🎙️ Add the words after the command:\n*.voiceclone how are you*')
      await m.react('🎙️')
      try {
        const sample = await src.download()
        const { audio, lang } = await cloneSpeak(sample, body)
        await m.reply({ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true })
        await m.reply(`🎙️ *VOICE CLONE*\n🗣️ ${lang} · shaped to the sample you replied to\n\n_Save this voice: *.savevoice mum*_`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'savevoice',
    alias: ['addvoice'],
    category: 'VOICE',
    desc: 'Save a voice note as a named clone profile',
    usage: '.savevoice mum  (reply to a voice note)',
    cooldown: 10,
    async run({ m, args }) {
      const name = (args[0] || '').trim().toLowerCase()
      const src = voiceSrc(m)
      if (!name || !/^[a-z0-9_-]{1,20}$/.test(name)) {
        return m.reply('💾 Usage: reply to a voice note with *.savevoice mum*')
      }
      if (!src) return m.reply('💾 Reply to the voice note you want to save.')
      await m.react('💾')
      try {
        const profile = await analyzeVoice(await src.download())
        await DB.voices.set(keyOf(m, name), { ...profile, at: Date.now() })
        await m.reply(
          `💾 Saved voice *${name}*\n` +
            `🎚️ Pitch ${profile.pitchRatio} · brightness ${profile.brightness}\n\n` +
            `Use it: *.usevoice ${name} I am on my way*`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'usevoice',
    alias: ['sayas', 'vnsay'],
    category: 'VOICE',
    desc: 'Speak text using a saved voice profile',
    usage: '.usevoice mum I am on my way',
    cooldown: 10,
    async run({ m, args, text }) {
      const name = (args[0] || '').trim().toLowerCase()
      const body = text.replace(/^\S+\s*/, '').trim() || m.quoted?.text
      if (!name || !body) return m.reply('🗣️ Usage: *.usevoice mum I am on my way*')
      const row = await DB.voices.findOne(keyOf(m, name))
      if (!row) return m.reply(`❌ No saved voice called *${name}*.\nSave one with *.savevoice ${name}* (reply to a VN).`)
      await m.react('🎙️')
      try {
        const { audio } = await cloneSpeak(null, body, { profile: row })
        await m.reply({ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'myvoices',
    alias: ['voicelist', 'voices'],
    category: 'VOICE',
    desc: 'List the voice profiles you have saved',
    usage: '.myvoices',
    async run({ m }) {
      const rows = await DB.voices.find({ owner: m.sender })
      if (!rows.length) return m.reply('📭 No saved voices. Reply to a VN with *.savevoice name*')
      await m.reply(
        `🎙️ *YOUR VOICES*\n\n` +
          rows.map((r) => `• *${r.name}*  pitch ${r.pitchRatio} · ${new Date(r.at || 0).toLocaleDateString()}`).join('\n') +
          `\n\n*.usevoice <name> <text>*`
      )
    }
  },
  {
    name: 'delvoice',
    alias: ['rmvoice'],
    category: 'VOICE',
    desc: 'Delete a saved voice profile',
    usage: '.delvoice mum',
    async run({ m, args }) {
      const name = (args[0] || '').trim().toLowerCase()
      if (!name) return m.reply('🗑️ Usage: *.delvoice mum*')
      const row = await DB.voices.findOne(keyOf(m, name))
      if (!row) return m.reply(`❌ No voice called *${name}*.`)
      await DB.voices.delete(keyOf(m, name))
      await m.reply(`🗑️ Voice *${name}* deleted.`)
    }
  },
  {
    name: 'speak',
    alias: ['vtts', 'sayvn'],
    category: 'VOICE',
    desc: 'Speak text as a WhatsApp voice note (auto language)',
    usage: '.speak hello there   |  .speak yo: bawo ni',
    cooldown: 8,
    async run({ m, text }) {
      const raw = text || m.quoted?.text
      if (!raw) return m.reply('🗣️ Usage: *.speak hello there*\nOr *.speak yo: bawo ni* for a language code.')
      const tagged = raw.match(/^([a-z]{2}):\s*([\s\S]+)/i)
      const lang = tagged ? tagged[1].toLowerCase() : detectLang(raw)
      const body = tagged ? tagged[2] : raw
      await m.react('🗣️')
      try {
        const { audio } = await speakPlain(body, { lang, ptt: true })
        await m.reply({ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true })
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'voiceprint',
    alias: ['vprint', 'readvoice'],
    category: 'VOICE',
    desc: 'Show the pitch and tone of a voice note',
    usage: '.voiceprint (reply to a voice note)',
    cooldown: 8,
    async run({ m }) {
      const src = voiceSrc(m)
      if (!src) return m.reply('🎚️ Reply to a voice note with *.voiceprint*')
      await m.react('🎚️')
      try {
        const p = await analyzeVoice(await src.download())
        const kind = p.pitchRatio < 0.9 ? 'deeper / warmer' : p.pitchRatio > 1.1 ? 'brighter / higher' : 'mid range'
        await m.reply(
          `🎚️ *VOICE PRINT*\n\n` +
            `Pitch ratio: *${p.pitchRatio}*\n` +
            `Brightness: *${p.brightness}*\n` +
            `Read: ${kind}\n\n` +
            `_Reply with *.voiceclone your words* to speak as this voice._`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
