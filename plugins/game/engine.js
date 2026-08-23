/* ================================================================
 * GAME ENGINE
 * ================================================================
 *
 * Central controller for all modular games.
 *
 * Handles:
 * - Active games
 * - Starting/ending games
 * - Players
 * - Turns
 * - Game processors
 * - Message routing
 * - Ignoring irrelevant messages
 * ================================================================ */

const games = new Map()
const processors = new Map()

/* ----------------------------------------------------------------
 * GAME STORAGE
 * ---------------------------------------------------------------- */

export function getGame(chat) {
  return games.get(chat) || null
}

export function setGame(chat, game) {
  if (!chat || !game) return false

  games.set(chat, game)
  return true
}

export function deleteGame(chat) {
  return games.delete(chat)
}

export function hasGame(chat) {
  return games.has(chat)
}

/* ----------------------------------------------------------------
 * PROCESSOR REGISTRATION
 * ---------------------------------------------------------------- */

export function registerProcessor(type, processor) {
  if (!type || typeof processor !== 'function') {
    return false
  }

  processors.set(String(type).toLowerCase(), processor)

  return true
}

export function unregisterProcessor(type) {
  if (!type) return false

  return processors.delete(
    String(type).toLowerCase()
  )
}

export function getProcessor(type) {
  if (!type) return null

  return processors.get(
    String(type).toLowerCase()
  ) || null
}

/* ----------------------------------------------------------------
 * PLAYER HELPERS
 * ---------------------------------------------------------------- */

export function playerInGame(game, jid) {
  if (!game || !jid) return false

  return Array.isArray(game.players) &&
    game.players.includes(jid)
}

export function getPlayers(game) {
  if (!game) return []

  return Array.isArray(game.players)
    ? [...game.players]
    : []
}

export function addPlayer(game, jid) {
  if (!game || !jid) return false

  if (!Array.isArray(game.players)) {
    game.players = []
  }

  if (game.players.includes(jid)) {
    return false
  }

  game.players.push(jid)

  return true
}

export function removePlayer(game, jid) {
  if (!game || !Array.isArray(game.players)) {
    return false
  }

  const index = game.players.indexOf(jid)

  if (index === -1) {
    return false
  }

  game.players.splice(index, 1)

  return true
}

/* ----------------------------------------------------------------
 * TURN HELPERS
 * ---------------------------------------------------------------- */

export function isTurn(game, jid) {
  if (!game || !jid) return false

  /*
   * Games without turns can accept input from their players.
   */
  if (!game.turn) return true

  return game.turn === jid
}

export function setTurn(game, jid) {
  if (!game) return false

  game.turn = jid || null

  return true
}

export function nextTurn(game) {
  if (!game) return null

  const players = getPlayers(game)

  if (!players.length) {
    game.turn = null
    return null
  }

  if (!game.turn) {
    game.turn = players[0]
    return game.turn
  }

  const current = players.indexOf(game.turn)

  if (current === -1) {
    game.turn = players[0]
    return game.turn
  }

  game.turn =
    players[(current + 1) % players.length]

  return game.turn
}

/* ----------------------------------------------------------------
 * START / END
 * ---------------------------------------------------------------- */

export function startGame(chat, game) {
  if (!chat || !game) {
    return {
      ok: false,
      error: 'Invalid game.'
    }
  }

  if (games.has(chat)) {
    return {
      ok: false,
      error: '🎮 A game is already running in this group.'
    }
  }

  games.set(chat, game)

  return {
    ok: true,
    game
  }
}

export function endGame(chat) {
  const game = games.get(chat)

  if (!game) {
    return {
      ok: false,
      error: '❌ There is no active game.'
    }
  }

  games.delete(chat)

  return {
    ok: true,
    game
  }
}

/* ----------------------------------------------------------------
 * MESSAGE ROUTER
 * ----------------------------------------------------------------
 *
 * IMPORTANT:
 *
 * The engine does NOT automatically treat every message as a move.
 *
 * The individual game processor decides whether the message is
 * actually valid for that game.
 *
 * This is what prevents normal group conversation from triggering
 * things like "not your turn".
 * ---------------------------------------------------------------- */

export async function processGameMessage({
  m,
  text
}) {
  if (!m?.chat) {
    return false
  }

  const game = getGame(m.chat)

  if (!game) {
    return false
  }

  /*
   * Commands are never treated as game moves.
   *
   * This allows:
   *
   * .endgame
   * .menu
   * .help
   *
   * to continue through the normal command system.
   */
  if (
    typeof text === 'string' &&
    text.trim().startsWith('.')
  ) {
    return false
  }

  /*
   * Ignore people who are not players in a restricted game.
   *
   * Group-wide games can explicitly set:
   *
   * inputMode: 'group'
   *
   * and everyone will be allowed to interact.
   */
  if (
    game.inputMode !== 'group' &&
    !playerInGame(game, m.sender)
  ) {
    return false
  }

  /*
   * Find the processor for this particular game.
   */
  const processor = getProcessor(game.type)

  if (typeof processor !== 'function') {
    console.warn(
      `[GAME] No processor registered for "${game.type}"`
    )

    return false
  }

  try {
    /*
     * The processor gets the opportunity to decide whether this
     * message is actually a valid move.
     */
    const result = await processor({
      m,
      game,
      text,
      engine: {
        getGame,
        setGame,
        deleteGame,
        endGame,
        playerInGame,
        getPlayers,
        addPlayer,
        removePlayer,
        isTurn,
        setTurn,
        nextTurn
      }
    })

    /*
     * Only a processor that explicitly handles the message should
     * stop normal bot processing.
     */
    return result === true

  } catch (error) {
    console.error(
      `[GAME] Error processing "${game.type}":`,
      error
    )

    return false
  }
}

/* ----------------------------------------------------------------
 * REGISTER MULTIPLE PROCESSORS
 * ---------------------------------------------------------------- */

export function registerProcessors(entries) {
  if (!entries) return 0

  let count = 0

  if (entries instanceof Map) {
    for (const [type, processor] of entries) {
      if (registerProcessor(type, processor)) {
        count++
      }
    }

    return count
  }

  if (typeof entries === 'object') {
    for (const [type, processor] of Object.entries(entries)) {
      if (registerProcessor(type, processor)) {
        count++
      }
    }
  }

  return count
}

/* ----------------------------------------------------------------
 * CLEAR EVERYTHING
 * ---------------------------------------------------------------- */

export function clearGames() {
  games.clear()
}

export function clearProcessors() {
  processors.clear()
}

/* ----------------------------------------------------------------
 * DEBUG / STATUS
 * ---------------------------------------------------------------- */

export function getActiveGames() {
  return [...games.entries()]
}

export function getRegisteredProcessors() {
  return [...processors.keys()]
}

/* ----------------------------------------------------------------
 * DEFAULT EXPORT
 * ---------------------------------------------------------------- */

export default {
  getGame,
  setGame,
  deleteGame,
  hasGame,

  registerProcessor,
  unregisterProcessor,
  getProcessor,
  registerProcessors,

  playerInGame,
  getPlayers,
  addPlayer,
  removePlayer,

  isTurn,
  setTurn,
  nextTurn,

  startGame,
  endGame,

  processGameMessage,

  clearGames,
  clearProcessors,

  getActiveGames,
  getRegisteredProcessors
}
