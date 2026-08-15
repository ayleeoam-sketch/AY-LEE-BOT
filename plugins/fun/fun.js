import { getJson, getBuffer, race } from '../../src/lib/api.js'
import { pick } from '../../src/lib/utils.js'

/**
 * Reaction GIFs.
 * Primary: api.otakugifs.xyz (70 reactions, keyless, verified live)
 * Fallback: purrbot.site for the reactions it also carries.
 */
const PURRBOT = ['hug', 'kiss', 'pat', 'slap', 'cuddle', 'poke', 'lick', 'bite', 'dance', 'blush', 'cry', 'smile', 'tickle']

const reactionGif = (name) =>
  race([
    async () => (await getJson(`https://api.otakugifs.xyz/gif?reaction=${name}`)).url,
    async () => {
      if (!PURRBOT.includes(name)) throw new Error('no fallback')
      return (await getJson(`https://purrbot.site/api/img/sfw/${name}/gif`)).link
    }
  ])

/** Builds a reaction command that tags a target. */
const reaction = (name, phrase, emoji, apiName = name) => ({
  name,
  category: 'FUN',
  desc: `${phrase} someone`,
  usage: `.${name} @user`,
  cooldown: 5,
  async run({ m }) {
    const target = m.mentions?.[0] || m.quoted?.sender
    try {
      const url = await reactionGif(apiName)
      const buffer = await getBuffer(url)
      const caption = target
        ? `${emoji} @${m.senderNumber} ${phrase} @${target.split('@')[0]}`
        : `${emoji} @${m.senderNumber} ${phrase}`
      await m.reply({
        video: buffer,
        caption,
        gifPlayback: true,
        mentions: target ? [m.sender, target] : [m.sender]
      })
    } catch (e) {
      await m.reply(`❌ ${e.message}`)
    }
  }
})

/** Mood commands - no target needed. */
const mood = (name, label, emoji, apiName = name) => ({
  name,
  category: 'FUN',
  desc: `Send a "${label}" reaction GIF`,
  usage: `.${name}`,
  cooldown: 5,
  async run({ m }) {
    try {
      const buffer = await getBuffer(await reactionGif(apiName))
      await m.reply({
        video: buffer,
        caption: `${emoji} @${m.senderNumber} ${label}`,
        gifPlayback: true,
        mentions: [m.sender]
      })
    } catch (e) {
      await m.reply(`❌ ${e.message}`)
    }
  }
})

export default [
  /* ---------------------- targeted reactions ---------------------- */
  reaction('slap', 'slapped', '👋'),
  reaction('hug', 'hugged', '🤗'),
  reaction('kiss', 'kissed', '😘'),
  reaction('pat', 'patted', '🫳'),
  reaction('cuddle', 'cuddled', '🥰'),
  reaction('tickle', 'tickled', '🤭'),
  reaction('poke', 'poked', '👉'),
  reaction('punch', 'punched', '👊'),
  reaction('bite', 'bit', '😬'),
  reaction('lick', 'licked', '👅'),
  reaction('nuzzle', 'nuzzled', '🥺'),
  reaction('handhold', 'held hands with', '🤝'),
  reaction('brofist', 'brofisted', '👊'),
  reaction('airkiss', 'blew a kiss at', '😙'),
  reaction('stare', 'stared at', '👀'),
  reaction('smack', 'smacked', '💥'),
  reaction('pinch', 'pinched', '🤏'),
  reaction('feed', 'fed', '🍽️', 'nom'),
  reaction('wave', 'waved at', '👋'),
  reaction('wink', 'winked at', '😉'),
  reaction('love', 'loves', '❤️'),
  reaction('angrystare', 'angrily stared at', '😠'),

  /* -------------------------- mood GIFs -------------------------- */
  mood('dance', 'is dancing', '💃'),
  mood('cry', 'is crying', '😢'),
  mood('blush', 'is blushing', '😊'),
  mood('laugh', 'is laughing', '😂'),
  mood('smug', 'looks smug', '😏'),
  mood('happy', 'is happy', '😄'),
  mood('sad', 'is sad', '😔'),
  mood('mad', 'is mad', '😡'),
  mood('shy', 'is shy', '☺️'),
  mood('pout', 'is pouting', '😤'),
  mood('sleep', 'is sleeping', '😴'),
  mood('shrug', 'shrugs', '🤷'),
  mood('facepalm', 'facepalms', '🤦'),
  mood('celebrate', 'is celebrating', '🎉'),
  mood('confused', 'is confused', '😕'),
  mood('cool', 'is being cool', '😎'),
  mood('scared', 'is scared', '😨'),
  mood('yawn', 'yawns', '🥱'),
  mood('thumbsup', 'approves', '👍'),
  mood('clap', 'is clapping', '👏'),
  mood('evillaugh', 'laughs evilly', '😈'),
  mood('nervous', 'is nervous', '😅'),

  /* --------------------------- animals --------------------------- */
  {
    name: 'meow',
    alias: ['cat'],
    category: 'FUN',
    desc: 'Random cat picture',
    usage: '.meow',
    cooldown: 5,
    async run({ m }) {
      try {
        const url = await race([
          async () => (await getJson('https://api.thecatapi.com/v1/images/search'))[0]?.url,
          async () => `https://cataas.com/cat?${Date.now()}`
        ])
        await m.reply({ image: await getBuffer(url), caption: '🐱 Meow!' })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'woof',
    alias: ['dog'],
    category: 'FUN',
    desc: 'Random dog picture',
    usage: '.woof',
    cooldown: 5,
    async run({ m }) {
      try {
        const d = await getJson('https://dog.ceo/api/breeds/image/random')
        await m.reply({ image: await getBuffer(d.message), caption: '🐶 Woof!' })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'fox',
    alias: ['foxgirl'],
    category: 'FUN',
    desc: 'Random fox picture',
    usage: '.fox',
    cooldown: 5,
    async run({ m }) {
      try {
        const d = await getJson('https://randomfox.ca/floof/')
        await m.reply({ image: await getBuffer(d.image), caption: '🦊' })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'duck',
    alias: ['goose'],
    category: 'FUN',
    desc: 'Random duck picture',
    usage: '.duck',
    cooldown: 5,
    async run({ m }) {
      try {
        const d = await getJson('https://random-d.uk/api/random')
        await m.reply({ image: await getBuffer(d.url), caption: '🦆 Quack!' })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'pokemon',
    alias: ['poke-dex', 'dex'],
    category: 'FUN',
    desc: 'Look up a Pokémon',
    usage: '.pokemon pikachu',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .pokemon pikachu')
      try {
        const d = await getJson(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(text.toLowerCase())}`)
        const stats = d.stats.map((s) => `┃ ${s.stat.name}: ${s.base_stat}`).join('\n')
        const img = d.sprites?.other?.['official-artwork']?.front_default || d.sprites?.front_default
        const caption =
          `╭━━━〔 *${d.name.toUpperCase()}* #${d.id} 〕━━━╮\n` +
          `┃ 📏 Height: ${d.height / 10} m\n` +
          `┃ ⚖️ Weight: ${d.weight / 10} kg\n` +
          `┃ 🏷️ Types: ${d.types.map((t) => t.type.name).join(', ')}\n` +
          `┃ ✨ Abilities: ${d.abilities.map((a) => a.ability.name).join(', ')}\n` +
          `┃\n${stats}\n╰━━━━━━━━━━━━━━━╯`
        if (img) await m.reply({ image: await getBuffer(img), caption })
        else await m.reply(caption)
      } catch {
        await m.reply(`❌ No Pokémon called "${text}".`)
      }
    }
  },

  /* ------------------------- text-based fun ------------------------- */
  {
    name: 'joke',
    category: 'FUN',
    desc: 'Random joke',
    usage: '.joke',
    cooldown: 3,
    async run({ m }) {
      try {
        const d = await getJson('https://official-joke-api.appspot.com/random_joke')
        await m.reply(`😂 *${d.setup}*\n\n_${d.punchline}_`)
      } catch {
        await m.reply(`😂 ${pick([
          'Why do programmers prefer dark mode? Because light attracts bugs.',
          'I told my computer I needed a break. It said "why, you already have a cache".',
          'There are 10 kinds of people: those who understand binary and those who do not.'
        ])}`)
      }
    }
  },
  {
    name: 'pickupline',
    alias: ['pickupl'],
    category: 'FUN',
    desc: 'Cheesy pickup line',
    usage: '.pickupline',
    cooldown: 3,
    async run({ m }) {
      await m.reply(`💘 ${pick([
        'Are you a WhatsApp notification? Because you always make my heart light up.',
        'Do you have a name, or can I call you mine?',
        'Are you Wi-Fi? Because I am feeling a connection.',
        'If beauty were time, you would be eternity.',
        'Is your name Google? Because you have everything I am searching for.',
        'Are you a bank loan? Because you have my interest.'
      ])}`)
    }
  },
  {
    name: 'wyr',
    category: 'FUN',
    desc: 'Would you rather...',
    usage: '.wyr',
    cooldown: 3,
    async run({ m }) {
      await m.reply(`🤔 *Would you rather...*\n\n${pick([
        'be able to fly but only 1 metre off the ground, or be invisible only when nobody is looking?',
        'have unlimited money but no friends, or many friends but always be broke?',
        'never use the internet again, or never watch another film?',
        'always speak your mind, or never speak again?',
        'be the funniest person alive, or the smartest?'
      ])}`)
    }
  },
  {
    name: 'truth',
    category: 'FUN',
    desc: 'Truth question',
    usage: '.truth',
    cooldown: 3,
    async run({ m }) {
      await m.reply(`🎯 *TRUTH*\n\n${pick([
        'What is the biggest lie you have ever told?',
        'Who in this group would you trust with your phone unlocked?',
        'What is your most embarrassing memory?',
        'Have you ever pretended to be busy to avoid someone here?',
        'What is a secret you have never told anyone?'
      ])}`)
    }
  },
  {
    name: 'dare',
    category: 'FUN',
    desc: 'Dare challenge',
    usage: '.dare',
    cooldown: 3,
    async run({ m }) {
      await m.reply(`🔥 *DARE*\n\n${pick([
        'Send the last photo in your gallery to this group.',
        'Change your profile picture to a cartoon for one hour.',
        'Voice note the group singing your favourite song.',
        'Type only in emojis for the next 10 messages.',
        'Let the group pick your next status.'
      ])}`)
    }
  },
  {
    name: 'rate',
    category: 'FUN',
    desc: 'Rate anything out of 100',
    usage: '.rate something',
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .rate my cooking')
      await m.reply(`📊 I rate *${text}* a solid *${Math.floor(Math.random() * 101)}/100*`)
    }
  },
  {
    name: 'ship',
    category: 'FUN',
    desc: 'Ship two people together',
    usage: '.ship @user1 @user2',
    group: true,
    async run({ m }) {
      const [a, b] = m.mentions || []
      if (!a || !b) return m.reply('💞 Tag two people: *.ship @user1 @user2*')
      const score = Math.floor(Math.random() * 101)
      const bar = '█'.repeat(Math.round(score / 10)).padEnd(10, '░')
      const verdict = score > 80 ? 'Soulmates! 💍' : score > 60 ? 'Great match! 💖' : score > 40 ? 'Could work 🤔' : score > 20 ? 'Just friends 😅' : 'Absolutely not 💔'
      await m.reply({
        text: `💞 *SHIPPING*\n\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}\n\n${bar} *${score}%*\n\n${verdict}`,
        mentions: [a, b]
      })
    }
  },
  {
    name: 'insult',
    category: 'FUN',
    desc: 'Playfully insult someone',
    usage: '.insult @user',
    async run({ m }) {
      const target = m.mentions?.[0] || m.quoted?.sender
      const line = pick([
        'You bring everyone so much joy... when you leave the room.',
        'You have the perfect face for radio.',
        'If laughter is the best medicine, your face must be curing the world.',
        'You are proof that even AI makes mistakes.',
        'Your secrets are safe with me. I never even listen.'
      ])
      if (target) await m.reply({ text: `🔥 @${target.split('@')[0]} ${line}`, mentions: [target] })
      else await m.reply(`🔥 ${line}`)
    }
  },
  {
    name: 'emojimix',
    alias: ['emix'],
    category: 'FUN',
    desc: 'Blend two emojis into a sticker',
    usage: '.emojimix 😂+🥰',
    cooldown: 5,
    async run({ m, text, config }) {
      if (!text.includes('+')) return m.reply('📝 Usage: *.emojimix 😂+🥰*')
      const [a, b] = text.split('+').map((s) => s.trim())
      try {
        // Google's public Emoji Kitchen key - published by Google for this
        // endpoint, not a private credential. Safe to commit.
        const TENOR_PUBLIC_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ'
        const d = await getJson(
          `https://tenor.googleapis.com/v2/featured?key=${TENOR_PUBLIC_KEY}&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(a)}_${encodeURIComponent(b)}`
        )
        const url = d?.results?.[0]?.url
        if (!url) return m.reply('❌ That emoji combination is not supported.')
        const { toSticker, addExif } = await import('../../src/lib/media.js')
        let webp = await toSticker(await getBuffer(url))
        webp = await addExif(webp, config.botName, config.ownerName)
        await m.reply({ sticker: webp })
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'urban',
    alias: ['ud'],
    category: 'SEARCH',
    desc: 'Urban Dictionary definition',
    usage: '.urban rizz',
    cooldown: 5,
    async run({ m, text }) {
      if (!text) return m.reply('📝 Usage: .urban rizz')
      try {
        const d = await getJson(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(text)}`)
        if (!d.list?.length) return m.reply(`❌ No definition found for "${text}".`)
        const e = d.list[0]
        await m.reply(
          `📖 *${text.toUpperCase()}*\n\n` +
            `*Definition:*\n${e.definition.replace(/[\[\]]/g, '').slice(0, 800)}\n\n` +
            `*Example:*\n_${(e.example || 'none').replace(/[\[\]]/g, '').slice(0, 400)}_\n\n` +
            `👍 ${e.thumbs_up}  👎 ${e.thumbs_down}`
        )
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
