import { getJson, race } from '../../src/lib/api.js'
import { pick } from '../../src/lib/utils.js'

export default [
  {
    name: 'quote',
    alias: ['inspire'],
    category: 'MISC',
    desc: 'Inspirational quote',
    usage: '.quote',
    cooldown: 3,
    async run({ m }) {
      try {
        const d = await race([
          async () => {
            const r = await getJson('https://zenquotes.io/api/random')
            if (!r?.[0]?.q) throw new Error('bad shape')
            return { q: r[0].q, a: r[0].a }
          },
          async () => {
            const r = await getJson('https://api.quotable.io/random')
            if (!r?.content) throw new Error('bad shape')
            return { q: r.content, a: r.author }
          },
          async () => {
            const r = await getJson('https://dummyjson.com/quotes/random')
            if (!r?.quote) throw new Error('bad shape')
            return { q: r.quote, a: r.author }
          }
        ])
        await m.reply(`💭 _"${d.q}"_\n\n— *${d.a}*`)
      } catch {
        await m.reply(`💭 _"${pick([
          'The best time to plant a tree was 20 years ago. The second best time is now.',
          'Discipline is choosing between what you want now and what you want most.',
          'It always seems impossible until it is done.'
        ])}"_`)
      }
    }
  },
  {
    name: 'fact',
    alias: ['randomfact'],
    category: 'MISC',
    desc: 'Random interesting fact',
    usage: '.fact',
    cooldown: 3,
    async run({ m }) {
      try {
        const d = await race([
          async () => {
            const r = await getJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en')
            if (!r?.text) throw new Error('bad shape')
            return r.text
          },
          async () => {
            const r = await getJson('https://api.api-ninjas.com/v1/facts')
            if (!r?.[0]?.fact) throw new Error('bad shape')
            return r[0].fact
          }
        ])
        await m.reply(`🧠 *Did you know?*\n\n${d}`)
      } catch {
        await m.reply(`🧠 *Did you know?*\n\n${pick([
          'Honey never spoils. Edible honey has been found in 3000-year-old tombs.',
          'Octopuses have three hearts and blue blood.',
          'Bananas are berries, but strawberries are not.'
        ])}`)
      }
    }
  },
  {
    name: 'advice',
    category: 'MISC',
    desc: 'Random piece of advice',
    usage: '.advice',
    cooldown: 3,
    async run({ m }) {
      try {
        const d = await getJson(`https://api.adviceslip.com/advice?t=${Date.now()}`)
        const slip = typeof d === 'string' ? JSON.parse(d)?.slip : d?.slip
        if (!slip?.advice) throw new Error('bad shape')
        await m.reply(`💡 ${slip.advice}`)
      } catch {
        await m.reply(`💡 ${pick([
          'Do not compare your beginning to someone else\'s middle.',
          'If it costs you your peace, it is too expensive.',
          'Sleep on big decisions. Clarity comes in the morning.'
        ])}`)
      }
    }
  }
]
