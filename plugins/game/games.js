import { getJson } from '../../src/lib/api.js'
import {
  getUser,
  saveUser,
  CURRENCY,
  comma,
  rand
} from '../../src/lib/economy.js'
import { pick } from '../../src/lib/utils.js'

/*
 * ================================================================
 * AY-LEE BOT — GROUP GAMES
 * ================================================================
 *
 * ARCHITECTURE
 *
 * Only the bot owner/admin starts a game using the "." prefix.
 *
 * Example:
 *
 * .dicebattle @user1 @user2
 *
 * The selected players then play normally.
 * They DO NOT need to use ".".
 *
 * The person starting the game does NOT have to participate.
 *
 * ================================================================
 */

/* ----------------------------------------------------------------
 * GAME STORAGE
 * ---------------------------------------------------------------- */

const games = new Map()

const getGame = (chat) => games.get(chat)

const setGame = (chat, game) => {
  games.set(chat, game)
}

const deleteGame = (chat) => {
  games.delete(chat)
}

/* ----------------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------------- */

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

const nameOf = (jid) =>
  `@${String(jid || '').split('@')[0]}`

const mentionUsers = (players = []) =>
  players.filter(Boolean)

const clean = (text = '') =>
  String(text).trim().toLowerCase()

const randomChoice = (arr) =>
  arr[Math.floor(Math.random() * arr.length)]

const shuffle = (arr) => {
  const a = [...arr]

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }

  return a
}

async function reward(jid, amount) {
  const u = await getUser(jid)

  u.wallet += amount

  await saveUser(u)

  return u
}

async function startDuel(m, command, playersNeeded = 2) {
  const mentions = [...new Set(m.mentions || [])]
  const sender = m.sender

  /*
   * PLAYER SELECTION
   *
   * 1 tag  → sender + tagged person
   * 2 tags → tagged person 1 + tagged person 2
   *
   * This allows the person starting the game to participate
   * without needing to tag themselves on WhatsApp.
   */

  let players

  if (mentions.length === playersNeeded - 1) {
    // Sender participates automatically
    players = [sender, ...mentions]
  } else if (mentions.length === playersNeeded) {
    // Sender is only starting the game
    players = mentions
  } else {
    const tagText =
      playersNeeded === 2
        ? `🎮 *Choose the players for the game.*\n\n` +
          `You can either:\n\n` +
          `1️⃣ *Play yourself:*\n` +
          `*.${command} @user*\n` +
          `→ You vs @user\n\n` +
          `2️⃣ *Let two other people play:*\n` +
          `*.${command} @user1 @user2*\n` +
          `→ @user1 vs @user2`
        : `🎮 *Choose ${playersNeeded} players.*\n\n` +
          `Tag ${playersNeeded - 1} players if you want to participate, ` +
          `or tag all ${playersNeeded} players if you are only starting the game.\n\n` +
          `Example:\n` +
          `*.${command} @user1 @user2*`

    return {
      error: tagText
    }
  }

  // Make absolutely sure there are no duplicate players
  const unique = [...new Set(players)]

  if (unique.length !== playersNeeded) {
    return {
      error: '❌ Each player must be different.'
    }
  }

  // Don't allow the same person to occupy multiple positions
  if (unique.includes(sender) && mentions.includes(sender)) {
    return {
      error: '❌ You cannot tag yourself. The bot already knows who started the game.'
    }
  }

  // Check whether another game is already running
  if (games.has(m.chat)) {
    return {
      error:
        '🎮 A game is already running in this group.\n\n' +
        'Use *.endgame* to stop it first.'
    }
  }

  return {
    players: unique
  }
}

function playerInGame(g, jid) {
  return g.players?.includes(jid)
}

/* ----------------------------------------------------------------
 * TIC TAC TOE
 * ---------------------------------------------------------------- */

const WINS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

function renderTTT(board) {
  const nums = [
    '1️⃣',
    '2️⃣',
    '3️⃣',
    '4️⃣',
    '5️⃣',
    '6️⃣',
    '7️⃣',
    '8️⃣',
    '9️⃣'
  ]

  return board
    .map((c, i) =>
      c === ' '
        ? nums[i]
        : c === 'X'
          ? '❌'
          : '⭕'
    )
    .reduce(
      (s, c, i) =>
        s + c + ((i + 1) % 3 ? ' ' : '\n'),
      ''
    )
}

function tttWinner(board) {
  for (const [a, b, c] of WINS) {
    if (
      board[a] !== ' ' &&
      board[a] === board[b] &&
      board[b] === board[c]
    ) {
      return board[a]
    }
  }

  return board.includes(' ') ? null : 'draw'
}

/* ----------------------------------------------------------------
 * WORD DATA
 * ---------------------------------------------------------------- */

const WORDS = [
  'javascript',
  'whatsapp',
  'nigeria',
  'elephant',
  'computer',
  'keyboard',
  'mountain',
  'rainbow',
  'chocolate',
  'butterfly',
  'adventure',
  'telephone',
  'university',
  'beautiful',
  'friendship',
  'knowledge',
  'happiness',
  'celebrate',
  'wonderful',
  'dangerous',
  'fantastic',
  'important',
  'football',
  'internet',
  'developer',
  'programming',
  'victory',
  'champion',
  'student',
  'technology'
]

function scrambleWord(word) {
  const a = [...word]

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))

    ;[a[i], a[j]] = [a[j], a[i]]
  }

  const result = a.join('')

  return result === word
    ? scrambleWord(word)
    : result
}

/* ----------------------------------------------------------------
 * QUESTIONS
 * ---------------------------------------------------------------- */

const QUESTIONS = [
  {
    q: 'What is the capital of Nigeria?',
    a: 'abuja',
    options: ['Lagos', 'Abuja', 'Ibadan', 'Kano']
  },
  {
    q: 'How many days are in a week?',
    a: '7',
    options: ['5', '6', '7', '8']
  },
  {
    q: 'Which planet is known as the Red Planet?',
    a: 'mars',
    options: ['Earth', 'Mars', 'Venus', 'Jupiter']
  },
  {
    q: 'What is 12 × 12?',
    a: '144',
    options: ['124', '134', '144', '154']
  },
  {
    q: 'Which language runs in a web browser?',
    a: 'javascript',
    options: ['Python', 'Java', 'JavaScript', 'C++']
  },
  {
    q: 'How many continents are there?',
    a: '7',
    options: ['5', '6', '7', '8']
  },
  {
    q: 'What is the largest ocean?',
    a: 'pacific',
    options: ['Atlantic', 'Indian', 'Pacific', 'Arctic']
  }
]

/* ----------------------------------------------------------------
 * EMOJIS
 * ---------------------------------------------------------------- */

const EMOJI_QUESTIONS = [
  {
    emoji: '🐘',
    answer: 'elephant'
  },
  {
    emoji: '🍕',
    answer: 'pizza'
  },
  {
    emoji: '⚽',
    answer: 'football'
  },
  {
    emoji: '🚗',
    answer: 'car'
  },
  {
    emoji: '🌧️☔',
    answer: 'rain'
  },
  {
    emoji: '🔥❤️',
    answer: 'love'
  },
  {
    emoji: '🐟🌊',
    answer: 'fish'
  },
  {
    emoji: '👑',
    answer: 'king'
  }
]

/* ----------------------------------------------------------------
 * ROCK PAPER SCISSORS
 * ---------------------------------------------------------------- */

const RPS = ['rock', 'paper', 'scissors']

function rpsWinner(a, b) {
  if (a === b) return 'draw'

  if (
    (a === 'rock' && b === 'scissors') ||
    (a === 'paper' && b === 'rock') ||
    (a === 'scissors' && b === 'paper')
  ) {
    return 'a'
  }

  return 'b'
}

/* ----------------------------------------------------------------
 * HANGMAN
 * ---------------------------------------------------------------- */

const HANGMAN_STAGES = [
  '```\n  +---+\n      |\n      |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n      |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n  |   |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n /|   |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n /|\\  |\n      |\n     ===```',
  '```\n  +---+\n  O   |\n /|\\  |\n /    |\n     ===```',
  '```\n  +---+\n  O   |\n /|\\  |\n / \\  |\n     ===```'
]

/* ----------------------------------------------------------------
 * CARDS
 * ---------------------------------------------------------------- */

const SUITS = ['♠️', '♥️', '♦️', '♣️']
const VALUES = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K'
]

function makeDeck() {
  const deck = []

  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value })
    }
  }

  return shuffle(deck)
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.value)) return 10
  if (card.value === 'A') return 11
  return Number(card.value)
}

function handValue(hand) {
  let total = hand.reduce(
    (sum, card) => sum + cardValue(card),
    0
  )

  let aces = hand.filter(
    (c) => c.value === 'A'
  ).length

  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }

  return total
}

/* ----------------------------------------------------------------
 * 1. TIC TAC TOE
 * ---------------------------------------------------------------- */

const tttGame = {
  name: 'ttt',
  alias: ['tictactoe'],
  category: 'GAME',
  desc: 'Two-player Tic Tac Toe',
  usage: '.ttt @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'ttt'
    )

    if (result.error) {
      return m.reply(result.error)
    }

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'ttt',
      players: [p1, p2],
      turn: p1,
      board: Array(9).fill(' '),
      symbols: {
        [p1]: 'X',
        [p2]: 'O'
      }
    })

    await m.reply({
      text:
        `🎮 *TIC TAC TOE*\n\n` +
        `❌ ${nameOf(p1)}\n` +
        `⭕ ${nameOf(p2)}\n\n` +
        `${renderTTT(Array(9).fill(' '))}\n` +
        `\n🎯 ${nameOf(p1)} goes first.\n` +
        `Reply with a number from 1-9.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 2. ROCK PAPER SCISSORS
 * ---------------------------------------------------------------- */

const rpsGame = {
  name: 'rps',
  alias: ['rockpaperscissors'],
  category: 'GAME',
  desc: 'Two-player Rock Paper Scissors',
  usage: '.rps @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'rps'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'rps',
      players: [p1, p2],
      moves: {}
    })

    await m.reply({
      text:
        `🥊 *ROCK PAPER SCISSORS*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Each player privately chooses:\n` +
        `🪨 rock\n` +
        `📄 paper\n` +
        `✂️ scissors\n\n` +
        `Reply with your choice.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 3. DICE BATTLE
 * ---------------------------------------------------------------- */

const diceGame = {
  name: 'dicebattle',
  alias: ['dice'],
  category: 'GAME',
  desc: 'Two players battle with dice',
  usage: '.dicebattle @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'dicebattle'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const a = rand(1, 6)
    const b = rand(1, 6)

    let text =
      `🎲 *DICE BATTLE*\n\n` +
      `${nameOf(p1)} → 🎲 ${a}\n` +
      `${nameOf(p2)} → 🎲 ${b}\n\n`

    if (a === b) {
      text += '🤝 *DRAW!*'
    } else {
      const winner = a > b ? p1 : p2

      await reward(winner, 500)

      text +=
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 Prize: ${CURRENCY} 500`
    }

    await m.reply({
      text,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 4. NUMBER GUESS BATTLE
 * ---------------------------------------------------------------- */

const numberBattle = {
  name: 'guessbattle',
  alias: ['numberbattle'],
  category: 'GAME',
  desc: 'Guess a hidden number against another player',
  usage: '.guessbattle @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'guessbattle'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const target = rand(1, 50)

    setGame(m.chat, {
      type: 'guessbattle',
      players: [p1, p2],
      target,
      guesses: {}
    })

    await m.reply({
      text:
        `🔢 *NUMBER GUESS BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `I'm thinking of a number from *1-50*.\n` +
        `Both players get one guess.\n\n` +
        `Reply with your number.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 5. QUICK MATH
 * ---------------------------------------------------------------- */

const quickMath = {
  name: 'quickmath',
  category: 'GAME',
  desc: 'Fast math duel',
  usage: '.quickmath @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'quickmath'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const a = rand(5, 30)
    const b = rand(2, 20)

    const operators = ['+', '-', '*']
    const op = randomChoice(operators)

    let answer

    if (op === '+') answer = a + b
    if (op === '-') answer = a - b
    if (op === '*') answer = a * b

    setGame(m.chat, {
      type: 'quickmath',
      players: [p1, p2],
      answer
    })

    await m.reply({
      text:
        `⚡ *QUICK MATH*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Solve this:\n\n` +
        `🧮 *${a} ${op} ${b} = ?*\n\n` +
        `First correct answer wins!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 6. FASTEST FINGER
 * ---------------------------------------------------------------- */

const fastestFinger = {
  name: 'fastfinger',
  alias: ['fastestfinger'],
  category: 'GAME',
  desc: 'First player to type the target wins',
  usage: '.fastfinger @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'fastfinger'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const target = randomChoice([
      'AYLEE',
      'VENOM',
      'WINNER',
      'FUOYE',
      'WHATSAPP',
      'CHAMPION'
    ])

    setGame(m.chat, {
      type: 'fastfinger',
      players: [p1, p2],
      target
    })

    await m.reply({
      text:
        `⚡ *FASTEST FINGER*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Wait for it...\n\n` +
        `🎯 Type: *${target}*\n\n` +
        `GO!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 7. WORD SCRAMBLE
 * ---------------------------------------------------------------- */

const wordScramble = {
  name: 'wordscramble',
  alias: ['wcg', 'scramble'],
  category: 'GAME',
  desc: 'Two players unscramble a word',
  usage: '.wordscramble @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'wordscramble'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const word = pick(WORDS)

    setGame(m.chat, {
      type: 'wordscramble',
      players: [p1, p2],
      word
    })

    await m.reply({
      text:
        `🔤 *WORD SCRAMBLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Unscramble:\n\n` +
        `🔥 *${scrambleWord(word).toUpperCase()}*\n\n` +
        `First correct answer wins ${CURRENCY} 500.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 8. HANGMAN
 * ---------------------------------------------------------------- */

const hangman = {
  name: 'hangman',
  category: 'GAME',
  desc: 'Two-player Hangman',
  usage: '.hangman @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'hangman'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players
    const word = pick(WORDS)

    setGame(m.chat, {
      type: 'hangman',
      players: [p1, p2],
      word,
      guessed: new Set(),
      wrong: 0
    })

    await m.reply({
      text:
        `💀 *HANGMAN*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `${HANGMAN_STAGES[0]}\n\n` +
        `${word
          .split('')
          .map(() => '_')
          .join(' ')}\n\n` +
        `Guess one letter at a time.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 9. TRIVIA BATTLE
 * ---------------------------------------------------------------- */

const trivia = {
  name: 'triviabattle',
  alias: ['quizbattle'],
  category: 'GAME',
  desc: 'Two-player trivia battle',
  usage: '.triviabattle @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'triviabattle'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const q = randomChoice(QUESTIONS)

    setGame(m.chat, {
      type: 'trivia',
      players: [p1, p2],
      answer: clean(q.a)
    })

    await m.reply({
      text:
        `🧠 *TRIVIA BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `❓ ${q.q}\n\n` +
        q.options
          .map(
            (x, i) =>
              `${String.fromCharCode(65 + i)}. ${x}`
          )
          .join('\n') +
        `\n\nFirst correct answer wins!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 10. EMOJI GUESS
 * ---------------------------------------------------------------- */

const emojiGuess = {
  name: 'emojiguess',
  category: 'GAME',
  desc: 'Guess what the emojis represent',
  usage: '.emojiguess @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'emojiguess'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players
    const item = randomChoice(EMOJI_QUESTIONS)

    setGame(m.chat, {
      type: 'emojiguess',
      players: [p1, p2],
      answer: clean(item.answer)
    })

    await m.reply({
      text:
        `😂 *EMOJI GUESS*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `What does this mean?\n\n` +
        `👉 ${item.emoji}\n\n` +
        `First correct answer wins!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 11. COIN FLIP BATTLE
 * ---------------------------------------------------------------- */

const coinFlip = {
  name: 'coinbattle',
  alias: ['coinflip'],
  category: 'GAME',
  desc: 'Choose heads or tails',
  usage: '.coinbattle @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'coinbattle'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'coinbattle',
      players: [p1, p2],
      moves: {}
    })

    await m.reply({
      text:
        `🪙 *COIN FLIP BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `${nameOf(p1)} and ${nameOf(p2)}, choose:\n\n` +
        `HEADS or TAILS`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 12. HIGHER OR LOWER
 * ---------------------------------------------------------------- */

const higherLower = {
  name: 'higherlower',
  category: 'GAME',
  desc: 'Guess whether the next number is higher or lower',
  usage: '.higherlower @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'higherlower'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const current = rand(1, 100)

    setGame(m.chat, {
      type: 'higherlower',
      players: [p1, p2],
      current,
      moves: {}
    })

    await m.reply({
      text:
        `📈 *HIGHER OR LOWER*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Current number: *${current}*\n\n` +
        `Each player chooses:\n` +
        `⬆️ HIGHER\n` +
        `⬇️ LOWER`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 13. TARGET NUMBER
 * ---------------------------------------------------------------- */

const targetNumber = {
  name: 'target',
  alias: ['targetnumber'],
  category: 'GAME',
  desc: 'Get closest to the target',
  usage: '.target @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'target'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const target = rand(1, 100)

    setGame(m.chat, {
      type: 'target',
      players: [p1, p2],
      target,
      guesses: {}
    })

    await m.reply({
      text:
        `🎯 *TARGET NUMBER*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Target: *${target}*\n\n` +
        `Both players choose a number from 1-100.\n` +
        `Closest wins!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 14. ODD OR EVEN
 * ---------------------------------------------------------------- */

const oddEven = {
  name: 'oddeven',
  category: 'GAME',
  desc: 'Guess odd or even',
  usage: '.oddeven @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'oddeven'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'oddeven',
      players: [p1, p2],
      moves: {}
    })

    await m.reply({
      text:
        `🔢 *ODD OR EVEN*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Choose *odd* or *even*.\n\n` +
        `The bot will generate a number!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 15. LUCKY NUMBER
 * ---------------------------------------------------------------- */

const luckyNumber = {
  name: 'luckynumber',
  category: 'GAME',
  desc: 'Pick a lucky number',
  usage: '.luckynumber @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'luckynumber'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'luckynumber',
      players: [p1, p2],
      guesses: {}
    })

    await m.reply({
      text:
        `🍀 *LUCKY NUMBER*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Pick a number from *1-10*.\n\n` +
        `One number is secretly lucky.\n` +
        `Choose wisely!`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 16. RACE
 * ---------------------------------------------------------------- */

const raceGame = {
  name: 'race',
  category: 'GAME',
  desc: 'Two players race to the finish',
  usage: '.race @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'race'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'race',
      players: [p1, p2],
      progress: {
        [p1]: 0,
        [p2]: 0
      }
    })

    await m.reply({
      text:
        `🏁 *RACE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Each reply with *go* moves your racer forward.\n` +
        `First to 5 wins!\n\n` +
        `🏎️ ${nameOf(p1)}: 0/5\n` +
        `🏎️ ${nameOf(p2)}: 0/5`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 17. SLAP BATTLE
 * ---------------------------------------------------------------- */

const slapBattle = {
  name: 'slapbattle',
  category: 'GAME',
  desc: 'Two-player slap battle',
  usage: '.slapbattle @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'slapbattle'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'slapbattle',
      players: [p1, p2],
      hp: {
        [p1]: 100,
        [p2]: 100
      },
      turn: p1
    })

    await m.reply({
      text:
        `👋 *SLAP BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `❤️ ${nameOf(p1)}: 100\n` +
        `❤️ ${nameOf(p2)}: 100\n\n` +
        `${nameOf(p1)} goes first.\n` +
        `Reply *slap* to attack.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 18. SWORD BATTLE
 * ---------------------------------------------------------------- */

const swordBattle = {
  name: 'swordbattle',
  category: 'GAME',
  desc: 'Two-player sword battle',
  usage: '.swordbattle @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'swordbattle'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'swordbattle',
      players: [p1, p2],
      hp: {
        [p1]: 100,
        [p2]: 100
      },
      turn: p1
    })

    await m.reply({
      text:
        `⚔️ *SWORD BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `❤️ ${nameOf(p1)}: 100\n` +
        `❤️ ${nameOf(p2)}: 100\n\n` +
        `Commands during battle:\n` +
        `⚔️ attack\n` +
        `🛡️ defend\n\n` +
        `${nameOf(p1)} starts.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 19. BOMB DEFUSE
 * ---------------------------------------------------------------- */

const bombGame = {
  name: 'bomb',
  alias: ['bombdefuse'],
  category: 'GAME',
  desc: 'Choose a wire to defuse the bomb',
  usage: '.bomb @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'bomb'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'bomb',
      players: [p1, p2],
      moves: {}
    })

    await m.reply({
      text:
        `💣 *BOMB DEFUSE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Choose a wire:\n\n` +
        `🔴 red\n` +
        `🔵 blue\n` +
        `🟢 green\n` +
        `🟡 yellow\n\n` +
        `One wire is dangerous...`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 20. MEMORY GAME
 * ---------------------------------------------------------------- */

const memoryGame = {
  name: 'memory',
  category: 'GAME',
  desc: 'Remember the number sequence',
  usage: '.memory @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'memory'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const sequence = Array.from(
      { length: 5 },
      () => rand(0, 9)
    ).join('')

    setGame(m.chat, {
      type: 'memory',
      players: [p1, p2],
      sequence,
      answered: {}
    })

    await m.reply({
      text:
        `🧠 *MEMORY CHALLENGE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `MEMORIZE THIS:\n\n` +
        `🔢 *${sequence}*\n\n` +
        `You have 5 seconds...`,
      mentions: [p1, p2]
    })

    setTimeout(() => {
      const g = games.get(m.chat)

      if (
        !g ||
        g.type !== 'memory' ||
        g.sequence !== sequence
      ) {
        return
      }

      m.send(
        `🧠 Sequence hidden!\n\n` +
        `Both players: type the number you remember.`
      ).catch(() => {})
    }, 5000)
  }
}

/* ----------------------------------------------------------------
 * 21. BLACKJACK DUEL
 * ---------------------------------------------------------------- */

const blackjack = {
  name: 'blackjack',
  category: 'GAME',
  desc: 'Two-player blackjack',
  usage: '.blackjack @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'blackjack'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const deck = makeDeck()

    const hands = {
      [p1]: [deck.pop(), deck.pop()],
      [p2]: [deck.pop(), deck.pop()]
    }

    setGame(m.chat, {
      type: 'blackjack',
      players: [p1, p2],
      deck,
      hands,
      stood: {}
    })

    await m.reply({
      text:
        `🃏 *BLACKJACK DUEL*\n\n` +
        `${nameOf(p1)}: ${handValue(hands[p1])}\n` +
        `${hands[p1]
          .map((c) => `${c.value}${c.suit}`)
          .join(' ')}\n\n` +
        `${nameOf(p2)}: ${handValue(hands[p2])}\n` +
        `${hands[p2]
          .map((c) => `${c.value}${c.suit}`)
          .join(' ')}\n\n` +
        `Reply *hit* for another card or *stand*.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 22. WAR CARD BATTLE
 * ---------------------------------------------------------------- */

const war = {
  name: 'war',
  alias: ['cardwar'],
  category: 'GAME',
  desc: 'Card War',
  usage: '.war @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'war'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const deck = makeDeck()

    const value = (card) =>
      VALUES.indexOf(card.value)

    const a = deck.pop()
    const b = deck.pop()

    let text =
      `🃏 *CARD WAR*\n\n` +
      `${nameOf(p1)} → ${a.value}${a.suit}\n` +
      `${nameOf(p2)} → ${b.value}${b.suit}\n\n`

    if (value(a) === value(b)) {
      text += '🤝 DRAW!'
    } else {
      const winner = value(a) > value(b) ? p1 : p2

      await reward(winner, 600)

      text +=
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 600`
    }

    await m.reply({
      text,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 23. REACTION BATTLE
 * ---------------------------------------------------------------- */

const reaction = {
  name: 'reaction',
  alias: ['reactionbattle'],
  category: 'GAME',
  desc: 'First player to react with the target word wins',
  usage: '.reaction @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'reaction'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const target = randomChoice([
      'GO',
      'NOW',
      'RUN',
      'WIN',
      'FIRE'
    ])

    setGame(m.chat, {
      type: 'reaction',
      players: [p1, p2],
      target
    })

    await m.reply({
      text:
        `⚡ *REACTION BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Wait...\n\n` +
        `🚦 *${target}*`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 24. FOOTBALL PENALTY
 * ---------------------------------------------------------------- */

const penalty = {
  name: 'penalty',
  alias: ['penaltybattle'],
  category: 'GAME',
  desc: 'Football penalty shootout',
  usage: '.penalty @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'penalty'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'penalty',
      players: [p1, p2],
      moves: {}
    })

    await m.reply({
      text:
        `⚽ *PENALTY SHOOTOUT*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Choose where to shoot:\n` +
        `⬅️ left\n` +
        `⬆️ center\n` +
        `➡️ right\n\n` +
        `Both players take one shot.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 25. BASKETBALL
 * ---------------------------------------------------------------- */

const basketball = {
  name: 'basketball',
  alias: ['hoops'],
  category: 'GAME',
  desc: 'Basketball shooting battle',
  usage: '.basketball @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'basketball'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'basketball',
      players: [p1, p2],
      scores: {}
    })

    await m.reply({
      text:
        `🏀 *BASKETBALL BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Reply *shoot* 3 times.\n` +
        `Each successful shot gives 1 point.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 26. FIGHTER BATTLE
 * ---------------------------------------------------------------- */

const fighter = {
  name: 'fight',
  alias: ['fighter'],
  category: 'GAME',
  desc: 'Choose attacks in a battle',
  usage: '.fight @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'fight'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'fight',
      players: [p1, p2],
      hp: {
        [p1]: 100,
        [p2]: 100
      },
      turn: p1
    })

    await m.reply({
      text:
        `🥊 *FIGHTER BATTLE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `❤️ ${nameOf(p1)}: 100\n` +
        `❤️ ${nameOf(p2)}: 100\n\n` +
        `Moves:\n` +
        `👊 punch\n` +
        `🦵 kick\n` +
        `🛡️ defend\n\n` +
        `${nameOf(p1)} starts.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 27. SLOT DUEL
 * ---------------------------------------------------------------- */

const slot = {
  name: 'slotduel',
  alias: ['slots'],
  category: 'GAME',
  desc: 'Two-player slot battle',
  usage: '.slotduel @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'slotduel'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    const symbols = ['🍒', '🍋', '🍇', '⭐', '💎', '7️⃣']

    const spin = () =>
      [
        randomChoice(symbols),
        randomChoice(symbols),
        randomChoice(symbols)
      ]

    const a = spin()
    const b = spin()

    const score = (x) => {
      if (
        x[0] === x[1] &&
        x[1] === x[2]
      ) {
        return x[0] === '7️⃣'
          ? 100
          : 50
      }

      if (
        x[0] === x[1] ||
        x[1] === x[2] ||
        x[0] === x[2]
      ) {
        return 20
      }

      return 0
    }

    const sa = score(a)
    const sb = score(b)

    let text =
      `🎰 *SLOT DUEL*\n\n` +
      `${nameOf(p1)}\n${a.join(' | ')} → ${sa} pts\n\n` +
      `${nameOf(p2)}\n${b.join(' | ')} → ${sb} pts\n\n`

    if (sa === sb) {
      text += '🤝 DRAW!'
    } else {
      const winner = sa > sb ? p1 : p2

      await reward(winner, 500)

      text +=
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 500`
    }

    await m.reply({
      text,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 28. MIND READER
 * ---------------------------------------------------------------- */

const mindReader = {
  name: 'mindreader',
  alias: ['mind'],
  category: 'GAME',
  desc: 'Try to choose the same number',
  usage: '.mindreader @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'mindreader'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'mindreader',
      players: [p1, p2],
      moves: {}
    })

    await m.reply({
      text:
        `🧠 *MIND READER*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Both players secretly choose a number from 1-5.\n\n` +
        `Reply with your number.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 29. SURVIVAL
 * ---------------------------------------------------------------- */

const survival = {
  name: 'survival',
  category: 'GAME',
  desc: 'Survive random challenges',
  usage: '.survival @user1 @user2',
  group: true,

  async run({ m }) {
    const result = await startDuel(
      m,
      'survival'
    )

    if (result.error) return m.reply(result.error)

    const [p1, p2] = result.players

    setGame(m.chat, {
      type: 'survival',
      players: [p1, p2],
      round: 1,
      alive: {
        [p1]: true,
        [p2]: true
      }
    })

    await m.reply({
      text:
        `☠️ *SURVIVAL CHALLENGE*\n\n` +
        `${nameOf(p1)} 🆚 ${nameOf(p2)}\n\n` +
        `Round 1:\n` +
        `Choose:\n\n` +
        `🏃 run\n` +
        `🛡️ hide\n` +
        `⚔️ fight\n\n` +
        `Choose wisely.`,
      mentions: [p1, p2]
    })
  }
}

/* ----------------------------------------------------------------
 * 30. MAFIA
 * ---------------------------------------------------------------- */

const mafia = {
  name: 'mafia',
  category: 'GAME',
  desc: 'Start a Mafia game for selected players',
  usage: '.mafia @user1 @user2 @user3 @user4',
  group: true,

  async run({ m }) {
    if (games.has(m.chat)) {
      return m.reply(
        '🎮 A game is already running.\n\nUse *.endgame* first.'
      )
    }

    const players = [
      ...(m.mentions || [])
    ]

    if (players.length < 4) {
      return m.reply(
        `🕵️ *MAFIA*\n\n` +
        `Tag at least 4 players.\n\n` +
        `Example:\n` +
        `*.mafia @user1 @user2 @user3 @user4*`
      )
    }

    const unique = [
      ...new Set(players)
    ]

    const roles = [
      'mafia',
      'doctor',
      'detective',
      ...Array(
        Math.max(0, unique.length - 3)
      ).fill('citizen')
    ]

    const shuffledRoles =
      shuffle(roles)

    const roleMap = {}

    unique.forEach((jid, i) => {
      roleMap[jid] = shuffledRoles[i]
    })

    setGame(m.chat, {
      type: 'mafia',
      players: unique,
      roles: roleMap,
      alive: Object.fromEntries(
        unique.map((x) => [x, true])
      ),
      phase: 'night'
    })

    /*
     * We intentionally don't reveal roles in the group.
     * The bot sends each player their private role.
     */

    for (const jid of unique) {
      const role = roleMap[jid]

      await m.send({
        text:
          `🕵️ *MAFIA ROLE*\n\n` +
          `Your role is: *${role.toUpperCase()}*\n\n` +
          (
            role === 'mafia'
              ? 'You are Mafia. Eliminate the citizens.'
              : role === 'doctor'
                ? 'You are the Doctor. Protect someone.'
                : role === 'detective'
                  ? 'You are the Detective. Find the Mafia.'
                  : 'You are a Citizen. Find the Mafia.'
          ),
        mentions: [jid]
      }).catch(() => {})
    }

    await m.reply({
      text:
        `🕵️ *MAFIA STARTED!*\n\n` +
        `Players: ${unique.length}\n\n` +
        `🌙 Night phase has started.\n\n` +
        `The bot will privately give everyone their role.\n\n` +
        `You do NOT need the "." prefix to play.`,
      mentions: unique
    })
  }
}

/* ----------------------------------------------------------------
 * PLUGIN
 * ---------------------------------------------------------------- */

export default [
  tttGame,
  rpsGame,
  diceGame,
  numberBattle,
  quickMath,
  fastestFinger,
  wordScramble,
  hangman,
  trivia,
  emojiGuess,
  coinFlip,
  higherLower,
  targetNumber,
  oddEven,
  luckyNumber,
  raceGame,
  slapBattle,
  swordBattle,
  bombGame,
  memoryGame,
  blackjack,
  war,
  reaction,
  penalty,
  basketball,
  fighter,
  slot,
  mindReader,
  survival,
  mafia,

  /* --------------------------------------------------------------
   * UNIVERSAL GAME ENDER
   * -------------------------------------------------------------- */

  {
    name: 'endgame',
    alias: [
      'stopgame',
      'cancelgame',
      'delgame'
    ],
    category: 'GAME',
    desc: 'End the current group game',
    usage: '.endgame',
    group: true,

    async run({ m }) {
      if (!games.has(m.chat)) {
        return m.reply(
          '❌ There is no active game in this group.'
        )
      }

      const g = games.get(m.chat)

      games.delete(m.chat)

      await m.reply(
        `🛑 *GAME ENDED*\n\n` +
        `The ${g.type} game has been cancelled.`
      )
    }
  },

  /* --------------------------------------------------------------
   * GAME LIST
   * -------------------------------------------------------------- */

  {
    name: 'games',
    alias: ['gamelist'],
    category: 'GAME',
    desc: 'Show available games',
    usage: '.games',
    group: true,

    async run({ m }) {
      await m.reply(
        `🎮 *AY-LEE BOT GAMES*\n\n` +

        `⚔️ *BATTLE*\n` +
        `• .ttt\n` +
        `• .rps\n` +
        `• .dicebattle\n` +
        `• .guessbattle\n` +
        `• .slapbattle\n` +
        `• .swordbattle\n` +
        `• .fight\n` +
        `• .war\n` +
        `• .slotduel\n\n` +

        `🧠 *BRAIN*\n` +
        `• .quickmath\n` +
        `• .fastfinger\n` +
        `• .wordscramble\n` +
        `• .hangman\n` +
        `• .triviabattle\n` +
        `• .emojiguess\n` +
        `• .memory\n` +
        `• .mindreader\n` +
        `• .target\n` +
        `• .higherlower\n\n` +

        `🎯 *CHALLENGE*\n` +
        `• .coinbattle\n` +
        `• .oddeven\n` +
        `• .luckynumber\n` +
        `• .race\n` +
        `• .bomb\n` +
        `• .reaction\n` +
        `• .penalty\n` +
        `• .basketball\n` +
        `• .survival\n\n` +

        `🕵️ *SOCIAL*\n` +
        `• .mafia\n\n` +

        `🛑 *CONTROL*\n` +
        `• .endgame\n\n` +

        `📌 *HOW TO PLAY*\n\n` +
        `Only the game starter needs the "." prefix.\n\n` +
        `Example:\n` +
        `*.dicebattle @user1 @user2*\n\n` +
        `The selected players then play normally.\n` +
        `The person who starts the game does NOT have to participate.`
      )
    }
  }
]

/* ================================================================
 * GLOBAL BEFORE HANDLER
 * ================================================================
 *
 * Players interact with an active game by simply sending messages.
 * They do NOT need the "." prefix.
 * ================================================================ */

export async function before({ m }) {
  const g = getGame(m.chat)

  if (!g) return false

  /*
   * Never allow random people to control the game.
   */
  if (!playerInGame(g, m.sender)) {
    return false
  }

  const text = clean(m.body)

  /* --------------------------------------------------------------
   * TIC TAC TOE
   * -------------------------------------------------------------- */

  if (g.type === 'ttt') {
    if (m.sender !== g.turn) {
      await m.reply(
        `⏳ ${nameOf(g.turn)}'s turn.`
      )

      return true
    }

    if (!/^[1-9]$/.test(text)) {
      return true
    }

    const pos = Number(text) - 1

    if (g.board[pos] !== ' ') {
      await m.reply(
        '❌ That square is already taken.'
      )

      return true
    }

    g.board[pos] =
      g.symbols[m.sender]

    const result =
      tttWinner(g.board)

    if (result === 'draw') {
      deleteGame(m.chat)

      await m.reply(
        `🤝 *DRAW!*\n\n${renderTTT(g.board)}`
      )

      return true
    }

    if (result) {
      const winner =
        g.players.find(
          (p) =>
            g.symbols[p] === result
        )

      deleteGame(m.chat)

      await reward(winner, 500)

      await m.reply({
        text:
          `🏆 *TIC TAC TOE WINNER!*\n\n` +
          `${renderTTT(g.board)}\n` +
          `${nameOf(winner)} wins!\n\n` +
          `💰 +${CURRENCY} 500`,
        mentions: g.players
      })

      return true
    }

    g.turn =
      g.players.find(
        (p) => p !== m.sender
      )

    await m.reply({
      text:
        `${renderTTT(g.board)}\n\n` +
        `👉 ${nameOf(g.turn)}'s turn.`,
      mentions: [g.turn]
    })

    return true
  }

  /* --------------------------------------------------------------
   * RPS
   * -------------------------------------------------------------- */

  if (g.type === 'rps') {
    if (!RPS.includes(text)) {
      return true
    }

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      await m.reply(
        '✅ Choice locked. Waiting for the other player...'
      )

      return true
    }

    const [p1, p2] =
      g.players

    const a = g.moves[p1]
    const b = g.moves[p2]

    const result =
      rpsWinner(a, b)

    deleteGame(m.chat)

    if (result === 'draw') {
      return m.reply(
        `🤝 *DRAW!*\n\n` +
        `${nameOf(p1)}: ${a}\n` +
        `${nameOf(p2)}: ${b}`
      )
    }

    const winner =
      result === 'a'
        ? p1
        : p2

    await reward(winner, 500)

    await m.reply({
      text:
        `🥊 *RPS RESULT*\n\n` +
        `${nameOf(p1)}: ${a}\n` +
        `${nameOf(p2)}: ${b}\n\n` +
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 500`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * NUMBER GUESS BATTLE
   * -------------------------------------------------------------- */

  if (g.type === 'guessbattle') {
    const guess = Number(text)

    if (
      !Number.isInteger(guess) ||
      guess < 1 ||
      guess > 50
    ) {
      return true
    }

    g.guesses[m.sender] = guess

    if (
      Object.keys(g.guesses).length < 2
    ) {
      await m.reply(
        '🔢 Guess recorded. Waiting for the other player...'
      )

      return true
    }

    const [p1, p2] = g.players

    const d1 =
      Math.abs(g.target - g.guesses[p1])

    const d2 =
      Math.abs(g.target - g.guesses[p2])

    deleteGame(m.chat)

    if (d1 === d2) {
      return m.reply(
        `🤝 *DRAW!*\n\n` +
        `Hidden number: *${g.target}*\n\n` +
        `${nameOf(p1)} guessed ${g.guesses[p1]}\n` +
        `${nameOf(p2)} guessed ${g.guesses[p2]}`
      )
    }

    const winner =
      d1 < d2 ? p1 : p2

    await reward(winner, 700)

    await m.reply({
      text:
        `🔢 *RESULT*\n\n` +
        `Number: *${g.target}*\n\n` +
        `${nameOf(p1)} → ${g.guesses[p1]}\n` +
        `${nameOf(p2)} → ${g.guesses[p2]}\n\n` +
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 700`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * QUICK MATH
   * -------------------------------------------------------------- */

  if (g.type === 'quickmath') {
    if (text !== String(g.answer)) {
      return true
    }

    deleteGame(m.chat)

    await reward(m.sender, 700)

    await m.reply({
      text:
        `⚡ *CORRECT!*\n\n` +
        `🏆 ${nameOf(m.sender)} was fastest!\n` +
        `💰 +${CURRENCY} 700`,
      mentions: [m.sender]
    })

    return true
  }

  /* --------------------------------------------------------------
   * FAST FINGER
   * -------------------------------------------------------------- */

  if (g.type === 'fastfinger') {
    if (
      text !== clean(g.target)
    ) {
      return true
    }

    deleteGame(m.chat)

    await reward(m.sender, 500)

    await m.reply({
      text:
        `⚡ *FASTEST!*\n\n` +
        `${nameOf(m.sender)} wins!\n` +
        `💰 +${CURRENCY} 500`,
      mentions: [m.sender]
    })

    return true
  }

  /* --------------------------------------------------------------
   * WORD SCRAMBLE
   * -------------------------------------------------------------- */

  if (g.type === 'wordscramble') {
    if (text !== g.word) {
      return true
    }

    deleteGame(m.chat)

    await reward(m.sender, 500)

    await m.reply({
      text:
        `🎉 *CORRECT!*\n\n` +
        `The word was *${g.word}*.\n\n` +
        `🏆 ${nameOf(m.sender)} wins!\n` +
        `💰 +${CURRENCY} 500`,
      mentions: [m.sender]
    })

    return true
  }

  /* --------------------------------------------------------------
   * HANGMAN
   * -------------------------------------------------------------- */

  if (g.type === 'hangman') {
    if (
      !/^[a-z]$/.test(text)
    ) {
      return true
    }

    if (g.guessed.has(text)) {
      return true
    }

    g.guessed.add(text)

    if (!g.word.includes(text)) {
      g.wrong++
    }

    const display =
      g.word
        .split('')
        .map((c) =>
          g.guessed.has(c)
            ? c
            : '_'
        )
        .join(' ')

    if (!display.includes('_')) {
      deleteGame(m.chat)

      await reward(m.sender, 600)

      await m.reply({
        text:
          `🎉 *HANGMAN WON!*\n\n` +
          `Word: *${g.word}*\n\n` +
          `🏆 ${nameOf(m.sender)} wins!\n` +
          `💰 +${CURRENCY} 600`,
        mentions: [m.sender]
      })

      return true
    }

    if (g.wrong >= 6) {
      deleteGame(m.chat)

      await m.reply(
        `💀 *GAME OVER!*\n\n` +
        `${HANGMAN_STAGES[6]}\n\n` +
        `The word was *${g.word}*.`
      )

      return true
    }

    await m.reply(
      `${HANGMAN_STAGES[g.wrong]}\n\n` +
      `${display}\n\n` +
      `❤️ Lives: ${6 - g.wrong}/6`
    )

    return true
  }

  /* --------------------------------------------------------------
   * TRIVIA
   * -------------------------------------------------------------- */

  if (g.type === 'trivia') {
    if (
      clean(text) !==
      clean(g.answer)
    ) {
      return true
    }

    deleteGame(m.chat)

    await reward(m.sender, 600)

    await m.reply({
      text:
        `🧠 *CORRECT!*\n\n` +
        `🏆 ${nameOf(m.sender)} wins the trivia!\n` +
        `💰 +${CURRENCY} 600`,
      mentions: [m.sender]
    })

    return true
  }

  /* --------------------------------------------------------------
   * EMOJI GUESS
   * -------------------------------------------------------------- */

  if (g.type === 'emojiguess') {
    if (
      clean(text) !==
      clean(g.answer)
    ) {
      return true
    }

    deleteGame(m.chat)

    await reward(m.sender, 500)

    await m.reply({
      text:
        `😂 *CORRECT!*\n\n` +
        `🏆 ${nameOf(m.sender)} wins!\n` +
        `💰 +${CURRENCY} 500`,
      mentions: [m.sender]
    })

    return true
  }

  /* --------------------------------------------------------------
   * COIN BATTLE
   * -------------------------------------------------------------- */

  if (g.type === 'coinbattle') {
    if (
      !['heads', 'tails'].includes(text)
    ) {
      return true
    }

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const [p1, p2] = g.players

    const coin =
      randomChoice([
        'heads',
        'tails'
      ])

    const correct =
      g.players.filter(
        (p) =>
          g.moves[p] === coin
      )

    deleteGame(m.chat)

    if (correct.length === 0) {
      return m.reply(
        `🪙 Coin: *${coin.toUpperCase()}*\n\n` +
        `❌ Nobody guessed correctly.`
      )
    }

    if (correct.length === 2) {
      return m.reply(
        `🪙 Coin: *${coin.toUpperCase()}*\n\n` +
        `🤝 Both guessed correctly!`
      )
    }

    const winner = correct[0]

    await reward(winner, 500)

    await m.reply({
      text:
        `🪙 *COIN RESULT*\n\n` +
        `Coin: *${coin.toUpperCase()}*\n\n` +
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 500`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * HIGHER LOWER
   * -------------------------------------------------------------- */

  if (g.type === 'higherlower') {
    if (
      !['higher', 'lower'].includes(text)
    ) {
      return true
    }

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const next = rand(1, 100)

    const [p1, p2] = g.players

    const correct = (choice) => {
      if (
        next === g.current
      ) {
        return true
      }

      return choice === 'higher'
        ? next > g.current
        : next < g.current
    }

    const winners =
      g.players.filter(
        (p) =>
          correct(g.moves[p])
      )

    deleteGame(m.chat)

    if (winners.length === 1) {
      await reward(winners[0], 500)
    }

    await m.reply({
      text:
        `📈 *HIGHER OR LOWER*\n\n` +
        `Old: *${g.current}*\n` +
        `New: *${next}*\n\n` +
        (
          winners.length
            ? `🏆 ${nameOf(winners[0])} wins!\n💰 +${CURRENCY} 500`
            : '❌ Nobody guessed correctly.'
        ),
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * TARGET NUMBER
   * -------------------------------------------------------------- */

  if (g.type === 'target') {
    const guess = Number(text)

    if (
      !Number.isInteger(guess) ||
      guess < 1 ||
      guess > 100
    ) {
      return true
    }

    g.guesses[m.sender] = guess

    if (
      Object.keys(g.guesses).length < 2
    ) {
      return true
    }

    const [p1, p2] = g.players

    const d1 =
      Math.abs(
        g.target - g.guesses[p1]
      )

    const d2 =
      Math.abs(
        g.target - g.guesses[p2]
      )

    deleteGame(m.chat)

    if (d1 === d2) {
      return m.reply(
        `🎯 *DRAW!*\n\n` +
        `Target: ${g.target}\n` +
        `${nameOf(p1)}: ${g.guesses[p1]}\n` +
        `${nameOf(p2)}: ${g.guesses[p2]}`
      )
    }

    const winner =
      d1 < d2 ? p1 : p2

    await reward(winner, 700)

    await m.reply({
      text:
        `🎯 *TARGET RESULT*\n\n` +
        `Target: *${g.target}*\n\n` +
        `${nameOf(p1)} → ${g.guesses[p1]}\n` +
        `${nameOf(p2)} → ${g.guesses[p2]}\n\n` +
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 700`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * ODD EVEN
   * -------------------------------------------------------------- */

  if (g.type === 'oddeven') {
    if (
      !['odd', 'even'].includes(text)
    ) {
      return true
    }

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const number = rand(1, 100)
    const answer =
      number % 2 === 0
        ? 'even'
        : 'odd'

    const winners =
      g.players.filter(
        (p) =>
          g.moves[p] === answer
      )

    deleteGame(m.chat)

    if (winners.length === 1) {
      await reward(winners[0], 500)
    }

    await m.reply({
      text:
        `🔢 Number: *${number}*\n` +
        `Result: *${answer.toUpperCase()}*\n\n` +
        (
          winners.length === 1
            ? `🏆 ${nameOf(winners[0])} wins!\n💰 +${CURRENCY} 500`
            : winners.length === 2
              ? '🤝 Both guessed correctly!'
              : '❌ Nobody guessed correctly.'
        ),
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * LUCKY NUMBER
   * -------------------------------------------------------------- */

  if (g.type === 'luckynumber') {
    const guess = Number(text)

    if (
      !Number.isInteger(guess) ||
      guess < 1 ||
      guess > 10
    ) {
      return true
    }

    g.guesses[m.sender] = guess

    if (
      Object.keys(g.guesses).length < 2
    ) {
      return true
    }

    const lucky = rand(1, 10)

    const winners =
      g.players.filter(
        (p) =>
          g.guesses[p] === lucky
      )

    deleteGame(m.chat)

    if (winners.length === 1) {
      await reward(winners[0], 1000)
    }

    await m.reply({
      text:
        `🍀 *LUCKY NUMBER*\n\n` +
        `Lucky number: *${lucky}*\n\n` +
        (
          winners.length
            ? `🏆 ${nameOf(winners[0])} hit the lucky number!\n💰 +${CURRENCY} 1,000`
            : '😔 Nobody got it.'
        ),
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * RACE
   * -------------------------------------------------------------- */

  if (g.type === 'race') {
    if (text !== 'go') {
      return true
    }

    g.progress[m.sender]++

    if (g.progress[m.sender] >= 5) {
      deleteGame(m.chat)

      await reward(m.sender, 600)

      await m.reply({
        text:
          `🏁 *FINISH!*\n\n` +
          `🏆 ${nameOf(m.sender)} wins the race!\n` +
          `💰 +${CURRENCY} 600`,
        mentions: [m.sender]
      })

      return true
    }

    await m.reply(
      `🏎️ ${nameOf(m.sender)} → ${g.progress[m.sender]}/5`
    )

    return true
  }

  /* --------------------------------------------------------------
   * SLAP / SWORD / FIGHT
   * -------------------------------------------------------------- */

  if (
    ['slapbattle', 'swordbattle', 'fight'].includes(
      g.type
    )
  ) {
    if (m.sender !== g.turn) {
      return true
    }

    const moves =
      g.type === 'slapbattle'
        ? ['slap']
        : g.type === 'swordbattle'
          ? ['attack', 'defend']
          : ['punch', 'kick', 'defend']

    if (!moves.includes(text)) {
      return true
    }

    const opponent =
      g.players.find(
        (p) => p !== m.sender
      )

    if (
      text === 'defend'
    ) {
      g.turn = opponent

      await m.reply(
        `🛡️ ${nameOf(m.sender)} defended.\n\n` +
        `👉 ${nameOf(opponent)}'s turn.`
      )

      return true
    }

    let damage =
      g.type === 'slapbattle'
        ? rand(10, 25)
        : g.type === 'swordbattle'
          ? rand(15, 30)
          : text === 'kick'
            ? rand(15, 30)
            : rand(10, 25)

    g.hp[opponent] -= damage

    if (g.hp[opponent] <= 0) {
      g.hp[opponent] = 0

      deleteGame(m.chat)

      await reward(m.sender, 800)

      await m.reply({
        text:
          `💥 *KNOCKOUT!*\n\n` +
          `${nameOf(m.sender)} wins!\n\n` +
          `❤️ ${nameOf(m.sender)}: ${g.hp[m.sender]}\n` +
          `💀 ${nameOf(opponent)}: 0\n\n` +
          `💰 +${CURRENCY} 800`,
        mentions: g.players
      })

      return true
    }

    g.turn = opponent

    await m.reply({
      text:
        `💥 ${nameOf(m.sender)} dealt *${damage} damage*!\n\n` +
        `❤️ ${nameOf(m.sender)}: ${g.hp[m.sender]}\n` +
        `❤️ ${nameOf(opponent)}: ${g.hp[opponent]}\n\n` +
        `👉 ${nameOf(opponent)}'s turn.`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * BOMB
   * -------------------------------------------------------------- */

  if (g.type === 'bomb') {
    if (
      !['red', 'blue', 'green', 'yellow'].includes(
        text
      )
    ) {
      return true
    }

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const bomb =
      randomChoice([
        'red',
        'blue',
        'green',
        'yellow'
      ])

    const survivors =
      g.players.filter(
        (p) =>
          g.moves[p] !== bomb
      )

    deleteGame(m.chat)

    if (survivors.length === 1) {
      await reward(survivors[0], 700)
    }

    await m.reply({
      text:
        `💣 *BOMB RESULT*\n\n` +
        `💥 Dangerous wire: *${bomb}*\n\n` +
        (
          survivors.length === 1
            ? `🏆 ${nameOf(survivors[0])} survived!\n💰 +${CURRENCY} 700`
            : survivors.length === 2
              ? '🎉 Both survived!'
              : '💀 Both picked the bomb!'
        ),
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * MEMORY
   * -------------------------------------------------------------- */

  if (g.type === 'memory') {
    if (
      !/^\d+$/.test(text)
    ) {
      return true
    }

    g.answered[m.sender] = text

    if (
      Object.keys(g.answered).length < 2
    ) {
      return true
    }

    const [p1, p2] = g.players

    const a =
      g.answered[p1] === g.sequence

    const b =
      g.answered[p2] === g.sequence

    deleteGame(m.chat)

    if (a && !b) {
      await reward(p1, 700)

      return m.reply({
        text:
          `🧠 *MEMORY WINNER!*\n\n` +
          `${nameOf(p1)} remembered correctly!\n` +
          `💰 +${CURRENCY} 700`,
        mentions: [p1]
      })
    }

    if (b && !a) {
      await reward(p2, 700)

      return m.reply({
        text:
          `🧠 *MEMORY WINNER!*\n\n` +
          `${nameOf(p2)} remembered correctly!\n` +
          `💰 +${CURRENCY} 700`,
        mentions: [p2]
      })
    }

    return m.reply(
      `🧠 *MEMORY RESULT*\n\n` +
      `Correct sequence: *${g.sequence}*\n\n` +
      `🤝 Draw!`
    )
  }

  /* --------------------------------------------------------------
   * BLACKJACK
   * -------------------------------------------------------------- */

  if (g.type === 'blackjack') {
    if (
      !['hit', 'stand'].includes(text)
    ) {
      return true
    }

    const hand = g.hands[m.sender]

    if (text === 'hit') {
      hand.push(g.deck.pop())

      const value =
        handValue(hand)

      if (value > 21) {
        deleteGame(m.chat)

        return m.reply(
          `💥 ${nameOf(m.sender)} busted with *${value}*!\n\n` +
          `🏆 The other player wins!`
        )
      }
    }

    g.stood[m.sender] = true

    if (
      Object.keys(g.stood).length < 2
    ) {
      return m.reply(
        `🃏 ${nameOf(m.sender)}: ${handValue(hand)}`
      )
    }

    const [p1, p2] = g.players

    const a =
      handValue(g.hands[p1])

    const b =
      handValue(g.hands[p2])

    deleteGame(m.chat)

    if (a === b) {
      return m.reply(
        `🃏 *BLACKJACK DRAW!*\n\n` +
        `${nameOf(p1)}: ${a}\n` +
        `${nameOf(p2)}: ${b}`
      )
    }

    const winner =
      a > b ? p1 : p2

    await reward(winner, 800)

    await m.reply({
      text:
        `🃏 *BLACKJACK RESULT*\n\n` +
        `${nameOf(p1)}: ${a}\n` +
        `${nameOf(p2)}: ${b}\n\n` +
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 800`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * MIND READER
   * -------------------------------------------------------------- */

  if (g.type === 'mindreader') {
    const guess = Number(text)

    if (
      !Number.isInteger(guess) ||
      guess < 1 ||
      guess > 5
    ) {
      return true
    }

    g.moves[m.sender] = guess

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const [p1, p2] = g.players

    deleteGame(m.chat)

    if (
      g.moves[p1] ===
      g.moves[p2]
    ) {
      await reward(p1, 700)
      await reward(p2, 700)

      return m.reply({
        text:
          `🧠 *MIND READER!*\n\n` +
          `Both players chose *${g.moves[p1]}*!\n\n` +
          `🤝 Both win!\n` +
          `💰 +${CURRENCY} 700 each`,
        mentions: g.players
      })
    }

    return m.reply(
      `🧠 *MIND READER*\n\n` +
      `${nameOf(p1)} → ${g.moves[p1]}\n` +
      `${nameOf(p2)} → ${g.moves[p2]}\n\n` +
      `❌ Different choices!`
    )
  }

  /* --------------------------------------------------------------
   * REACTION
   * -------------------------------------------------------------- */

  if (g.type === 'reaction') {
    if (
      text !== clean(g.target)
    ) {
      return true
    }

    deleteGame(m.chat)

    await reward(m.sender, 500)

    await m.reply({
      text:
        `⚡ *REACTION WINNER!*\n\n` +
        `${nameOf(m.sender)} was fastest!\n` +
        `💰 +${CURRENCY} 500`,
      mentions: [m.sender]
    })

    return true
  }

  /* --------------------------------------------------------------
   * PENALTY
   * -------------------------------------------------------------- */

  if (g.type === 'penalty') {
    if (
      !['left', 'center', 'right'].includes(
        text
      )
    ) {
      return true
    }

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const [p1, p2] = g.players

    const keeper1 =
      randomChoice([
        'left',
        'center',
        'right'
      ])

    const keeper2 =
      randomChoice([
        'left',
        'center',
        'right'
      ])

    const score1 =
      g.moves[p1] !== keeper1

    const score2 =
      g.moves[p2] !== keeper2

    deleteGame(m.chat)

    if (score1 && !score2) {
      await reward(p1, 700)

      return m.reply({
        text:
          `⚽ *PENALTY RESULT*\n\n` +
          `🏆 ${nameOf(p1)} scores!\n` +
          `💰 +${CURRENCY} 700`,
        mentions: [p1]
      })
    }

    if (score2 && !score1) {
      await reward(p2, 700)

      return m.reply({
        text:
          `⚽ *PENALTY RESULT*\n\n` +
          `🏆 ${nameOf(p2)} scores!\n` +
          `💰 +${CURRENCY} 700`,
        mentions: [p2]
      })
    }

    return m.reply(
      score1 && score2
        ? '⚽ Both players scored! 🤝'
        : '🧤 Both penalties were saved!'
    )
  }

  /* --------------------------------------------------------------
   * BASKETBALL
   * -------------------------------------------------------------- */

  if (g.type === 'basketball') {
    if (text !== 'shoot') {
      return true
    }

    if (!g.scores[m.sender]) {
      g.scores[m.sender] = {
        shots: 0,
        score: 0
      }
    }

    const s =
      g.scores[m.sender]

    if (s.shots >= 3) {
      return true
    }

    s.shots++

    if (Math.random() < 0.65) {
      s.score++
    }

    await m.reply(
      `🏀 ${nameOf(m.sender)}\n` +
      `Shot ${s.shots}/3\n` +
      `Score: ${s.score}`
    )

    const finished =
      g.players.every(
        (p) =>
          g.scores[p]?.shots >= 3
      )

    if (!finished) {
      return true
    }

    const [p1, p2] = g.players

    deleteGame(m.chat)

    const a = g.scores[p1].score
    const b = g.scores[p2].score

    if (a === b) {
      return m.reply(
        `🏀 *DRAW!*\n\n` +
        `${nameOf(p1)}: ${a}\n` +
        `${nameOf(p2)}: ${b}`
      )
    }

    const winner =
      a > b ? p1 : p2

    await reward(winner, 600)

    await m.reply({
      text:
        `🏀 *BASKETBALL RESULT*\n\n` +
        `${nameOf(p1)}: ${a}\n` +
        `${nameOf(p2)}: ${b}\n\n` +
        `🏆 ${nameOf(winner)} wins!\n` +
        `💰 +${CURRENCY} 600`,
      mentions: g.players
    })

    return true
  }

  /* --------------------------------------------------------------
   * SLOT
   * -------------------------------------------------------------- */

  if (g.type === 'slotduel') {
    return false
  }

  /* --------------------------------------------------------------
   * SURVIVAL
   * -------------------------------------------------------------- */

  if (g.type === 'survival') {
    if (
      !['run', 'hide', 'fight'].includes(
        text
      )
    ) {
      return true
    }

    g.moves ||= {}

    g.moves[m.sender] = text

    if (
      Object.keys(g.moves).length < 2
    ) {
      return true
    }

    const [p1, p2] = g.players

    const outcomes = {
      run: 1,
      hide: 2,
      fight: 3
    }

    const a = outcomes[g.moves[p1]]
    const b = outcomes[g.moves[p2]]

    deleteGame(m.chat)

    if (a === b) {
      return m.reply(
        `☠️ Both players chose *${g.moves[p1]}*.\n\n🤝 Draw!`
      )
    }

    const winner =
      a > b ? p1 : p2

    await reward(winner, 800)

    await m.reply({
      text:
        `☠️ *SURVIVAL RESULT*\n\n` +
        `${nameOf(p1)}: ${g.moves[p1]}\n` +
        `${nameOf(p2)}: ${g.moves[p2]}\n\n` +
        `🏆 ${nameOf(winner)} survived!\n` +
        `💰 +${CURRENCY} 800`,
      mentions: g.players
    })

    return true
  }

  return false
}
