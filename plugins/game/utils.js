/* ================================================================
 * GAME UTILITIES
 * ================================================================
 *
 * Shared helper functions used by individual games.
 * Keep game-specific logic inside the individual game files.
 * ================================================================ */

/* ----------------------------------------------------------------
 * TEXT
 * ---------------------------------------------------------------- */

export function clean(value) {
  if (value === undefined || value === null) {
    return ''
  }

  return String(value)
    .trim()
    .toLowerCase()
}

export function cleanRaw(value) {
  if (value === undefined || value === null) {
    return ''
  }

  return String(value).trim()
}

/* ----------------------------------------------------------------
 * RANDOM
 * ---------------------------------------------------------------- */

export function randomInt(min, max) {
  min = Math.ceil(Number(min))
  max = Math.floor(Number(max))

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 0
  }

  if (max < min) {
    ;[min, max] = [max, min]
  }

  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min
}

export function randomChoice(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return null
  }

  return array[
    Math.floor(Math.random() * array.length)
  ]
}

export function shuffle(array) {
  if (!Array.isArray(array)) {
    return []
  }

  const result = [...array]

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))

    ;[result[i], result[j]] = [
      result[j],
      result[i]
    ]
  }

  return result
}

/* ----------------------------------------------------------------
 * NUMBERS
 * ---------------------------------------------------------------- */

export function isNumber(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return false
  }

  return Number.isFinite(
    Number(value)
  )
}

export function toNumber(value, fallback = 0) {
  const number = Number(value)

  return Number.isFinite(number)
    ? number
    : fallback
}

export function clamp(value, min, max) {
  const number = toNumber(value, min)

  return Math.min(
    Math.max(number, min),
    max
  )
}

/* ----------------------------------------------------------------
 * INPUT
 * ---------------------------------------------------------------- */

/**
 * Extract the first integer from a message.
 *
 * Examples:
 *
 * "9"       -> 9
 * "choose 9" -> 9
 * "answer: 42" -> 42
 */
export function extractNumber(text) {
  if (text === undefined || text === null) {
    return null
  }

  const match = String(text).match(
    /-?\d+(?:\.\d+)?/
  )

  if (!match) {
    return null
  }

  const number = Number(match[0])

  return Number.isFinite(number)
    ? number
    : null
}

/**
 * Extract a single letter.
 *
 * Hangman-style input should normally be exactly one letter.
 */
export function extractLetter(text) {
  if (text === undefined || text === null) {
    return null
  }

  const value = String(text)
    .trim()
    .toLowerCase()

  if (!/^[a-z]$/.test(value)) {
    return null
  }

  return value
}

/**
 * Check whether text is exactly one character.
 */
export function isSingleCharacter(text) {
  if (text === undefined || text === null) {
    return false
  }

  return String(text).trim().length === 1
}

/* ----------------------------------------------------------------
 * LISTS
 * ---------------------------------------------------------------- */

export function unique(array) {
  if (!Array.isArray(array)) {
    return []
  }

  return [...new Set(array)]
}

export function removeItem(array, item) {
  if (!Array.isArray(array)) {
    return []
  }

  return array.filter(
    value => value !== item
  )
}

/* ----------------------------------------------------------------
 * TIC TAC TOE
 * ---------------------------------------------------------------- */

export function createTTTBoard() {
  return Array(9).fill(' ')
}

export function renderTTT(board) {
  if (!Array.isArray(board) || board.length !== 9) {
    return ''
  }

  const cell = value =>
    value === undefined ||
    value === null ||
    value === ''
      ? ' '
      : String(value)

  return [
    ` ${cell(board[0])} │ ${cell(board[1])} │ ${cell(board[2])} `,
    '───┼───┼───',
    ` ${cell(board[3])} │ ${cell(board[4])} │ ${cell(board[5])} `,
    '───┼───┼───',
    ` ${cell(board[6])} │ ${cell(board[7])} │ ${cell(board[8])} `
  ].join('\n')
}

export function checkTTTWinner(board) {
  if (!Array.isArray(board) || board.length !== 9) {
    return null
  }

  const wins = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],

    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],

    [0, 4, 8],
    [2, 4, 6]
  ]

  for (const [a, b, c] of wins) {
    if (
      board[a] !== ' ' &&
      board[a] === board[b] &&
      board[b] === board[c]
    ) {
      return board[a]
    }
  }

  return null
}

export function isTTTDraw(board) {
  if (!Array.isArray(board)) {
    return false
  }

  return (
    board.length === 9 &&
    board.every(
      cell => cell !== ' '
    ) &&
    !checkTTTWinner(board)
  )
}

/* ----------------------------------------------------------------
 * GAME PLAYERS
 * ---------------------------------------------------------------- */

export function normalizeJid(jid) {
  if (!jid) return ''

  return String(jid)
    .trim()
}

export function samePlayer(a, b) {
  return normalizeJid(a) === normalizeJid(b)
}

/* ----------------------------------------------------------------
 * GAME VALIDATION
 * ---------------------------------------------------------------- */

export function validPlayers(
  players,
  minimum = 1,
  maximum = Infinity
) {
  if (!Array.isArray(players)) {
    return false
  }

  const count = unique(players).length

  return (
    count >= minimum &&
    count <= maximum
  )
}

/* ----------------------------------------------------------------
 * TIME
 * ---------------------------------------------------------------- */

export function now() {
  return Date.now()
}

export function elapsed(startTime) {
  if (!startTime) {
    return 0
  }

  return Math.max(
    0,
    Date.now() - Number(startTime)
  )
}

/* ----------------------------------------------------------------
 * DELAY
 * ---------------------------------------------------------------- */

export function sleep(ms) {
  const delay = Number(ms)

  if (
    !Number.isFinite(delay) ||
    delay <= 0
  ) {
    return Promise.resolve()
  }

  return new Promise(resolve =>
    setTimeout(resolve, delay)
  )
}

/* ----------------------------------------------------------------
 * FORMATTING
 * ---------------------------------------------------------------- */

export function ordinal(number) {
  const n = Number(number)

  if (!Number.isFinite(n)) {
    return String(number)
  }

  const mod100 = n % 100

  if (
    mod100 >= 11 &&
    mod100 <= 13
  ) {
    return `${n}th`
  }

  switch (n % 10) {
    case 1:
      return `${n}st`

    case 2:
      return `${n}nd`

    case 3:
      return `${n}rd`

    default:
      return `${n}th`
  }
}

export function percent(value, total) {
  const v = Number(value)
  const t = Number(total)

  if (
    !Number.isFinite(v) ||
    !Number.isFinite(t) ||
    t === 0
  ) {
    return 0
  }

  return Math.round(
    (v / t) * 100
  )
}

/* ----------------------------------------------------------------
 * GAME INPUT MATCHING
 * ---------------------------------------------------------------- */

/**
 * Check whether a player's message matches one of the accepted
 * answers.
 */
export function matchesAnswer(
  text,
  answers
) {
  const input = clean(text)

  if (!input) {
    return false
  }

  if (Array.isArray(answers)) {
    return answers.some(
      answer =>
        clean(answer) === input
    )
  }

  return clean(answers) === input
}

/**
 * Check whether input is one of a list of valid choices.
 */
export function isChoice(
  text,
  choices
) {
  const input = clean(text)

  if (
    !input ||
    !Array.isArray(choices)
  ) {
    return false
  }

  return choices.some(
    choice =>
      clean(choice) === input
  )
}

/* ----------------------------------------------------------------
 * EXPORT DEFAULT
 * ---------------------------------------------------------------- */

export default {
  clean,
  cleanRaw,

  randomInt,
  randomChoice,
  shuffle,

  isNumber,
  toNumber,
  clamp,

  extractNumber,
  extractLetter,
  isSingleCharacter,

  unique,
  removeItem,

  createTTTBoard,
  renderTTT,
  checkTTTWinner,
  isTTTDraw,

  normalizeJid,
  samePlayer,
  validPlayers,

  now,
  elapsed,
  sleep,

  ordinal,
  percent,

  matchesAnswer,
  isChoice
}
