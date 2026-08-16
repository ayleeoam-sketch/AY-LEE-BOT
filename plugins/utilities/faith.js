import { getJson } from '../../src/lib/api.js'

/**
 * Faith utilities people ask for daily - all keyless APIs.
 *
 *   .quran 2:255            -> an ayah, Arabic + English side by side
 *   .praytimes <city> [country]  -> today's 5 prayers for that city
 */

const stripTags = (s = '') => s.replace(/<[^>]+>/g, '').trim()

export function pickPrayerTimes(t) {
  const keys = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
  return keys
    .map((k) => (t[k] ? { name: k, time: t[k] } : null))
    .filter(Boolean)
}

export default [
  {
    name: 'quran',
    alias: ['ayah', 'ayat'],
    category: 'UTILITIES',
    desc: 'Read a Quran verse in Arabic with English translation',
    usage: '.quran 2:255   |   .quran 1:1',
    cooldown: 5,
    async run({ m, text }) {
      const ref = (text || '').trim()
      if (!/^\d{1,3}:\d{1,3}$/.test(ref)) {
        return m.reply('📖 Usage: *.quran 2:255* (surah:verse)')
      }
      await m.react('📖')
      try {
        const [en, ar] = await Promise.all([
          getJson(`https://api.alquran.cloud/v1/ayah/${encodeURIComponent(ref)}/en.asad`),
          getJson(`https://api.alquran.cloud/v1/ayah/${encodeURIComponent(ref)}/quran-uthmani`)
        ])
        const ed = en?.data
        const ad = ar?.data
        if (!ed?.text) return m.reply(`📖 Could not find ${ref} - check the surah:verse number.`)

        await m.reply(
          `╭━━━〔 *QURAN ${ref}* 〕━━━╮\n` +
            `┃ 📕 ${ed.surah?.englishName || ''} (${ed.surah?.name || ''})\n` +
            `┃ 🕌 Surah ${ed.surah?.number} · Ayah ${ed.numberInSurah} · Juz ${ed.juz}\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            (ad?.text ? `${ad.text}\n\n` : '') +
            `_${stripTags(ed.text)}_\n\n*The Holy Quran*`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'praytimes',
    alias: ['adhan', 'salah', 'prayer'],
    category: 'UTILITIES',
    desc: "Today's prayer times for a city",
    usage: '.praytimes lagos  |  .praytimes kano nigeria',
    cooldown: 8,
    async run({ m, text }) {
      const input = (text || '').trim()
      if (!input) return m.reply('🕌 Usage: *.praytimes lagos* or *.praytimes kano nigeria*')
      await m.react('🕌')
      try {
        const pieces = input.split(/\s+/)
        const city = pieces.length > 1 ? pieces[0] : input
        const country = pieces.length > 1 ? pieces.slice(1).join(' ') : ''
        const url =
          `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}` +
          (country ? `&country=${encodeURIComponent(country)}` : '') +
          `&method=1`
        const d = await getJson(url)
        const t = d?.data?.timings
        if (!t) return m.reply(`🕌 No prayer times for "${input}". Try *.praytimes city country*`)

        const meta = d.data.meta
        const dateLine = d.data.date?.readable
        const rows = pickPrayerTimes(t)
          .map((r) => `┃ 🕋 ${r.name.padEnd(10)} ${r.time}`)
          .join('\n')
        await m.reply(
          `╭━━━〔 *PRAYER TIMES* 〕━━━╮\n` +
            `┃ 📍 ${meta?.timezone ? `${input} (${meta.timezone})` : input}\n` +
            `┃ 📅 ${dateLine || ''}\n` +
            `┣━━━━━━━━━━━━━━━━━━━┫\n` +
            rows +
            `\n╰━━━━━━━━━━━━━━━━━━━╯`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
