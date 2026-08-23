/* ================================================================
 * TIC TAC TOE
 * ================================================================
 *
 * Mode:
 *   duel
 *
 * Players:
 *   exactly 2
 *
 * Input:
 *   1 - 9
 *
 * The person who starts the game can:
 *   1. Play against a tagged person
 *   2. Play against a bot-selected opponent when supported
 *
 * ================================================================ */

import {
  createTTTBoard,
  renderTTT,
  checkTTTWinner,
  isTTTDraw,
  clean,
  extractNumber
} from '../utils.js'

/* ----------------------------------------------------------------
 * GAME DEFINITION
 * ---------------------------------------------------------------- */

const ttt = {
  name: 'ttt',

  alias: [
    'tictactoe'
  ],

  category: 'GAME',

  description: 'Two-player Tic Tac Toe',

  usage: '.ttt @player',

  mode: 'duel',

  players: {
    min: 2,
    max: 2
  },

  inputMode: 'players',

  type: 'ttt',

  /*
   * Start a new Tic Tac Toe game.
   */
  async start({
    m,
    players,
    engine
  }) {
    if (
      !Array.isArray(players) ||
      players.length !== 2
    ) {
      return {
        error:
          '🎮 Tic Tac Toe requires exactly 2 players.'
      }
    }

    const [p1, p2] = players

    const board = createTTTBoard()

    const game = {
      type: 'ttt',

      players: [
        p1,
        p2
      ],

      turn: p1,

      board,

      symbols: {
        [p1]: 'X',
        [p2]: 'O'
      },

      startedBy: m.sender,

      startedAt: Date.now()
    }

    const result = engine.startGame(
      m.chat,
      game
    )

    if (!result.ok) {
      return {
        error: result.error
      }
    }

    await m.reply({
      text:
        `🎮 *TIC TAC TOE*\n\n` +

        `❌ ${nameOf(p1)}\n` +
        `⭕ ${nameOf(p2)}\n\n` +

        `${renderTTT(board)}\n\n` +

        `🎯 ${nameOf(p1)} goes first.\n\n` +

        `Reply with a number from *1-9*.`,

      mentions: [
        p1,
        p2
      ]
    })

    return {
      ok: true,
      game
    }
  },

  /*
   * Process a player's move.
   */
  async process({
    m,
    game,
    text,
    engine
  }) {
    /*
     * Only players can interact.
     */
    if (
      !engine.playerInGame(
        game,
        m.sender
      )
    ) {
      return false
    }

    /*
     * Ignore messages from players who are not currently
     * supposed to make a move.
     *
     * IMPORTANT:
     *
     * We return false here so the message is ignored instead
     * of replying "it's not your turn".
     *
     * This prevents normal group conversation from being
     * hijacked by the game.
     */
    if (
      !engine.isTurn(
        game,
        m.sender
      )
    ) {
      return false
    }

    /*
     * Only accept a single valid board number.
     *
     * Anything else is ignored.
     */
    const position = extractNumber(text)

    if (
      position === null ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > 9
    ) {
      return false
    }

    const index = position - 1

    /*
     * Ignore an already occupied square.
     */
    if (
      game.board[index] !== ' '
    ) {
      await m.reply(
        '❌ That position is already occupied. Choose another number from *1-9*.'
      )

      return true
    }

    /*
     * Place the player's symbol.
     */
    const symbol =
      game.symbols[m.sender]

    if (!symbol) {
      return false
    }

    game.board[index] = symbol

    /*
     * Check winner.
     */
    const winner =
      checkTTTWinner(game.board)

    if (winner) {
      const winnerJid =
        Object.keys(game.symbols)
          .find(
            jid =>
              game.symbols[jid] === winner
          )

      await m.reply({
        text:
          `🎉 *TIC TAC TOE — GAME OVER!*\n\n` +

          `${renderTTT(game.board)}\n\n` +

          `🏆 Winner: ${nameOf(winnerJid)}\n` +
          `🎯 ${winner === 'X' ? '❌' : '⭕'} *${winner}* wins!`,

        mentions: [
          winnerJid
        ]
      })

      engine.endGame(m.chat)

      return true
    }

    /*
     * Check draw.
     */
    if (
      isTTTDraw(game.board)
    ) {
      await m.reply({
        text:
          `🤝 *TIC TAC TOE — DRAW!*\n\n` +
          `${renderTTT(game.board)}\n\n` +
          `Nobody wins this round.`
      })

      engine.endGame(m.chat)

      return true
    }

    /*
     * Move to the next player.
     */
    const next =
      engine.nextTurn(game)

    await m.reply({
      text:
        `${renderTTT(game.board)}\n\n` +

        `🎯 ${nameOf(next)}'s turn.\n` +

        `Reply with a number from *1-9*.`,
      mentions: [
        next
      ]
    })

    return true
  }
}

/* ----------------------------------------------------------------
 * NAME HELPER
 * ---------------------------------------------------------------- */

function nameOf(jid) {
  if (!jid) {
    return 'Player'
  }

  /*
   * Keep the actual JID available for WhatsApp mentions.
   * The display name will be handled by WhatsApp when mentioned.
   */
  return `@${String(jid).split('@')[0]}`
}

/* ----------------------------------------------------------------
 * EXPORT
 * ---------------------------------------------------------------- */

export default ttt
