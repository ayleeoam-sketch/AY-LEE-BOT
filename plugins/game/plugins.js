/* ================================================================
 * MODULAR GAME PLUGIN BRIDGE
 * ================================================================
 *
 * This is the only bridge between the modular game system and the
 * bot's plugin loader.
 *
 * Individual games live in:
 *
 *   plugins/game/games/
 *
 * Adding a new game does NOT require editing this file.
 * ================================================================ */

import {
  loadGames,
  getGame,
  getGames
} from './index.js'

import {
  getGame as getActiveGame,
  processGameMessage,
  startGame,
  endGame,
  playerInGame
} from './engine.js'

let loaded = false

/* ----------------------------------------------------------------
 * LOAD MODULAR GAMES
 * ---------------------------------------------------------------- */

async function ensureGamesLoaded() {
  if (loaded) {
    return
  }

  await loadGames()

  loaded = true

  console.log(
    `[GAME] Modular system ready: ${getGames().length} game(s)`
  )
}

/* ----------------------------------------------------------------
 * TEXT
 * ---------------------------------------------------------------- */

function getText(m) {
  if (!m) return ''

  if (typeof m.body === 'string') {
    return m.body.trim()
  }

  if (typeof m.text === 'string') {
    return m.text.trim()
  }

  return ''
}

/* ----------------------------------------------------------------
 * COMMAND ARGUMENTS
 * ---------------------------------------------------------------- */

function getCommandName(m) {
  if (!m) return ''

  const body = getText(m)

  if (!body.startsWith('.')) {
    return ''
  }

  const parts = body
    .slice(1)
    .trim()
    .split(/\s+/)

  return (
    parts[0] || ''
  ).toLowerCase()
}

function getArguments(m) {
  const body = getText(m)

  if (!body.startsWith('.')) {
    return []
  }

  const parts = body
    .slice(1)
    .trim()
    .split(/\s+/)

  parts.shift()

  return parts
}

/* ----------------------------------------------------------------
 * MENTIONS
 * ---------------------------------------------------------------- */

function getMentions(m) {
  if (!m) return []

  if (Array.isArray(m.mentions)) {
    return [
      ...new Set(
        m.mentions.filter(Boolean)
      )
    ]
  }

  return []
}

/* ----------------------------------------------------------------
 * START GAME
 * ---------------------------------------------------------------- */

async function startModularGame({
  m,
  game,
  args
}) {
  if (!game) {
    return {
      handled: false
    }
  }

  if (getActiveGame(m.chat)) {
    return {
      handled: true,
      error:
        '🎮 A game is already running in this group.\n\n' +
        'Use *.endgame* to stop it first.'
    }
  }

  /*
   * The starter is automatically a player when they tag
   * exactly one opponent.
   *
   * Example:
   *
   * .ttt @user
   *
   * becomes:
   *
   * starter vs tagged user
   *
   * If two users are tagged:
   *
   * .ttt @user1 @user2
   *
   * those two users play each other.
   */

  const mentions = getMentions(m)

  let players = []

  if (mentions.length === 1) {
    players = [
      m.sender,
      mentions[0]
    ]
  } else if (mentions.length === 2) {
    players = [
      mentions[0],
      mentions[1]
    ]
  } else if (
    mentions.length === 0 &&
    game.players?.min === 1
  ) {
    players = [
      m.sender
    ]
  } else {
    const required =
      game.players?.min === game.players?.max
        ? `exactly ${game.players.min}`
        : `${game.players?.min || 1}-${game.players?.max || 2}`

    return {
      handled: true,
      error:
        `🎮 Tag ${required} player(s).\n\n` +
        `Example:\n*.${game.name} @user*`
    }
  }

  /*
   * Remove duplicates.
   */
  players = [
    ...new Set(players)
  ]

  /*
   * Validate player count.
   */
  const minimum =
    Number(game.players?.min || 1)

  const maximum =
    Number(game.players?.max || Infinity)

  if (
    players.length < minimum ||
    players.length > maximum
  ) {
    return {
      handled: true,
      error:
        `❌ This game requires ${minimum === maximum
          ? minimum
          : `${minimum}-${maximum}`} player(s).`
    }
  }

  /*
   * Start the actual game.
   */
  if (typeof game.start !== 'function') {
    return {
      handled: true,
      error:
        `❌ Game "${game.name}" has no start() function.`
    }
  }

  try {
    const result =
      await game.start({
        m,
        args,
        players,
        engine: {
          getGame: getActiveGame,
          startGame,
          endGame,
          playerInGame
        }
      })

    if (
      result &&
      result.error
    ) {
      return {
        handled: true,
        error: result.error
      }
    }

    return {
      handled: true,
      result
    }

  } catch (error) {
    console.error(
      `[GAME] Failed to start ${game.name}:`,
      error
    )

    return {
      handled: true,
      error:
        '❌ Failed to start the game.'
    }
  }
}

/* ----------------------------------------------------------------
 * END GAME
 * ---------------------------------------------------------------- */

async function handleEndGame(m) {
  const game = getActiveGame(m.chat)

  if (!game) {
    return {
      handled: true,
      error:
        '❌ There is no active game in this group.'
    }
  }

  const result =
    endGame(m.chat)

  if (!result.ok) {
    return {
      handled: true,
      error: result.error
    }
  }

  return {
    handled: true,
    message:
      '🛑 *GAME ENDED*\n\n' +
      'The active game has been stopped.'
  }
}

/* ----------------------------------------------------------------
 * GLOBAL BEFORE HANDLER
 * ----------------------------------------------------------------
 *
 * This receives normal messages while a modular game is active.
 *
 * IMPORTANT:
 *
 * Invalid/random group messages are ignored.
 *
 * Commands such as .endgame are NOT passed to the game processor.
 * ---------------------------------------------------------------- */

export async function before({ m }) {
  try {
    await ensureGamesLoaded()

    const game = getActiveGame(m.chat)

    if (!game) {
      return false
    }

    const text = getText(m)

    if (!text) {
      return false
    }

    /*
     * Commands must continue through the normal command system.
     */
    if (text.startsWith('.')) {
      return false
    }

    /*
     * Route the message to the active game's processor.
     *
     * processGameMessage() already handles:
     *
     * - player restrictions
     * - turns
     * - irrelevant messages
     * - missing processors
     * - errors
     */
    return await processGameMessage({
      m,
      text
    })

  } catch (error) {
    console.error(
      '[GAME] Modular middleware error:',
      error
    )

    return false
  }
}

/* ----------------------------------------------------------------
 * COMMAND HANDLER
 * ---------------------------------------------------------------- */

export async function command({
  m
}) {
  try {
    await ensureGamesLoaded()

    const commandName =
      getCommandName(m)

    if (!commandName) {
      return false
    }

    /*
     * .endgame
     */
    if (
      commandName === 'endgame'
    ) {
      const result =
        await handleEndGame(m)

      if (result.error) {
        await m.reply(result.error)
      } else if (result.message) {
        await m.reply(result.message)
      }

      return true
    }

    /*
     * Find modular game.
     */
    const game =
      getGame(commandName)

    if (!game) {
      return false
    }

    /*
     * Don't allow another game to start while one is active.
     */
    if (getActiveGame(m.chat)) {
      await m.reply(
        '🎮 A game is already running in this group.\n\n' +
        'Use *.endgame* to stop it first.'
      )

      return true
    }

    const args =
      getArguments(m)

    const result =
      await startModularGame({
        m,
        game,
        args
      })

    if (result.error) {
      await m.reply(result.error)
    }

    return true

  } catch (error) {
    console.error(
      '[GAME] Modular command error:',
      error
    )

    return false
  }
}

/* ----------------------------------------------------------------
 * PLUGIN EXPORT
 * ---------------------------------------------------------------- */

export default {
  name: 'modular-games',

  before,

  command
}
