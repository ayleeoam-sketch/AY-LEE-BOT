/* ================================================================
 * TIC TAC TOE
 * ================================================================
 *
 * Command:
 *   .ttt @player1 @player2
 *
 * Examples:
 *
 *   .ttt @friend
 *   -> You vs friend
 *
 *   .ttt @player1 @player2
 *   -> player1 vs player2
 *
 * Players:
 *   exactly 2
 *
 * Input:
 *   1 - 9
 *
 * ================================================================ */

import {
  createTTTBoard,
  renderTTT,
  checkTTTWinner,
  isTTTDraw,
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

  /* --------------------------------------------------------------
   * START GAME
   * -------------------------------------------------------------- */

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

    if (
      !result ||
      !result.ok
    ) {
      return {
        error:
          result?.error ||
          '❌ Failed to start Tic Tac Toe.'
      }
    }

    await m.reply({
      text:
        '🎮 *TIC TAC TOE*\n\n' +

        `❌ ${nameOf(p1)}\n` +
        `⭕ ${nameOf(p2)}\n\n` +

        '1️⃣ 2️⃣ 3️⃣\n' +
        '4️⃣ 5️⃣ 6️⃣\n' +
        '7️⃣ 8️⃣ 9️⃣\n\n' +

        `🎯 ${nameOf(p1)} goes first.\n` +
        'Reply with a number from 1-9.',

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

  /* --------------------------------------------------------------
   * PROCESS MOVE
   * -------------------------------------------------------------- */

  async process({
    m,
    game,
    text,
    engine
  }) {
    /*
     * Only the two selected players can play.
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
     * Only the player whose turn it is can move.
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
     * Extract the board number.
     */
    const position =
      extractNumber(text)

    /*
     * Accept only 1-9.
     */
    if (
      position === null ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > 9
    ) {
      return false
    }

    const index =
      position - 1

    /*
     * Position already occupied.
     */
    if (
      game.board[index] !== ' '
    ) {
      await m.reply(
        '❌ That position is already occupied.\n' +
        'Choose another number from *1-9*.'
      )

      return true
    }

    /*
     * Get player's symbol.
     */
    const symbol =
      game.symbols[m.sender]

    if (!symbol) {
      return false
    }

    /*
     * Place symbol.
     */
    game.board[index] =
      symbol

    /*
     * Check winner.
     */
    const winner =
      checkTTTWinner(
        game.board
      )

    if (winner) {
      const winnerJid =
        Object.keys(
          game.symbols
        ).find(
          jid =>
            game.symbols[jid] === winner
        )

      await m.reply({
        text:
          '🎉 *TIC TAC TOE — GAME OVER!*\n\n' +

          renderBoard(game.board) +
          '\n\n' +

          `🏆 Winner: ${nameOf(winnerJid)}\n` +
          `🎯 ${symbolName(winner)} *${winner}* wins!`,

        mentions: [
          winnerJid
        ]
      })

      engine.endGame(
        m.chat
      )

      return true
    }

    /*
     * Check draw.
     */
    if (
      isTTTDraw(
        game.board
      )
    ) {
      await m.reply({
        text:
          '🤝 *TIC TAC TOE — DRAW!*\n\n' +

          renderBoard(game.board) +
          '\n\n' +

          'Nobody wins this round.'
      })

      engine.endGame(
        m.chat
      )

      return true
    }

    /*
     * Move to next player.
     */
    const next =
      engine.nextTurn(
        game
      )

    await m.reply({
      text:
        renderBoard(game.board) +
        '\n\n' +

        `🎯 ${nameOf(next)}'s turn.\n` +
        'Reply with a number from 1-9.',

      mentions: [
        next
      ]
    })

    return true
  }
}

/* ----------------------------------------------------------------
 * BOARD RENDERER
 * ----------------------------------------------------------------
 *
 * Empty squares are displayed as:
 *
 * 1️⃣ 2️⃣ 3️⃣
 * 4️⃣ 5️⃣ 6️⃣
 * 7️⃣ 8️⃣ 9️⃣
 *
 * Played squares display X / O.
 * ---------------------------------------------------------------- */

function renderBoard(board) {
  if (
    !Array.isArray(board) ||
    board.length !== 9
  ) {
    return (
      '1️⃣ 2️⃣ 3️⃣\n' +
      '4️⃣ 5️⃣ 6️⃣\n' +
      '7️⃣ 8️⃣ 9️⃣'
    )
  }

  const cells = board.map(
    (value, index) => {
      if (
        value === 'X'
      ) {
        return '❌'
      }

      if (
        value === 'O'
      ) {
        return '⭕'
      }

      return numberEmoji(
        index + 1
      )
    }
  )

  return (
    `${cells[0]} ${cells[1]} ${cells[2]}\n` +
    `${cells[3]} ${cells[4]} ${cells[5]}\n` +
    `${cells[6]} ${cells[7]} ${cells[8]}`
  )
}

/* ----------------------------------------------------------------
 * NUMBER EMOJI
 * ---------------------------------------------------------------- */

function numberEmoji(number) {
  const emojis = [
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

  return (
    emojis[number - 1] ||
    String(number)
  )
}

/* ----------------------------------------------------------------
 * SYMBOL NAME
 * ---------------------------------------------------------------- */

function symbolName(symbol) {
  if (
    symbol === 'X'
  ) {
    return '❌'
  }

  if (
    symbol === 'O'
  ) {
    return '⭕'
  }

  return symbol
}

/* ----------------------------------------------------------------
 * PLAYER NAME
 * ---------------------------------------------------------------- */

function nameOf(jid) {
  if (!jid) {
    return 'Player'
  }

  return `@${String(jid).split('@')[0]}`
}

/* ----------------------------------------------------------------
 * EXPORT
 * ---------------------------------------------------------------- */

export default ttt
