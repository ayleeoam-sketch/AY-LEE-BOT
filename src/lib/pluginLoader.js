/* ================================================================
 * MODULAR GAME PLUGIN BRIDGE
 * ================================================================
 *
 * Individual games live in:
 *
 *   plugins/game/games/
 *
 * Adding a new game only requires adding a new .js file there.
 *
 * This file automatically:
 * - Loads all modular games
 * - Registers their commands
 * - Registers their aliases
 * - Routes active-game messages
 * - Provides .endgame
 * ================================================================ */

import {
  loadGames,
  getGame,
  getGames
} from './index.js'

import {
  getGame as getActiveGame,
  processGameMessage,
  endGame,
  playerInGame,
  getPlayers,
  addPlayer,
  removePlayer,
  isTurn,
  setTurn,
  nextTurn,
  startGame,
  setGame,
  deleteGame
} from './engine.js'

/* ----------------------------------------------------------------
 * LOAD ALL GAMES BEFORE PLUGIN REGISTRATION
 * ---------------------------------------------------------------- */

await loadGames()

console.log(
  `[GAME] Modular games ready: ${getGames().length} game(s)`
)

/* ----------------------------------------------------------------
 * ENGINE API
 * ---------------------------------------------------------------- */

const engine = {
  getGame: getActiveGame,
  setGame,
  deleteGame,
  startGame,
  endGame,

  playerInGame,
  getPlayers,
  addPlayer,
  removePlayer,

  isTurn,
  setTurn,
  nextTurn
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

function getArguments(m) {
  const text = getText(m)

  if (!text.startsWith('.')) {
    return []
  }

  const parts = text
    .slice(1)
    .trim()
    .split(/\s+/)

  parts.shift()

  return parts
}

/* ----------------------------------------------------------------
 * PLAYER SELECTION
 * ----------------------------------------------------------------
 *
 * For a 2-player game:
 *
 * .ttt @user
 * → sender vs tagged user
 *
 * .ttt @user1 @user2
 * → user1 vs user2
 *
 * This solves the WhatsApp self-tag problem.
 * ---------------------------------------------------------------- */

function selectPlayers(m, game) {
  const mentions = [
    ...new Set(
      Array.isArray(m?.mentions)
        ? m.mentions.filter(Boolean)
        : []
    )
  ]

  const sender = m.sender

  const minimum =
    Number(game.players?.min || 1)

  const maximum =
    Number(game.players?.max || 2)

  /*
   * Two-player game.
   *
   * One tag:
   * starter participates.
   */
  if (
    minimum === 2 &&
    maximum === 2
  ) {
    if (mentions.length === 1) {
      return [
        sender,
        mentions[0]
      ]
    }

    if (mentions.length === 2) {
      return mentions
    }

    return null
  }

  /*
   * General multiplayer game.
   *
   * If the number of tags is one less than required,
   * the sender automatically joins.
   *
   * Example:
   *
   * 3-player game:
   * .game @user1 @user2
   *
   * becomes:
   *
   * sender + user1 + user2
   */
  if (
    mentions.length === maximum - 1
  ) {
    return [
      sender,
      ...mentions
    ]
  }

  /*
   * Starter can also select all players.
   */
  if (
    mentions.length === maximum
  ) {
    return mentions
  }

  /*
   * Single-player game.
   */
  if (
    minimum === 1 &&
    maximum === 1 &&
    mentions.length === 0
  ) {
    return [
      sender
    ]
  }

  return null
}

/* ----------------------------------------------------------------
 * START ERROR
 * ---------------------------------------------------------------- */

function playerError(game) {
  const min =
    Number(game.players?.min || 1)

  const max =
    Number(game.players?.max || min)

  if (min === max) {
    if (min === 2) {
      return (
        '🎮 *Choose the players for the game.*\n\n' +
        'You can either:\n\n' +
        '1️⃣ *Play yourself:*\n' +
        `*.${game.name} @user*\n` +
        '→ You vs @user\n\n' +
        '2️⃣ *Let two other people play:*\n' +
        `*.${game.name} @user1 @user2*\n` +
        '→ @user1 vs @user2'
      )
    }

    return (
      `🎮 This game requires *${min} players*.\n\n` +
      `Tag ${min - 1} players if you want to participate, ` +
      `or tag all ${min} players if you are only starting it.`
    )
  }

  return (
    `🎮 This game requires between *${min} and ${max} players*.`
  )
}

/* ----------------------------------------------------------------
 * CREATE GAME COMMAND PLUGIN
 * ---------------------------------------------------------------- */

function createGamePlugin(game) {
  return {
    name: game.name,

    alias: Array.isArray(game.alias)
      ? game.alias
      : [],

    category:
      String(
        game.category || 'GAME'
      ).toUpperCase(),

    description:
      game.description ||
      game.desc ||
      'Game',

    usage:
      game.usage ||
      `.${game.name}`,

    group: true,

    async run({ m, args }) {
      /*
       * Don't start another game while one is active.
       */
      if (getActiveGame(m.chat)) {
        return m.reply(
          '🎮 A game is already running in this group.\n\n' +
          'Use *.endgame* to stop it first.'
        )
      }

      /*
       * Make sure the game actually has start().
       */
      if (
        typeof game.start !== 'function'
      ) {
        console.error(
          `[GAME] ${game.name} has no start() function.`
        )

        return m.reply(
          `❌ The game *${game.name}* is not configured correctly.`
        )
      }

      /*
       * Determine players.
       */
      const players =
        selectPlayers(
          m,
          game
        )

      if (!players) {
        return m.reply(
          playerError(game)
        )
      }

      /*
       * Remove duplicate players.
       */
      const uniquePlayers = [
        ...new Set(players)
      ]

      const minimum =
        Number(game.players?.min || 1)

      const maximum =
        Number(game.players?.max || minimum)

      if (
        uniquePlayers.length < minimum ||
        uniquePlayers.length > maximum
      ) {
        return m.reply(
          playerError(game)
        )
      }

      /*
       * Start the game.
       */
      try {
        const result =
          await game.start({
            m,
            args,
            players: uniquePlayers,
            engine
          })

        /*
         * Game can return an error instead of replying itself.
         */
        if (
          result &&
          result.error
        ) {
          return m.reply(
            result.error
          )
        }

        return result

      } catch (error) {
        console.error(
          `[GAME] Failed to start ${game.name}:`,
          error
        )

        return m.reply(
          '❌ Failed to start the game.'
        )
      }
    }
  }
}

/* ----------------------------------------------------------------
 * END GAME
 * ---------------------------------------------------------------- */

const endGamePlugin = {
  name: 'endgame',

  alias: [
    'stopgame'
  ],

  category: 'GAME',

  group: true,

  async run({ m }) {
    const game =
      getActiveGame(m.chat)

    if (!game) {
      return m.reply(
        '❌ There is no active game in this group.'
      )
    }

    const result =
      endGame(m.chat)

    if (!result.ok) {
      return m.reply(
        result.error
      )
    }

    return m.reply(
      '🛑 *GAME ENDED*\n\n' +
      'The active game has been stopped.'
    )
  }
}

/* ----------------------------------------------------------------
 * GLOBAL GAME MESSAGE MIDDLEWARE
 * ----------------------------------------------------------------
 *
 * Players send normal messages during a game.
 *
 * Examples:
 *
 * 9
 * rock
 * paper
 * g
 * abuja
 *
 * These are passed to the active game's process().
 *
 * IMPORTANT:
 *
 * Invalid/random group messages are ignored.
 * Commands beginning with "." are ignored here so that commands
 * such as .endgame continue through the normal command system.
 * ---------------------------------------------------------------- */

const gameMiddleware = {
  name: 'game-middleware',

  async before({ m }) {
    try {
      const game =
        getActiveGame(m.chat)

      /*
       * No active game.
       */
      if (!game) {
        return false
      }

      const text =
        getText(m)

      /*
       * Ignore empty messages.
       */
      if (!text) {
        return false
      }

      /*
       * NEVER treat bot commands as game moves.
       *
       * This is important for:
       *
       * .endgame
       * .menu
       * .help
       * etc.
       */
      if (
        text.startsWith('.')
      ) {
        return false
      }

      /*
       * Group-wide games can accept messages from anyone.
       *
       * Player-only games are restricted by engine.js.
       */
      if (
        game.inputMode !== 'group' &&
        !playerInGame(
          game,
          m.sender
        )
      ) {
        return false
      }

      /*
       * Route the message to the active game's processor.
       *
       * If the processor returns false, the message is simply
       * ignored and normal group conversation continues.
       */
      return await processGameMessage({
        m,
        text
      })

    } catch (error) {
      console.error(
        '[GAME] Middleware error:',
        error
      )

      /*
       * Never let one game message crash the bot.
       */
      return false
    }
  }
}

/* ----------------------------------------------------------------
 * BUILD PLUGIN LIST AUTOMATICALLY
 * ---------------------------------------------------------------- */

const gamePlugins =
  getGames()
    .map(
      game =>
        createGamePlugin(game)
    )

/* ----------------------------------------------------------------
 * FINAL EXPORT
 * ----------------------------------------------------------------
 *
 * The plugin loader already supports arrays.
 *
 * Therefore:
 *
 * - Every game gets its own command automatically.
 * - Every alias gets registered automatically.
 * - No index.js editing is needed.
 * - No engine.js editing is needed.
 * - No games.js editing is needed.
 * ---------------------------------------------------------------- */

export default [
  endGamePlugin,
  gameMiddleware,
  ...gamePlugins
]
