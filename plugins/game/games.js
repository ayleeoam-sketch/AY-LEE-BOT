import { getJson } from '../../src/lib/api.js'
import { getUser, saveUser, CURRENCY, comma, rand } from '../../src/lib/economy.js'
import { pick } from '../../src/lib/utils.js'

/* ------------------------- Tic Tac Toe ------------------------- */
const ttt = new Map() // chat -> game

const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
const render = (b) =>
  b.map((c, i) => (c === ' ' ? ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'][i] : c === 'X' ? '❌' : '⭕'))
    .reduce((s, c, i) => s + c + ((i + 1) % 3 ? ' ' : '\n'), '')

const winner = (b) => {
  for (const [a, c, d] of WINS) if (b[a] !== ' ' && b[a] === b[c] && b[c] === b[d]) return b[a]
  return b.includes(' ') ? null : 'draw'
}

/* --------------------------- Word game --------------------------- */
const wcg = new Map()
const WORDS = [
  'javascript','whatsapp','nigeria','elephant','computer','keyboard','mountain','rainbow',
  'chocolate','butterfly','adventure','telephone','university','beautiful','friendship',
  'knowledge','happiness','celebrate','wonderful','dangerous','fantastic','important'
]
const scramble = (w) => {
  const a = [...w]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  const out = a.join('')
  return out === w ? scramble(w) : out
}

/* ---------------------------- Hangman ---------------------------- */
const hang = new Map()
const STAGES = [
  '```\n  +---+\n      |\n      |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n      |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n  |   |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n /|   |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n /|\\  |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n /|\\  |\n /    |\n     ===```',
  '```\n  +---+\n  O   |\n /|\\  |\n / \\  |\n     ===```'
]

export default [
  {
    name: 'ttt',
    alias: ['tictactoe'],
    category: 'GAME',
    desc: 'Play tic tac toe against someone',
    usage: '.ttt (then reply with 1-9)',
    group: true,
    async run({ m }) {
      if (ttt.has(m.chat)) {
        const g = ttt.get(m.chat)
        return m.reply({
          text: `🎮 A game is already running.\n\n${render(g.board)}\nTurn: @${g.turn.split('@')[0]} (${g.symbol[g.turn]})\n\nEnd it with *.delttt*`,
          mentions: [g.turn]
        })
      }
      const opponent = m.mentions?.[0] || m.quoted?.sender
      if (!opponent) return m.reply('🎮 Tag someone to play: *.ttt @user*')
      if (opponent === m.sender) return m.reply('🤨 You cannot play against yourself.')

      ttt.set(m.chat, {
        board: Array(9).fill(' '),
        players: [m.sender, opponent],
        symbol: { [m.sender]: 'X', [opponent]: 'O' },
        turn: m.sender
      })
      await m.reply({
        text: `🎮 *TIC TAC TOE*\n\n❌ @${m.senderNumber}\n⭕ @${opponent.split('@')[0]}\n\n${render(Array(9).fill(' '))}\nTurn: @${m.senderNumber} (❌)\n\nSend a number 1-9 to play.`,
        mentions: [m.sender, opponent]
      })
    },

    async before({ sock, m }) {
      const g = ttt.get(m.chat)
      if (!g || !/^[1-9]$/.test((m.body || '').trim())) return false
      if (!g.players.includes(m.sender)) return false
      if (m.sender !== g.turn) {
        await m.reply('⏳ Not your turn.')
        return true
      }
      const pos = parseInt(m.body.trim()) - 1
      if (g.board[pos] !== ' ') {
        await m.reply('❌ That square is taken.')
        return true
      }
      g.board[pos] = g.symbol[m.sender]
      const result = winner(g.board)

      if (result === 'draw') {
        ttt.delete(m.chat)
        await m.reply(`🎮 *DRAW!*\n\n${render(g.board)}\nNobody wins.`)
        return true
      }
      if (result) {
        ttt.delete(m.chat)
        const won = await getUser(m.sender)
        won.wallet += 500
        await saveUser(won)
        await m.reply({
          text: `🎮 *WINNER!*\n\n${render(g.board)}\n🏆 @${m.senderNumber} wins and earns ${CURRENCY} 500!`,
          mentions: [m.sender]
        })
        return true
      }
      g.turn = g.players.find((p) => p !== m.sender)
      await sock.sendMessage(m.chat, {
        text: `${render(g.board)}\nTurn: @${g.turn.split('@')[0]} (${g.symbol[g.turn] === 'X' ? '❌' : '⭕'})`,
        mentions: [g.turn]
      })
      return true
    }
  },
  {
    name: 'delttt',
    alias: ['endttt'],
    category: 'GAME',
    desc: 'End the current tic tac toe game',
    usage: '.delttt',
    group: true,
    async run({ m }) {
      if (!ttt.has(m.chat)) return m.reply('❌ No game running.')
      ttt.delete(m.chat)
      await m.reply('🛑 Game ended.')
    }
  },
  {
    name: 'wcg',
    alias: ['wordgame', 'scramble'],
    category: 'GAME',
    desc: 'Unscramble the word to win coins',
    usage: '.wcg',
    group: true,
    async run({ m }) {
      if (wcg.has(m.chat)) return m.reply('🎮 A word game is already running. Use *.delwcg* to stop it.')
      const word = pick(WORDS)
      const prize = 200 + word.length * 30
      wcg.set(m.chat, { word, prize, at: Date.now() })

      // auto-expire after 60s
      setTimeout(async () => {
        const g = wcg.get(m.chat)
        if (g && g.word === word) {
          wcg.delete(m.chat)
          await m.send(`⏰ Time is up! The word was *${word}*.`).catch(() => {})
        }
      }, 60_000)

      await m.reply(
        `🎮 *WORD SCRAMBLE*\n\n` +
          `🔤 Unscramble: *${scramble(word).toUpperCase()}*\n` +
          `📏 Length: ${word.length}\n` +
          `💰 Prize: ${CURRENCY} ${comma(prize)}\n` +
          `⏰ You have 60 seconds.\n\n` +
          `Just type your answer.`
      )
    },

    async before({ m }) {
      const g = wcg.get(m.chat)
      if (!g || !m.body) return false
      const guess = m.body.trim().toLowerCase()
      if (!/^[a-z]+$/.test(guess)) return false
      if (guess !== g.word) return false

      wcg.delete(m.chat)
      const u = await getUser(m.sender)
      u.wallet += g.prize
      await saveUser(u)
      await m.reply({
        text: `🎉 *CORRECT!*\n\nThe word was *${g.word}*\n🏆 @${m.senderNumber} wins ${CURRENCY} ${comma(g.prize)}!\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`,
        mentions: [m.sender]
      })
      return true
    }
  },
  {
    name: 'delwcg',
    category: 'GAME',
    desc: 'Stop the current word game',
    usage: '.delwcg',
    group: true,
    async run({ m }) {
      if (!wcg.has(m.chat)) return m.reply('❌ No word game running.')
      const g = wcg.get(m.chat)
      wcg.delete(m.chat)
      await m.reply(`🛑 Game ended. The word was *${g.word}*.`)
    }
  },
  {
    name: 'hangman',
    category: 'GAME',
    desc: 'Play hangman',
    usage: '.hangman',
    group: true,
    async run({ m }) {
      if (hang.has(m.chat)) return m.reply('🎮 A hangman game is already running. Use *.delhangman* to stop it.')
      const word = pick(WORDS)
      hang.set(m.chat, { word, guessed: new Set(), wrong: 0 })
      await m.reply(
        `🎮 *HANGMAN*\n\n${STAGES[0]}\n\n` +
          `${word.split('').map(() => '_').join(' ')}\n\n` +
          `📏 ${word.length} letters\n💡 Guess one letter at a time by typing it.`
      )
    },

    async before({ m }) {
      const g = hang.get(m.chat)
      if (!g || !m.body) return false
      const letter = m.body.trim().toLowerCase()
      if (!/^[a-z]$/.test(letter)) return false
      if (g.guessed.has(letter)) {
        await m.reply(`❌ "${letter}" was already guessed.`)
        return true
      }
      g.guessed.add(letter)

      if (!g.word.includes(letter)) {
        g.wrong++
        if (g.wrong >= 6) {
          hang.delete(m.chat)
          await m.reply(`💀 *GAME OVER*\n\n${STAGES[6]}\n\nThe word was *${g.word}*.`)
          return true
        }
      }

      const display = g.word.split('').map((c) => (g.guessed.has(c) ? c : '_')).join(' ')
      if (!display.includes('_')) {
        hang.delete(m.chat)
        const u = await getUser(m.sender)
        u.wallet += 400
        await saveUser(u)
        await m.reply({
          text: `🎉 *YOU WON!*\n\nThe word was *${g.word}*\n🏆 @${m.senderNumber} earns ${CURRENCY} 400!`,
          mentions: [m.sender]
        })
        return true
      }

      await m.reply(
        `${STAGES[g.wrong]}\n\n${display}\n\n` +
          `${g.word.includes(letter) ? '✅ Correct!' : '❌ Wrong!'}\n` +
          `🔤 Guessed: ${[...g.guessed].join(', ')}\n` +
          `❤️ Lives: ${6 - g.wrong}/6`
      )
      return true
    }
  },
  {
    name: 'delhangman',
    category: 'GAME',
    desc: 'Stop the current hangman game',
    usage: '.delhangman',
    group: true,
    async run({ m }) {
      if (!hang.has(m.chat)) return m.reply('❌ No hangman game running.')
      const g = hang.get(m.chat)
      hang.delete(m.chat)
      await m.reply(`🛑 Game ended. The word was *${g.word}*.`)
    }
  },
  {
    name: 'trivia',
    alias: ['quiz'],
    category: 'GAME',
    desc: 'Answer a trivia question for coins',
    usage: '.trivia',
    group: true,
    cooldown: 10,
    async run({ m }) {
      try {
        const d = await getJson('https://opentdb.com/api.php?amount=1&type=multiple')
        const q = d.results?.[0]
        if (!q) return m.reply('❌ Could not fetch a question.')

        const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&eacute;/g, 'é').replace(/&rsquo;/g, "'")
        const answers = [...q.incorrect_answers, q.correct_answer].map(decode).sort(() => Math.random() - 0.5)
        const correctIndex = answers.indexOf(decode(q.correct_answer))
        const letters = ['A', 'B', 'C', 'D']

        await m.reply(
          `🧠 *TRIVIA*\n\n` +
            `📚 ${decode(q.category)} (${q.difficulty})\n\n` +
            `❓ ${decode(q.question)}\n\n` +
            answers.map((a, i) => `${letters[i]}. ${a}`).join('\n') +
            `\n\n⏰ Answer revealed in 20 seconds.`
        )

        setTimeout(() => {
          m.send(`✅ The answer was *${letters[correctIndex]}. ${decode(q.correct_answer)}*`).catch(() => {})
        }, 20_000)
      } catch (e) {
        await m.reply(`❌ ${e.message}`)
      }
    }
  },
  {
    name: 'guess',
    category: 'GAME',
    desc: 'Guess the number 1-100 for coins',
    usage: '.guess 42',
    async run({ m, args }) {
      const guess = parseInt(args[0])
      if (!guess || guess < 1 || guess > 100) return m.reply('🔢 Pick a number between 1 and 100: *.guess 42*')
      const target = rand(1, 100)
      const diff = Math.abs(target - guess)

      let prize = 0
      let verdict
      if (diff === 0) { prize = 2000; verdict = '🎯 *PERFECT!*' }
      else if (diff <= 3) { prize = 500; verdict = '🔥 So close!' }
      else if (diff <= 10) { prize = 100; verdict = '👍 Not bad.' }
      else verdict = '❌ Way off.'

      if (prize) {
        const u = await getUser(m.sender)
        u.wallet += prize
        await saveUser(u)
      }
      await m.reply(
        `🔢 *NUMBER GUESS*\n\nYou guessed: *${guess}*\nThe number was: *${target}*\n\n${verdict}` +
          (prize ? `\n💰 You win ${CURRENCY} ${comma(prize)}!` : '')
      )
    }
  }
]
