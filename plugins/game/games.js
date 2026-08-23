import {
  loadGames,
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

/* ============================================================
 * LOAD MODULAR GAMES
 * ============================================================ */

await loadGames()

console.log(
  `[GAME] Modular games ready: ${getGames().length} game(s)`
)

/* ============================================================
 * ENGINE API
 * ============================================================ */

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

/* ============================================================
 * TEXT HELPERS
 * ============================================================ */

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

/* ============================================================
 * PLAYER SELECTION
 * ============================================================ */

function selectPlayers(m, game) {
  const mentions = [
    ...new Set(
      Array.isArray(m?.mentions)
        ? m.mentions.filter(Boolean)
        : []
    )
  ]

  const sender = m.sender

  const min =
    Number(game.players?.min || 1)

  const max =
    Number(game.players?.max || min)

  /*
   * Single-player game.
   */
  if (
    min === 1 &&
    max === 1
  ) {
    return [sender]
  }

  /*
   * Exact two-player game.
   *
   * .ttt @user
   *
   * = sender vs tagged user
   */
  if (
    min === 2 &&
    max === 2
  ) {
    if (mentions.length === 1) {
      return [
        sender,
        mentions[0]
      ]
    }

    /*
     * Allow:
     *
     * .ttt @user1 @user2
     */
    if (mentions.length === 2) {
      return mentions
    }

    return null
  }

  /*
   * Multiplayer game.
   *
   * Starter + tagged players.
   */
  if (
    mentions.length === max - 1
  ) {
    return [
      sender,
      ...mentions
    ]
  }

  /*
   * Starter selects all players.
   */
  if (
    mentions.length === max
  ) {
    return mentions
  }

  return null
}

/* ============================================================
 * PLAYER ERROR
 * ============================================================ */

function playerError(game) {
  const min =
    Number(game.players?.min || 1)

  const max =
    Number(game.players?.max || min)

  if (
    min === 2 &&
    max === 2
  ) {
    return (
      '🎮 *Tic Tac Toe requires 2 players.*\n\n' +
      `Use *.${game.name} @player*\n\n` +
      'Example:\n' +
      `*.${game.name} @John*`
    )
  }

  if (
    min === max
  ) {
    return (
      `🎮 This game requires *${min} players*.\n\n` +
      `Tag ${min - 1} players if you want to participate.`
    )
  }

  return (
    `🎮 This game requires between *${min} and ${max} players*.`
  )
}

/* ============================================================
 * CREATE GAME COMMAND
 * ============================================================ */

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
       * Prevent two games in one group.
       */
      if (
        getActiveGame(m.chat)
      ) {
        return m.reply(
          '🎮 A game is already running in this group.\n\n' +
          'Use *.endgame* to stop it first.'
        )
      }

      /*
       * Every game must have start().
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

      const uniquePlayers = [
        ...new Set(players)
      ]

      const min =
        Number(game.players?.min || 1)

      const max =
        Number(game.players?.max || min)

      if (
        uniquePlayers.length < min ||
        uniquePlayers.length > max
      ) {
        return m.reply(
          playerError(game)
        )
      }

      /*
       * Start game.
       */
      try {
        const result =
          await game.start({
            m,
            args,
            players: uniquePlayers,
            engine
          })

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

/* ============================================================
 * END GAME COMMAND
 * ============================================================ */

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

/* ============================================================
 * GAME MESSAGE MIDDLEWARE
 * ============================================================ */

const gameMiddleware = {
  name: 'game-middleware',

  async before({ m }) {
    try {
      const game =
        getActiveGame(m.chat)

      if (!game) {
        return false
      }

      const text =
        getText(m)

      if (!text) {
        return false
      }

      /*
       * Commands are NEVER game moves.
       *
       * This allows:
       *
       * .endgame
       * .menu
       * .ping
       * etc.
       *
       * to continue normally.
       */
      if (
        text.startsWith('.')
      ) {
        return false
      }

      /*
       * Ignore people who aren't players
       * unless the game is group-wide.
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
       * IMPORTANT:
       *
       * The individual game decides whether
       * the message is actually valid.
       *
       * Invalid messages return false and are
       * ignored completely.
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

      return false
    }
  }
}

/* ============================================================
 * BUILD GAME PLUGINS
 * ============================================================ */

const gamePlugins =
  getGames().map(
    game =>
      createGamePlugin(game)
  )

console.log(
  `[GAME] Registered game commands: ${
    getGames()
      .map(game => game.name)
      .join(', ') || 'none'
  }`
)

/* ============================================================
 * EXPORT
 * ============================================================ */

export default [
  endGamePlugin,
  gameMiddleware,
  ...gamePlugins
]
