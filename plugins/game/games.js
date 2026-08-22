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
 * AY-LEE BOT — MULTIPLAYER GAME ENGINE
 * ================================================================
 *
 * HOST MODE:
 *
 * .dice @player
 * -> You vs @player
 *
 * .dice @player1 @player2
 * -> @player1 vs @player2
 * -> You are only the host
 *
 * Players NEVER need the "." prefix.
 *
 * Example:
 *
 * Host:
 *   .rps @John @Mike
 *
 * John:
 *   ACCEPT
 *
 * Mike:
 *   ACCEPT
 *
 * John:
 *   ROCK
 *
 * Mike:
 *   SCISSORS
 *
 * Bot:
 *   John wins!
 *
 * ================================================================
 */

const games = new Map()

const WIN_REWARD = 500
const DRAW_REWARD = 100
const ACCEPT_TIMEOUT = 60_000
const GAME_TIMEOUT = 120_000

const clean = (x) =>
  String(x || '')
    .trim()
    .toLowerCase()

const mentionNumber = (jid) =>
  String(jid || '').split('@')[0].split(':')[0]

const mentions = (...users) =>
  users.filter(Boolean)

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function reward(jid, amount) {
  try {
    const user = await getUser(jid)
    user.wallet += amount
    await saveUser(user)
    return user.wallet
  } catch {
    return null
  }
}

function gameKey(chat) {
  return String(chat)
}

function getGame(chat) {
  return games.get(gameKey(chat))
}

function setGame(chat, game) {
  games.set(gameKey(chat), game)
}

function deleteGame(chat) {
  games.delete(gameKey(chat))
}

function isPlayer(game, jid) {
  return game?.players?.includes(jid)
}

function otherPlayer(game, jid) {
  return game.players.find((x) => x !== jid)
}

function playerTag(jid) {
  return `@${mentionNumber(jid)}`
}

function gamePlayersText(game) {
  return `${playerTag(game.players[0])} ⚔️ ${playerTag(game.players[1])}`
}

async function finishGame(m, game, winner, loser, draw = false) {
  deleteGame(m.chat)

  if (draw) {
    await Promise.all(
      game.players.map((p) => reward(p, DRAW_REWARD))
    )

    return m.reply({
      text:
        `🤝 *DRAW!*\n\n` +
        `${gamePlayersText(game)}\n\n` +
        `Both players receive ${CURRENCY} ${comma(DRAW_REWARD)}.`,
      mentions: game.players
    })
  }

  const wallet = await reward(winner, WIN_REWARD)

  await m.reply({
    text:
      `🏆 *GAME OVER!*\n\n` +
      `${gamePlayersText(game)}\n\n` +
      `🥇 ${playerTag(winner)} *WINS!*\n` +
      `💰 Prize: ${CURRENCY} ${comma(WIN_REWARD)}` +
      (wallet !== null
        ? `\n💵 Wallet: ${CURRENCY} ${comma(wallet)}`
        : ''),
    mentions: game.players
  })
}

/* ================================================================
 * START / ACCEPT SYSTEM
 * ================================================================ */

async function createDuel({
  m,
  command,
  players,
  title,
  instructions,
  data = {}
}) {
  if (games.has(m.chat)) {
    return m.reply(
      '🎮 A game is already running in this group.\n\n' +
      'Use *.endgame* to cancel it.'
    )
  }

  if (!players || players.length !== 2) {
    return m.reply(
      `🎮 Usage:\n\n` +
      `.${command} @player\n` +
      `or\n` +
      `.${command} @player1 @player2`
    )
  }

  if (players[0] === players[1]) {
    return m.reply('❌ The two players must be different.')
  }

  const game = {
    type: command,
    title,
    host: m.sender,
    players,
    accepted: new Set(),
    stage: 'accept',
    createdAt: Date.now(),
    data
  }

  setGame(m.chat, game)

  const timer = setTimeout(async () => {
    const current = getGame(m.chat)

    if (current === game && current.stage === 'accept') {
      deleteGame(m.chat)

      try {
        await m.send(
          `⏰ *${title}*\n\n` +
          `Game cancelled because the players did not accept in time.`
        )
      } catch {}
    }
  }, ACCEPT_TIMEOUT)

  game.acceptTimer = timer

  await m.reply({
    text:
      `🎮 *${title}*\n\n` +
      `${gamePlayersText(game)}\n\n` +
      `👑 Host: ${playerTag(game.host)}\n\n` +
      `Both players should reply *ACCEPT*.\n` +
      `Reply *DECLINE* to reject.\n\n` +
      `${instructions}`,
    mentions: [
      ...game.players,
      game.host
    ]
  })
}

/* ================================================================
 * GENERIC ACCEPT HANDLER
 * ================================================================ */

async function handleAccept(m, game) {
  const text = clean(m.body)

  if (!['accept', 'yes', 'decline', 'no'].includes(text)) {
    return false
  }

  if (!isPlayer(game, m.sender)) {
    return false
  }

  if (text === 'decline' || text === 'no') {
    clearTimeout(game.acceptTimer)
    deleteGame(m.chat)

    await m.reply({
      text:
        `❌ ${playerTag(m.sender)} declined the game.\n\n` +
        `🎮 Game cancelled.`,
      mentions: game.players
    })

    return true
  }

  game.accepted.add(m.sender)

  if (game.accepted.size < 2) {
    await m.reply(
      `✅ ${playerTag(m.sender)} accepted.\n\n` +
      `Waiting for the other player...`
    )

    return true
  }

  clearTimeout(game.acceptTimer)

  game.stage = 'playing'
  game.startedAt = Date.now()

  await startGame(m, game)

  game.gameTimer = setTimeout(async () => {
    const current = getGame(m.chat)

    if (current === game) {
      deleteGame(m.chat)

      try {
        await m.send(
          `⏰ *${game.title}*\n\n` +
          `Game timed out because the players took too long.`
        )
      } catch {}
    }
  }, GAME_TIMEOUT)

  return true
}

/* ================================================================
 * 1. DICE BATTLE
 * ================================================================ */

async function startDice(m, game) {
  game.data.rolls = {}

  await m.reply({
    text:
      `🎲 *DICE BATTLE*\n\n` +
      `${gamePlayersText(game)}\n\n` +
      `Reply *ROLL* to roll your dice.\n` +
      `First player to roll does not automatically win — both must roll.`,
    mentions: game.players
  })
}

async function handleDice(m, game) {
  if (clean(m.body) !== 'roll') return false
  if (!isPlayer(game, m.sender)) return false

  if (game.data.rolls[m.sender]) {
    await m.reply('🎲 You already rolled.')
    return true
  }

  const value = rand(1, 6)
  game.data.rolls[m.sender] = value

  await m.reply(
    `🎲 ${playerTag(m.sender)} rolled *${value}*!`
  )

  if (Object.keys(game.data.rolls).length === 2) {
    const [a, b] = game.players
    const av = game.data.rolls[a]
    const bv = game.data.rolls[b]

    clearTimeout(game.gameTimer)

    if (av === bv) {
      return finishGame(m, game, null, null, true)
    }

    return finishGame(
      m,
      game,
      av > bv ? a : b,
      av > bv ? b : a
    )
  }

  return true
}

/* ================================================================
 * 2. ROCK PAPER SCISSORS
 * ================================================================ */

async function startRps(m, game) {
  game.data.moves = {}

  await m.reply(
    `✊ *ROCK PAPER SCISSORS*\n\n` +
    `Both players reply with:\n\n` +
    `ROCK 🪨\n` +
    `PAPER 📄\n` +
    `SCISSORS ✂️`
  )
}

async function handleRps(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const move = clean(m.body)

  if (!['rock', 'paper', 'scissors'].includes(move)) {
    return false
  }

  if (game.data.moves[m.sender]) {
    await m.reply('You already selected your move.')
    return true
  }

  game.data.moves[m.sender] = move

  await m.reply('✅ Move locked.')

  if (Object.keys(game.data.moves).length !== 2) {
    return true
  }

  const [a, b] = game.players
  const x = game.data.moves[a]
  const y = game.data.moves[b]

  clearTimeout(game.gameTimer)

  if (x === y) {
    return finishGame(m, game, null, null, true)
  }

  const wins = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper'
  }

  const winner = wins[x] === y ? a : b
  const loser = winner === a ? b : a

  return finishGame(m, game, winner, loser)
}

/* ================================================================
 * 3. COIN DUEL
 * ================================================================ */

async function startCoin(m, game) {
  game.data.choices = {}

  await m.reply(
    `🪙 *COIN DUEL*\n\n` +
    `Both players choose:\n\n` +
    `HEADS 🪙\n` +
    `TAILS 🪙\n\n` +
    `Reply *HEADS* or *TAILS*.`
  )
}

async function handleCoin(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const choice = clean(m.body)

  if (!['heads', 'tails'].includes(choice)) {
    return false
  }

  if (game.data.choices[m.sender]) {
    await m.reply('You already chose.')
    return true
  }

  game.data.choices[m.sender] = choice

  await m.reply('🪙 Choice locked.')

  if (Object.keys(game.data.choices).length !== 2) {
    return true
  }

  const result = Math.random() < 0.5 ? 'heads' : 'tails'
  const winner = game.players.find(
    (p) => game.data.choices[p] === result
  )

  clearTimeout(game.gameTimer)

  if (!winner) {
    return finishGame(m, game, null, null, true)
  }

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 4. HIGH CARD
 * ================================================================ */

async function startHighCard(m, game) {
  const cards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  game.data.cards = {}

  await m.reply(
    `🃏 *HIGH CARD*\n\n` +
    `Both players reply *DRAW*.\n` +
    `The higher card wins!`
  )
}

async function handleHighCard(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'draw') return false

  if (game.data.cards[m.sender]) {
    await m.reply('🃏 You already drew.')
    return true
  }

  const card = rand(1, 10)
  game.data.cards[m.sender] = card

  await m.reply(
    `🃏 ${playerTag(m.sender)} drew *${card}*.`
  )

  if (Object.keys(game.data.cards).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.cards[a] === game.data.cards[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.cards[a] > game.data.cards[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 5. REACTION BATTLE
 * ================================================================ */

async function startReaction(m, game) {
  const delay = rand(3, 8) * 1000

  game.data.ready = {}
  game.data.started = false

  await m.reply(
    `⚡ *REACTION BATTLE*\n\n` +
    `Wait for the bot to say:\n\n` +
    `🔥 *GO!*\n\n` +
    `Then immediately reply *GO*.`
  )

  setTimeout(async () => {
    const current = getGame(m.chat)

    if (current !== game) return

    game.data.started = true
    game.data.goTime = Date.now()

    await m.send(
      `🔥🔥🔥 *GO!* 🔥🔥🔥`
    ).catch(() => {})
  }, delay)
}

async function handleReaction(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'go') return false

  if (!game.data.started) {
    await m.reply('❌ Too early! Wait for GO!')
    return true
  }

  if (game.data.ready[m.sender]) return true

  game.data.ready[m.sender] =
    Date.now() - game.data.goTime

  await m.reply(
    `⚡ ${playerTag(m.sender)} reacted in *${game.data.ready[m.sender]}ms*!`
  )

  if (Object.keys(game.data.ready).length !== 2) {
    return true
  }

  clearTimeout(game.gameTimer)

  const [a, b] = game.players

  const winner =
    game.data.ready[a] < game.data.ready[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 6. NUMBER GUESS DUEL
 * ================================================================ */

async function startNumber(m, game) {
  game.data.targets = {}
  game.data.guesses = {}

  const target = rand(1, 50)

  game.data.target = target

  await m.reply(
    `🔢 *NUMBER GUESS DUEL*\n\n` +
    `The bot has selected a number from *1-50*.\n\n` +
    `Both players should reply with a number.\n` +
    `Closest guess wins!`
  )
}

async function handleNumber(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const n = parseInt(clean(m.body))

  if (!Number.isInteger(n) || n < 1 || n > 50) {
    return false
  }

  if (game.data.guesses[m.sender] !== undefined) {
    await m.reply('🔢 You already guessed.')
    return true
  }

  game.data.guesses[m.sender] = n

  await m.reply(
    `🔢 ${playerTag(m.sender)} locked in *${n}*.`
  )

  if (Object.keys(game.data.guesses).length !== 2) {
    return true
  }

  const [a, b] = game.players

  const da = Math.abs(game.data.target - game.data.guesses[a])
  const db = Math.abs(game.data.target - game.data.guesses[b])

  clearTimeout(game.gameTimer)

  await m.send(
    `🎯 The number was *${game.data.target}*.\n\n` +
    `${playerTag(a)} → ${game.data.guesses[a]} (${da} away)\n` +
    `${playerTag(b)} → ${game.data.guesses[b]} (${db} away)`
  )

  if (da === db) {
    return finishGame(m, game, null, null, true)
  }

  const winner = da < db ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 7. MATH DUEL
 * ================================================================ */

async function startMath(m, game) {
  const a = rand(2, 20)
  const b = rand(2, 20)
  const ops = ['+', '-', '*']
  const op = pick(ops)

  let answer

  if (op === '+') answer = a + b
  if (op === '-') answer = a - b
  if (op === '*') answer = a * b

  game.data.answer = answer
  game.data.answered = false

  await m.reply(
    `🧠 *MATH DUEL*\n\n` +
    `First player to correctly answer wins!\n\n` +
    `❓ *${a} ${op} ${b} = ?*\n\n` +
    `Reply with the answer.`
  )
}

async function handleMath(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const answer = parseInt(clean(m.body))

  if (!Number.isInteger(answer)) return false

  if (answer !== game.data.answer) {
    await m.reply('❌ Wrong answer.')
    return true
  }

  clearTimeout(game.gameTimer)

  game.data.answered = true

  return finishGame(
    m,
    game,
    m.sender,
    otherPlayer(game, m.sender)
  )
}

/* ================================================================
 * 8. WORD SCRAMBLE DUEL
 * ================================================================ */

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
  'programming',
  'developer',
  'technology',
  'internet'
]

function scramble(word) {
  const a = [...word]

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }

  const out = a.join('')

  return out === word ? scramble(word) : out
}

async function startScramble(m, game) {
  game.data.word = pick(WORDS)

  await m.reply(
    `🔤 *WORD DUEL*\n\n` +
    `First player to unscramble this wins:\n\n` +
    `🔥 *${scramble(game.data.word).toUpperCase()}*\n\n` +
    `Reply with the correct word.`
  )
}

async function handleScramble(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const guess = clean(m.body)

  if (!/^[a-z]+$/.test(guess)) return false

  if (guess !== game.data.word) {
    return false
  }

  clearTimeout(game.gameTimer)

  return finishGame(
    m,
    game,
    m.sender,
    otherPlayer(game, m.sender)
  )
}

/* ================================================================
 * 9. TARGET BATTLE
 * ================================================================ */

async function startTarget(m, game) {
  game.data.scores = {}

  await m.reply(
    `🎯 *TARGET BATTLE*\n\n` +
    `Both players reply *SHOOT*.\n\n` +
    `The bot will generate your accuracy score.`
  )
}

async function handleTarget(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'shoot') return false

  if (game.data.scores[m.sender]) {
    await m.reply('🎯 You already shot.')
    return true
  }

  const score = rand(1, 100)

  game.data.scores[m.sender] = score

  await m.reply(
    `🎯 ${playerTag(m.sender)} scored *${score}/100*!`
  )

  if (Object.keys(game.data.scores).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.scores[a] === game.data.scores[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.scores[a] > game.data.scores[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 10. BOWLING
 * ================================================================ */

async function startBowling(m, game) {
  game.data.scores = {}

  await m.reply(
    `🎳 *BOWLING DUEL*\n\n` +
    `Both players reply *BOWL*.`
  )
}

async function handleBowling(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'bowl') return false

  if (game.data.scores[m.sender]) {
    await m.reply('🎳 You already bowled.')
    return true
  }

  const score = rand(0, 10)

  game.data.scores[m.sender] = score

  await m.reply(
    `🎳 ${playerTag(m.sender)} knocked down *${score} pins*!`
  )

  if (Object.keys(game.data.scores).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.scores[a] === game.data.scores[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.scores[a] > game.data.scores[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 11. ARCHERY
 * ================================================================ */

async function startArchery(m, game) {
  game.data.scores = {}

  await m.reply(
    `🏹 *ARCHERY DUEL*\n\n` +
    `Reply *SHOOT* to fire your arrow.\n` +
    `Closest to the bullseye wins!`
  )
}

async function handleArchery(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'shoot') return false

  if (game.data.scores[m.sender]) return true

  const score = rand(1, 100)

  game.data.scores[m.sender] = score

  await m.reply(
    `🏹 ${playerTag(m.sender)} scored *${score}/100*!`
  )

  if (Object.keys(game.data.scores).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.scores[a] === game.data.scores[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.scores[a] > game.data.scores[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 12. RACING DUEL
 * ================================================================ */

async function startRace(m, game) {
  game.data.distance = {
    [game.players[0]]: 0,
    [game.players[1]]: 0
  }

  game.data.turns = 0

  await m.reply(
    `🏎️ *RACING DUEL*\n\n` +
    `Each player should reply *GO*.\n` +
    `First to reach 100 meters wins!\n\n` +
    `You need 5 rounds.`
  )
}

async function handleRace(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'go') return false

  const gain = rand(10, 30)

  game.data.distance[m.sender] += gain

  game.data.turns++

  await m.reply(
    `🏎️ ${playerTag(m.sender)} moved *${gain}m*.\n` +
    `📍 Distance: *${game.data.distance[m.sender]}m*`
  )

  if (game.data.distance[m.sender] >= 100) {
    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      m.sender,
      otherPlayer(game, m.sender)
    )
  }

  return true
}

/* ================================================================
 * 13. PENALTY SHOOTOUT
 * ================================================================ */

async function startPenalty(m, game) {
  game.data.scores = {}

  await m.reply(
    `⚽ *PENALTY SHOOTOUT*\n\n` +
    `Reply *SHOOT*.\n\n` +
    `The bot will determine whether you score.`
  )
}

async function handlePenalty(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'shoot') return false

  if (game.data.scores[m.sender]) return true

  const scored = Math.random() < 0.65

  game.data.scores[m.sender] = scored ? 1 : 0

  await m.reply(
    scored
      ? `⚽ ${playerTag(m.sender)} *GOOOAL!* 🔥`
      : `🧤 ${playerTag(m.sender)} MISSED!`
  )

  if (Object.keys(game.data.scores).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.scores[a] === game.data.scores[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.scores[a] > game.data.scores[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 14. BASKETBALL
 * ================================================================ */

async function startBasketball(m, game) {
  game.data.scores = {}

  await m.reply(
    `🏀 *BASKETBALL DUEL*\n\n` +
    `Reply *SHOOT*.\n` +
    `Higher score wins.`
  )
}

async function handleBasketball(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'shoot') return false

  if (game.data.scores[m.sender]) return true

  const score = rand(0, 30)

  game.data.scores[m.sender] = score

  await m.reply(
    `🏀 ${playerTag(m.sender)} scored *${score} points*!`
  )

  if (Object.keys(game.data.scores).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.scores[a] === game.data.scores[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.scores[a] > game.data.scores[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 15. BOMB DUEL
 * ================================================================ */

async function startBomb(m, game) {
  game.data.choice = {}

  await m.reply(
    `💣 *BOMB DUEL*\n\n` +
    `Choose a number from *1-5*.\n\n` +
    `One number contains the bomb.\n` +
    `If both survive, the higher number wins.\n\n` +
    `Reply with *1*, *2*, *3*, *4* or *5*.`
  )

  game.data.bomb = rand(1, 5)
}

async function handleBomb(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const choice = parseInt(clean(m.body))

  if (!Number.isInteger(choice) || choice < 1 || choice > 5) {
    return false
  }

  if (game.data.choice[m.sender]) return true

  game.data.choice[m.sender] = choice

  if (choice === game.data.bomb) {
    clearTimeout(game.gameTimer)

    const winner = otherPlayer(game, m.sender)

    await m.reply(
      `💥 *BOOM!*\n\n` +
      `${playerTag(m.sender)} picked the bomb!\n` +
      `💀 ${playerTag(winner)} wins!`
    )

    return finishGame(m, game, winner, m.sender)
  }

  await m.reply(
    `😮 ${playerTag(m.sender)} survived!`
  )

  if (Object.keys(game.data.choice).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.choice[a] === game.data.choice[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.choice[a] > game.data.choice[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 16. EMOJI GUESS
 * ================================================================ */

const EMOJIS = [
  ['🍎🍎🍎', 'apple'],
  ['🐘🌳', 'elephant'],
  ['⚽🥅', 'football'],
  ['🌧️🌈', 'rainbow'],
  ['🍫', 'chocolate'],
  ['🦋🌸', 'butterfly'],
  ['🚗🏁', 'racing'],
  ['🌙⭐', 'night'],
  ['🔥🏠', 'fire'],
  ['📱💬', 'whatsapp']
]

async function startEmoji(m, game) {
  const item = pick(EMOJIS)

  game.data.answer = item[1]

  await m.reply(
    `🤔 *EMOJI GUESS DUEL*\n\n` +
    `${item[0]}\n\n` +
    `First player to guess the word wins!`
  )
}

async function handleEmoji(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const answer = clean(m.body)

  if (!answer) return false

  if (answer !== game.data.answer) {
    return false
  }

  clearTimeout(game.gameTimer)

  return finishGame(
    m,
    game,
    m.sender,
    otherPlayer(game, m.sender)
  )
}

/* ================================================================
 * 17. MEMORY DUEL
 * ================================================================ */

async function startMemory(m, game) {
  const sequence = Array.from(
    { length: 5 },
    () => rand(1, 9)
  )

  game.data.sequence = sequence

  await m.reply(
    `🧠 *MEMORY DUEL*\n\n` +
    `Remember this number sequence:\n\n` +
    `*${sequence.join(' - ')}*\n\n` +
    `You have 5 seconds...`
  )

  setTimeout(async () => {
    const current = getGame(m.chat)

    if (current !== game) return

    await m.send(
      `🧠 *GO!*\n\n` +
      `Reply with the sequence.`
    ).catch(() => {})
  }, 5000)
}

async function handleMemory(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const answer = clean(m.body)
    .replace(/\s+/g, '')

  const correct =
    game.data.sequence.join('')

  if (answer !== correct) {
    await m.reply('❌ Wrong sequence.')
    return true
  }

  clearTimeout(game.gameTimer)

  return finishGame(
    m,
    game,
    m.sender,
    otherPlayer(game, m.sender)
  )
}

/* ================================================================
 * 18. ODDS OR EVENS
 * ================================================================ */

async function startOdds(m, game) {
  game.data.choices = {}

  await m.reply(
    `🔢 *ODDS OR EVENS*\n\n` +
    `Choose *ODD* or *EVEN*.\n` +
    `Then both players choose a number 1-5.`
  )
}

async function handleOdds(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const text = clean(m.body)

  if (!game.data.choices[m.sender]) {
    if (!['odd', 'even'].includes(text)) return false

    game.data.choices[m.sender] = {
      parity: text
    }

    await m.reply(
      `✅ ${text.toUpperCase()} selected.\nNow choose a number *1-5*.`
    )

    return true
  }

  if (game.data.choices[m.sender].number) {
    return true
  }

  const number = parseInt(text)

  if (!Number.isInteger(number) || number < 1 || number > 5) {
    return false
  }

  game.data.choices[m.sender].number = number

  await m.reply(
    `🔢 Number *${number}* locked.`
  )

  const [a, b] = game.players

  if (
    !game.data.choices[a]?.number ||
    !game.data.choices[b]?.number
  ) {
    return true
  }

  const total =
    game.data.choices[a].number +
    game.data.choices[b].number

  const parity =
    total % 2 === 0 ? 'even' : 'odd'

  const winner = game.players.find(
    (p) => game.data.choices[p].parity === parity
  )

  clearTimeout(game.gameTimer)

  if (!winner) {
    return finishGame(m, game, null, null, true)
  }

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 19. TRIVIA DUEL
 * ================================================================ */

async function startTrivia(m, game) {
  try {
    const d = await getJson(
      'https://opentdb.com/api.php?amount=1&type=multiple'
    )

    const q = d.results?.[0]

    if (!q) {
      deleteGame(m.chat)
      return m.reply('❌ Could not load a trivia question.')
    }

    const decode = (s) =>
      String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&eacute;/g, 'é')
        .replace(/&rsquo;/g, "'")

    const correct = decode(q.correct_answer)

    const answers = [
      ...q.incorrect_answers.map(decode),
      correct
    ].sort(() => Math.random() - 0.5)

    game.data.answer = correct
    game.data.answers = answers

    await m.reply(
      `🧠 *TRIVIA DUEL*\n\n` +
      `${decode(q.question)}\n\n` +
      answers
        .map(
          (x, i) =>
            `${String.fromCharCode(65 + i)}. ${x}`
        )
        .join('\n') +
      `\n\nFirst player to answer correctly wins.`
    )
  } catch {
    deleteGame(m.chat)
    await m.reply('❌ Trivia service is unavailable.')
  }
}

async function handleTrivia(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const answer = clean(m.body)

  const correct = clean(game.data.answer)

  const index = game.data.answers.findIndex(
    (x) => clean(x) === answer
  )

  const letterAnswer =
    /^[a-d]$/.test(answer)
      ? game.data.answers[answer.charCodeAt(0) - 97]
      : null

  if (
    answer !== correct &&
    clean(letterAnswer) !== correct
  ) {
    return false
  }

  clearTimeout(game.gameTimer)

  return finishGame(
    m,
    game,
    m.sender,
    otherPlayer(game, m.sender)
  )
}

/* ================================================================
 * 20. QUICK DRAW
 * ================================================================ */

async function startQuickDraw(m, game) {
  game.data.go = false
  game.data.shots = {}

  await m.reply(
    `🔫 *QUICK DRAW*\n\n` +
    `Wait for *DRAW!*.\n` +
    `Then reply *FIRE* as quickly as possible.`
  )

  setTimeout(async () => {
    const current = getGame(m.chat)

    if (current !== game) return

    game.data.go = true
    game.data.time = Date.now()

    await m.send('🔥 *DRAW!* 🔥').catch(() => {})
  }, rand(3, 7) * 1000)
}

async function handleQuickDraw(m, game) {
  if (!isPlayer(game, m.sender)) return false

  if (clean(m.body) !== 'fire') return false

  if (!game.data.go) {
    await m.reply('❌ Too early!')
    return true
  }

  if (game.data.shots[m.sender]) return true

  game.data.shots[m.sender] =
    Date.now() - game.data.time

  await m.reply(
    `⚡ ${playerTag(m.sender)} fired in *${game.data.shots[m.sender]}ms*!`
  )

  if (Object.keys(game.data.shots).length !== 2) {
    return true
  }

  clearTimeout(game.gameTimer)

  const [a, b] = game.players

  const winner =
    game.data.shots[a] < game.data.shots[b]
      ? a
      : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 21. FORTUNE DUEL
 * ================================================================ */

async function startFortune(m, game) {
  game.data.scores = {}

  await m.reply(
    `🍀 *FORTUNE DUEL*\n\n` +
    `Reply *FORTUNE*.\n` +
    `The luckiest player wins!`
  )
}

async function handleFortune(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'fortune') return false

  if (game.data.scores[m.sender]) return true

  const score = rand(1, 100)

  game.data.scores[m.sender] = score

  await m.reply(
    `🍀 ${playerTag(m.sender)} has *${score}% luck*!`
  )

  if (Object.keys(game.data.scores).length !== 2) {
    return true
  }

  const [a, b] = game.players

  clearTimeout(game.gameTimer)

  if (game.data.scores[a] === game.data.scores[b]) {
    return finishGame(m, game, null, null, true)
  }

  const winner =
    game.data.scores[a] > game.data.scores[b] ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 22. STONE PAPER SCISSORS EXTREME
 * ================================================================ */

async function startSps(m, game) {
  game.data.moves = {}

  await m.reply(
    `🔥 *EXTREME RPS*\n\n` +
    `Reply:\n` +
    `ROCK\n` +
    `PAPER\n` +
    `SCISSORS\n` +
    `FIRE\n\n` +
    `FIRE beats everything except WATER.\n` +
    `For this duel, WATER is randomly generated.`
  )
}

async function handleSps(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const move = clean(m.body)

  if (
    ![
      'rock',
      'paper',
      'scissors',
      'fire'
    ].includes(move)
  ) {
    return false
  }

  if (game.data.moves[m.sender]) return true

  game.data.moves[m.sender] = move

  if (Object.keys(game.data.moves).length !== 2) {
    await m.reply('🔥 Move locked.')
    return true
  }

  const [a, b] = game.players

  const x = game.data.moves[a]
  const y = game.data.moves[b]

  clearTimeout(game.gameTimer)

  if (x === y) {
    return finishGame(m, game, null, null, true)
  }

  const beats = {
    rock: ['scissors'],
    paper: ['rock'],
    scissors: ['paper'],
    fire: ['rock', 'paper', 'scissors']
  }

  const winner = beats[x]?.includes(y) ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 23. LUCKY NUMBER
 * ================================================================ */

async function startLucky(m, game) {
  game.data.guesses = {}

  await m.reply(
    `🍀 *LUCKY NUMBER DUEL*\n\n` +
    `Choose a number from *1-20*.\n` +
    `The player closest to the lucky number wins.`
  )

  game.data.target = rand(1, 20)
}

async function handleLucky(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const n = parseInt(clean(m.body))

  if (!Number.isInteger(n) || n < 1 || n > 20) {
    return false
  }

  if (game.data.guesses[m.sender] !== undefined) {
    return true
  }

  game.data.guesses[m.sender] = n

  if (Object.keys(game.data.guesses).length !== 2) {
    await m.reply('🍀 Number locked.')
    return true
  }

  const [a, b] = game.players

  const da =
    Math.abs(game.data.target - game.data.guesses[a])

  const db =
    Math.abs(game.data.target - game.data.guesses[b])

  clearTimeout(game.gameTimer)

  await m.send(
    `🍀 Lucky number: *${game.data.target}*\n\n` +
    `${playerTag(a)} → ${game.data.guesses[a]}\n` +
    `${playerTag(b)} → ${game.data.guesses[b]}`
  )

  if (da === db) {
    return finishGame(m, game, null, null, true)
  }

  const winner = da < db ? a : b

  return finishGame(
    m,
    game,
    winner,
    otherPlayer(game, winner)
  )
}

/* ================================================================
 * 24. BOXING
 * ================================================================ */

async function startBoxing(m, game) {
  game.data.hp = {
    [game.players[0]]: 100,
    [game.players[1]]: 100
  }

  await m.reply(
    `🥊 *BOXING DUEL*\n\n` +
    `Players attack by replying *PUNCH*.\n` +
    `Each punch deals random damage.\n` +
    `First player to reduce opponent to 0 HP wins.`
  )
}

async function handleBoxing(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'punch') return false

  const opponent = otherPlayer(game, m.sender)

  const damage = rand(10, 25)

  game.data.hp[opponent] -= damage

  await m.reply(
    `🥊 ${playerTag(m.sender)} punched ${playerTag(opponent)}!\n\n` +
    `💥 Damage: *${damage}*\n` +
    `❤️ ${playerTag(opponent)} HP: *${Math.max(
      0,
      game.data.hp[opponent]
    )}*`
  )

  if (game.data.hp[opponent] <= 0) {
    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      m.sender,
      opponent
    )
  }

  return true
}

/* ================================================================
 * 25. SWORD DUEL
 * ================================================================ */

async function startSword(m, game) {
  game.data.hp = {
    [game.players[0]]: 100,
    [game.players[1]]: 100
  }

  await m.reply(
    `⚔️ *SWORD DUEL*\n\n` +
    `Reply *ATTACK* to strike your opponent.\n` +
    `Reply *BLOCK* to reduce incoming damage.`
  )
}

async function handleSword(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const action = clean(m.body)

  if (!['attack', 'block'].includes(action)) {
    return false
  }

  const opponent = otherPlayer(game, m.sender)

  if (action === 'block') {
    game.data.blocked = game.data.blocked || {}
    game.data.blocked[m.sender] = true

    await m.reply('🛡️ You are blocking this round.')
    return true
  }

  const damage =
    game.data.blocked?.[opponent]
      ? rand(2, 8)
      : rand(10, 25)

  if (game.data.blocked?.[opponent]) {
    delete game.data.blocked[opponent]
  }

  game.data.hp[opponent] -= damage

  await m.reply(
    `⚔️ ${playerTag(m.sender)} attacked!\n` +
    `💥 Damage: *${damage}*\n` +
    `❤️ ${playerTag(opponent)}: *${Math.max(
      0,
      game.data.hp[opponent]
    )} HP*`
  )

  if (game.data.hp[opponent] <= 0) {
    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      m.sender,
      opponent
    )
  }

  return true
}

/* ================================================================
 * 26. SURVIVAL DUEL
 * ================================================================ */

async function startSurvival(m, game) {
  game.data.hp = {
    [game.players[0]]: 100,
    [game.players[1]]: 100
  }

  await m.reply(
    `🏝️ *SURVIVAL DUEL*\n\n` +
    `Reply *SURVIVE* each round.\n` +
    `Each round has a chance of damaging you.\n` +
    `Last survivor wins.`
  )
}

async function handleSurvival(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'survive') return false

  if (game.data.done?.[m.sender]) return true

  game.data.done = game.data.done || {}

  const damage =
    Math.random() < 0.6
      ? rand(5, 30)
      : 0

  game.data.hp[m.sender] -= damage
  game.data.done[m.sender] = true

  await m.reply(
    damage
      ? `🌪️ ${playerTag(m.sender)} took *${damage} damage*.\n❤️ HP: *${Math.max(
          0,
          game.data.hp[m.sender]
        )}*`
      : `🌴 ${playerTag(m.sender)} survived the round!`
  )

  if (game.data.hp[m.sender] <= 0) {
    const winner = otherPlayer(game, m.sender)

    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      winner,
      m.sender
    )
  }

  return true
}

/* ================================================================
 * 27. TREASURE DUEL
 * ================================================================ */

async function startTreasure(m, game) {
  game.data.choices = {}

  await m.reply(
    `🏴‍☠️ *TREASURE DUEL*\n\n` +
    `Choose one chest:\n\n` +
    `CHEST 1 🧰\n` +
    `CHEST 2 🧰\n` +
    `CHEST 3 🧰\n\n` +
    `One chest contains the treasure.`
  )

  game.data.treasure = rand(1, 3)
}

async function handleTreasure(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const choice = parseInt(clean(m.body))

  if (!Number.isInteger(choice) || choice < 1 || choice > 3) {
    return false
  }

  if (game.data.choices[m.sender]) return true

  game.data.choices[m.sender] = choice

  if (choice === game.data.treasure) {
    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      m.sender,
      otherPlayer(game, m.sender)
    )
  }

  await m.reply('❌ Empty chest!')

  if (Object.keys(game.data.choices).length === 2) {
    clearTimeout(game.gameTimer)

    return finishGame(m, game, null, null, true)
  }

  return true
}

/* ================================================================
 * 28. SPACE BATTLE
 * ================================================================ */

async function startSpace(m, game) {
  game.data.hp = {
    [game.players[0]]: 100,
    [game.players[1]]: 100
  }

  await m.reply(
    `🚀 *SPACE BATTLE*\n\n` +
    `Reply *FIRE* to attack.\n` +
    `Your laser deals random damage.`
  )
}

async function handleSpace(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'fire') return false

  const opponent = otherPlayer(game, m.sender)

  const damage = rand(10, 30)

  game.data.hp[opponent] -= damage

  await m.reply(
    `🚀 ${playerTag(m.sender)} fired!\n` +
    `💥 Damage: *${damage}*\n` +
    `🛸 ${playerTag(opponent)} HP: *${Math.max(
      0,
      game.data.hp[opponent]
    )}*`
  )

  if (game.data.hp[opponent] <= 0) {
    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      m.sender,
      opponent
    )
  }

  return true
}

/* ================================================================
 * 29. ZOMBIE DUEL
 * ================================================================ */

async function startZombie(m, game) {
  game.data.hp = {
    [game.players[0]]: 100,
    [game.players[1]]: 100
  }

  await m.reply(
    `🧟 *ZOMBIE SURVIVAL DUEL*\n\n` +
    `Reply *ATTACK* to attack the zombies.\n` +
    `Survive the longest to win.`
  )
}

async function handleZombie(m, game) {
  if (!isPlayer(game, m.sender)) return false
  if (clean(m.body) !== 'attack') return false

  const damage = rand(5, 25)

  game.data.hp[m.sender] -= damage

  await m.reply(
    `🧟 Zombies attacked ${playerTag(m.sender)}!\n` +
    `💥 Damage: *${damage}*\n` +
    `❤️ HP: *${Math.max(
      0,
      game.data.hp[m.sender]
    )}*`
  )

  if (game.data.hp[m.sender] <= 0) {
    const winner = otherPlayer(game, m.sender)

    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      winner,
      m.sender
    )
  }

  return true
}

/* ================================================================
 * 30. BATTLE ARENA
 * ================================================================ */

async function startArena(m, game) {
  game.data.hp = {
    [game.players[0]]: 100,
    [game.players[1]]: 100
  }

  await m.reply(
    `⚔️ *BATTLE ARENA*\n\n` +
    `Available actions:\n\n` +
    `⚔️ ATTACK\n` +
    `🛡️ DEFEND\n    ` +
    `💚 HEAL\n\n` +
    `Reduce your opponent's HP to zero.`
  )
}

async function handleArena(m, game) {
  if (!isPlayer(game, m.sender)) return false

  const action = clean(m.body)
  const opponent = otherPlayer(game, m.sender)

  if (!['attack', 'defend', 'heal'].includes(action)) {
    return false
  }

  if (action === 'heal') {
    const amount = rand(5, 15)

    game.data.hp[m.sender] = Math.min(
      100,
      game.data.hp[m.sender] + amount
    )

    await m.reply(
      `💚 ${playerTag(m.sender)} healed *${amount} HP*.\n` +
      `❤️ HP: *${game.data.hp[m.sender]}*`
    )

    return true
  }

  if (action === 'defend') {
    game.data.defend = game.data.defend || {}
    game.data.defend[m.sender] = true

    await m.reply(
      `🛡️ ${playerTag(m.sender)} is defending.`
    )

    return true
  }

  let damage = rand(10, 25)

  if (game.data.defend?.[opponent]) {
    damage = Math.floor(damage / 2)
    delete game.data.defend[opponent]
  }

  game.data.hp[opponent] -= damage

  await m.reply(
    `⚔️ ${playerTag(m.sender)} attacked!\n` +
    `💥 Damage: *${damage}*\n` +
    `❤️ ${playerTag(opponent)} HP: *${Math.max(
      0,
      game.data.hp[opponent]
    )}`
  )

  if (game.data.hp[opponent] <= 0) {
    clearTimeout(game.gameTimer)

    return finishGame(
      m,
      game,
      m.sender,
      opponent
    )
  }

  return true
}

/* ================================================================
 * GAME START ROUTER
 * ================================================================ */

async function startGame(m, game) {
  switch (game.type) {
    case 'dice':
      return startDice(m, game)

    case 'rps':
      return startRps(m, game)

    case 'coin':
      return startCoin(m, game)

    case 'highcard':
      return startHighCard(m, game)

    case 'reaction':
      return startReaction(m, game)

    case 'guessduel':
      return startNumber(m, game)

    case 'mathduel':
      return startMath(m, game)

    case 'wordduel':
      return startScramble(m, game)

    case 'target':
      return startTarget(m, game)

    case 'bowling':
      return startBowling(m, game)

    case 'archery':
      return startArchery(m, game)

    case 'race':
      return startRace(m, game)

    case 'penalty':
      return startPenalty(m, game)

    case 'basketball':
      return startBasketball(m, game)

    case 'bomb':
      return startBomb(m, game)

    case 'emoji':
      return startEmoji(m, game)

    case 'memory':
      return startMemory(m, game)

    case 'oddeven':
      return startOdds(m, game)

    case 'trivia':
      return startTrivia(m, game)

    case 'quickdraw':
      return startQuickDraw(m, game)

    case 'fortune':
      return startFortune(m, game)

    case 'sps':
      return startSps(m, game)

    case 'lucky':
      return startLucky(m, game)

    case 'boxing':
      return startBoxing(m, game)

    case 'sword':
      return startSword(m, game)

    case 'survival':
      return startSurvival(m, game)

    case 'treasure':
      return startTreasure(m, game)

    case 'space':
      return startSpace(m, game)

    case 'zombie':
      return startZombie(m, game)

    case 'arena':
      return startArena(m, game)

    default:
      throw new Error(`Unknown game: ${game.type}`)
  }
}

/* ================================================================
 * GAME MESSAGE ROUTER
 * ================================================================ */

async function handleGameMessage(m, game) {
  if (!game) return false

  if (Date.now() - game.createdAt > GAME_TIMEOUT + ACCEPT_TIMEOUT) {
    clearTimeout(game.gameTimer)
    clearTimeout(game.acceptTimer)
    deleteGame(m.chat)

    if (isPlayer(game, m.sender)) {
      await m.reply('⏰ This game has expired.')
      return true
    }

    return false
  }

  if (game.stage === 'accept') {
    return handleAccept(m, game)
  }

  switch (game.type) {
    case 'dice':
      return handleDice(m, game)

    case 'rps':
      return handleRps(m, game)

    case 'coin':
      return handleCoin(m, game)

    case 'highcard':
      return handleHighCard(m, game)

    case 'reaction':
      return handleReaction(m, game)

    case 'guessduel':
      return handleNumber(m, game)

    case 'mathduel':
      return handleMath(m, game)

    case 'wordduel':
      return handleScramble(m, game)

    case 'target':
      return handleTarget(m, game)

    case 'bowling':
      return handleBowling(m, game)

    case 'archery':
      return handleArchery(m, game)

    case 'race':
      return handleRace(m, game)

    case 'penalty':
      return handlePenalty(m, game)

    case 'basketball':
      return handleBasketball(m, game)

    case 'bomb':
      return handleBomb(m, game)

    case 'emoji':
      return handleEmoji(m, game)

    case 'memory':
      return handleMemory(m, game)

    case 'oddeven':
      return handleOdds(m, game)

    case 'trivia':
      return handleTrivia(m, game)

    case 'quickdraw':
      return handleQuickDraw(m, game)

    case 'fortune':
      return handleFortune(m, game)

    case 'sps':
      return handleSps(m, game)

    case 'lucky':
      return handleLucky(m, game)

    case 'boxing':
      return handleBoxing(m, game)

    case 'sword':
      return handleSword(m, game)

    case 'survival':
      return handleSurvival(m, game)

    case 'treasure':
      return handleTreasure(m, game)

    case 'space':
      return handleSpace(m, game)

    case 'zombie':
      return handleZombie(m, game)

    case 'arena':
      return handleArena(m, game)

    default:
      return false
  }
}

/* ================================================================
 * COMMAND FACTORY
 * ================================================================ */

function duelCommand({
  name,
  alias = [],
  title,
  desc,
  usage,
  type = name,
  instructions = 'Both players should reply *ACCEPT* to begin.'
}) {
  return {
    name,
    alias,
    category: 'GAME',
    desc,
    usage,
    group: true,

    async run({ m }) {
      const players = m.mentions || []

      let selected

      if (players.length >= 2) {
        selected = [
          players[0],
          players[1]
        ]
      } else if (players.length === 1) {
        selected = [
          m.sender,
          players[0]
        ]
      } else {
        return m.reply(
          `🎮 Usage:\n\n` +
          `.${name} @player\n` +
          `or\n` +
          `.${name} @player1 @player2`
        )
      }

      return createDuel({
        m,
        command: name,
        players: selected,
        title,
        instructions,
        data: {}
      })
    },

    async before({ m }) {
      const game = getGame(m.chat)

      if (!game) return false

      /*
       * Only the two actual players can interact with
       * an active game.
       *
       * This prevents spectators from accidentally
       * controlling games.
       */
      if (!isPlayer(game, m.sender)) {
        return false
      }

      return handleGameMessage(m, game)
    }
  }
}

/* ================================================================
 * END GAME COMMAND
 * ================================================================ */

const endGameCommand = {
  name: 'endgame',
  alias: ['stopgame', 'cancelgame'],
  category: 'GAME',
  desc: 'End the active game in the group',
  usage: '.endgame',
  group: true,

  async run({ m }) {
    const game = getGame(m.chat)

    if (!game) {
      return m.reply('❌ There is no active game.')
    }

    /*
     * Only the host can stop the game.
     */
    if (game.host !== m.sender) {
      return m.reply(
        '❌ Only the person who started the game can end it.'
      )
    }

    clearTimeout(game.gameTimer)
    clearTimeout(game.acceptTimer)

    deleteGame(m.chat)

    return m.reply(
      `🛑 *GAME ENDED*\n\n` +
      `The host cancelled the active game.`
    )
  }
}

/* ================================================================
 * HELP COMMAND
 * ================================================================ */

const gamesCommand = {
  name: 'games',
  alias: ['game', 'gamehelp'],
  category: 'GAME',
  desc: 'Show all available games',
  usage: '.games',
  group: true,

  async run({ m }) {
    return m.reply(
      `🎮 *AY-LEE GAME CENTER*\n\n` +

      `🥊 *DUEL GAMES*\n` +
      `1. 🎲 .dice\n` +
      `2. ✊ .rps\n` +
      `3. 🪙 .coin\n` +
      `4. 🃏 .highcard\n` +
      `5. ⚡ .reaction\n` +
      `6. 🔢 .guessduel\n` +
      `7. 🧠 .mathduel\n` +
      `8. 🔤 .wordduel\n` +
      `9. 🎯 .target\n` +
      `10. 🎳 .bowling\n` +
      `11. 🏹 .archery\n` +
      `12. 🏎️ .race\n` +
      `13. ⚽ .penalty\n` +
      `14. 🏀 .basketball\n` +
      `15. 💣 .bomb\n` +
      `16. 🤔 .emoji\n` +
      `17. 🧠 .memory\n` +
      `18. 🔢 .oddeven\n` +
      `19. 🧠 .trivia\n` +
      `20. 🔫 .quickdraw\n` +
      `21. 🍀 .fortune\n` +
      `22. 🔥 .sps\n` +
      `23. 🍀 .lucky\n` +
      `24. 🥊 .boxing\n` +
      `25. ⚔️ .sword\n` +
      `26. 🏝️ .survival\n` +
      `27. 🏴‍☠️ .treasure\n` +
      `28. 🚀 .space\n` +
      `29. 🧟 .zombie\n` +
      `30. ⚔️ .arena\n\n` +

      `📌 *HOW TO PLAY*\n\n` +

      `Play against someone:\n` +
      `*.dice @player*\n\n` +

      `Host two other people:\n` +
      `*.dice @player1 @player2*\n\n` +

      `👑 You can host without participating.\n` +
      `👥 Players don't need the . prefix.\n` +
      `👀 Spectators cannot interfere.\n\n` +

      `🛑 End a game:\n` +
      `*.endgame*`
    )
  }
}

/* ================================================================
 * EXPORT
 * ================================================================ */

export default [

  /* Help */
  gamesCommand,
  endGameCommand,

  /* 1 */
  duelCommand({
    name: 'dice',
    alias: ['dicebattle'],
    title: '🎲 DICE BATTLE',
    desc: 'Battle another player with dice',
    usage: '.dice @player'
  }),

  /* 2 */
  duelCommand({
    name: 'rps',
    alias: ['rockpaperscissors'],
    title: '✊ ROCK PAPER SCISSORS',
    desc: 'Play rock paper scissors',
    usage: '.rps @player'
  }),

  /* 3 */
  duelCommand({
    name: 'coin',
    alias: ['coinduel'],
    title: '🪙 COIN DUEL',
    desc: 'Battle using heads or tails',
    usage: '.coin @player'
  }),

  /* 4 */
  duelCommand({
    name: 'highcard',
    alias: ['cardduel'],
    title: '🃏 HIGH CARD',
    desc: 'Draw the highest card',
    usage: '.highcard @player'
  }),

  /* 5 */
  duelCommand({
    name: 'reaction',
    alias: ['react'],
    title: '⚡ REACTION BATTLE',
    desc: 'Test reaction speed',
    usage: '.reaction @player'
  }),

  /* 6 */
  duelCommand({
    name: 'guessduel',
    alias: ['numberduel'],
    title: '🔢 NUMBER GUESS DUEL',
    desc: 'Guess closest to the secret number',
    usage: '.guessduel @player'
  }),

  /* 7 */
  duelCommand({
    name: 'mathduel',
    alias: ['mathbattle'],
    title: '🧠 MATH DUEL',
    desc: 'Solve a math problem first',
    usage: '.mathduel @player'
  }),

  /* 8 */
  duelCommand({
    name: 'wordduel',
    alias: ['scrambleduel'],
    title: '🔤 WORD DUEL',
    desc: 'Unscramble a word faster',
    usage: '.wordduel @player'
  }),

  /* 9 */
  duelCommand({
    name: 'target',
    alias: ['targetbattle'],
    title: '🎯 TARGET BATTLE',
    desc: 'Compete for the highest accuracy',
    usage: '.target @player'
  }),

  /* 10 */
  duelCommand({
    name: 'bowling',
    alias: ['bowlduel'],
    title: '🎳 BOWLING DUEL',
    desc: 'Compete for the highest bowling score',
    usage: '.bowling @player'
  }),

  /* 11 */
  duelCommand({
    name: 'archery',
    alias: ['archer'],
    title: '🏹 ARCHERY DUEL',
    desc: 'Compete for the highest archery score',
    usage: '.archery @player'
  }),

  /* 12 */
  duelCommand({
    name: 'race',
    alias: ['racing'],
    title: '🏎️ RACING DUEL',
    desc: 'Race against another player',
    usage: '.race @player'
  }),

  /* 13 */
  duelCommand({
    name: 'penalty',
    alias: ['penaltyshootout'],
    title: '⚽ PENALTY SHOOTOUT',
    desc: 'Battle in a penalty shootout',
    usage: '.penalty @player'
  }),

  /* 14 */
  duelCommand({
    name: 'basketball',
    alias: ['basket'],
    title: '🏀 BASKETBALL DUEL',
    desc: 'Compete for the highest basketball score',
    usage: '.basketball @player'
  }),

  /* 15 */
  duelCommand({
    name: 'bomb',
    alias: ['bombduel'],
    title: '💣 BOMB DUEL',
    desc: 'Avoid the hidden bomb',
    usage: '.bomb @player'
  }),

  /* 16 */
  duelCommand({
    name: 'emoji',
    alias: ['emojiguess'],
    title: '🤔 EMOJI GUESS DUEL',
    desc: 'Guess the emoji clue first',
    usage: '.emoji @player'
  }),

  /* 17 */
  duelCommand({
    name: 'memory',
    alias: ['memoryduel'],
    title: '🧠 MEMORY DUEL',
    desc: 'Remember the sequence',
    usage: '.memory @player'
  }),

  /* 18 */
  duelCommand({
    name: 'oddeven',
    alias: ['evenodd'],
    title: '🔢 ODD OR EVEN',
    desc: 'Battle with numbers and parity',
    usage: '.oddeven @player'
  }),

  /* 19 */
  duelCommand({
    name: 'trivia',
    alias: ['quizduel'],
    title: '🧠 TRIVIA DUEL',
    desc: 'Answer trivia questions first',
    usage: '.trivia @player'
  }),

  /* 20 */
  duelCommand({
    name: 'quickdraw',
    alias: ['quick'],
    title: '🔫 QUICK DRAW',
    desc: 'Test your reaction speed',
    usage: '.quickdraw @player'
  }),

  /* 21 */
  duelCommand({
    name: 'fortune',
    alias: ['luckduel'],
    title: '🍀 FORTUNE DUEL',
    desc: 'Battle using luck',
    usage: '.fortune @player'
  }),

  /* 22 */
  duelCommand({
    name: 'sps',
    alias: ['extremerps'],
    title: '🔥 EXTREME RPS',
    desc: 'Play an enhanced rock paper scissors',
    usage: '.sps @player'
  }),

  /* 23 */
  duelCommand({
    name: 'lucky',
    alias: ['luckynumber'],
    title: '🍀 LUCKY NUMBER',
    desc: 'Guess closest to the lucky number',
    usage: '.lucky @player'
  }),

  /* 24 */
  duelCommand({
    name: 'boxing',
    alias: ['box'],
    title: '🥊 BOXING DUEL',
    desc: 'Fight another player',
    usage: '.boxing @player'
  }),

  /* 25 */
  duelCommand({
    name: 'sword',
    alias: ['swordduel'],
    title: '⚔️ SWORD DUEL',
    desc: 'Fight using attack and defense',
    usage: '.sword @player'
  }),

  /* 26 */
  duelCommand({
    name: 'survival',
    alias: ['survivalduel'],
    title: '🏝️ SURVIVAL DUEL',
    desc: 'Survive longer than your opponent',
    usage: '.survival @player'
  }),

  /* 27 */
  duelCommand({
    name: 'treasure',
    alias: ['treasureduel'],
    title: '🏴‍☠️ TREASURE DUEL',
    desc: 'Find the hidden treasure',
    usage: '.treasure @player'
  }),

  /* 28 */
  duelCommand({
    name: 'space',
    alias: ['spacebattle'],
    title: '🚀 SPACE BATTLE',
    desc: 'Battle in space',
    usage: '.space @player'
  }),

  /* 29 */
  duelCommand({
    name: 'zombie',
    alias: ['zombieduel'],
    title: '🧟 ZOMBIE DUEL',
    desc: 'Survive the zombie attack',
    usage: '.zombie @player'
  }),

  /* 30 */
  duelCommand({
    name: 'arena',
    alias: ['battle', 'battlearena'],
    title: '⚔️ BATTLE ARENA',
    desc: 'Full battle with attack, defend and heal',
    usage: '.arena @player'
  })
]
