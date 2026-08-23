```js
/* ================================================================
 * TIC TAC TOE
 * ================================================================
 *
 * Modes:
 *   .ttt @player
 *      → sender vs tagged player
 *
 *   .ttt @player1 @player2
 *      → player1 vs player2
 *        sender only starts/hosts the game
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
  checkTTTWinner,
  isTTTDraw,
  extractNumber
} from '../utils.js'

/* ----------------------------------------------------------------
 * NUMBER BOARD
 * ---------------------------------------------------------------- */

const numberEmojis = [
  '1️⃣', '2️⃣', '3️⃣',
  '4️⃣', '5️⃣', '6️⃣',
  '7️⃣', '8️⃣', '9️⃣'
]

const symbolEmoji = {
  X: '❌',
  O: '⭕'
}

/**
 * Render the Tic Tac Toe board.
 *
 * Empty cells show their number.
 * Played cells show ❌ or ⭕.
 */
function renderBoard(board) {
  if (
    !Array.isArray(board) ||
    board.length !== 9
  ) {
    return ''
  }

  const cells = board.map(
    (cell, index) => {
      if (
        cell === 'X' ||
        cell === 'O'
      ) {
        return symbolEmoji[cell]
      }

      return numberEmojis[index]
    }
  )

  return [
    `${cells[0]} ${cells[1]} ${cells[2]}`,
    `${cells[3]} ${cells[4]} ${cells[5]}`,
    `${cells[6]} ${cells[7]} ${cells[8]}`
  ].join('\n')
}

/* ----------------------------------------------------------------
 * GAME DEFINITION
 * ---------------------------------------------------------------- */

const ttt = {
  name: 'ttt',

  alias: [
    'tictactoe'
  ],

  category: 'GAME',

  description:
    'Two-player Tic Tac Toe',

  usage:
    '.ttt @player',

  mode: 'duel',

  players: {
    min: 2,
    max: 2
  },

  inputMode: 'players',

  type: 'ttt',

  /* --------------------------------------------------------------
   * START
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

    const board =
      createTTTBoard()

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

      /*
       * The person who typed .ttt.
       * They may or may not be one of the players.
       */
      startedBy:
        m.sender,

      startedAt:
        Date.now()
    }

    const result =
      engine.startGame(
        m.chat,
        game
      )

    if (!result.ok) {
      return {
        error:
          result.error
      }
    }

    await m.reply({
      text:
        `🎮 *TIC TAC TOE*\n\n` +

        `❌ ${nameOf(p1)}\n` +
        `⭕ ${nameOf(p2)}\n\n` +

        `${renderBoard(board)}\n\n` +

        `🎯 ${nameOf(p1)} goes first.\n` +
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
     * Only the two actual players can make moves.
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
     * If it isn't this player's turn,
     * completely ignore the message.
     *
     * No "it's not your turn" response.
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
     * Only accept a valid single board number.
     *
     * Examples accepted:
     *
     * 1
     * 2
     * 9
     *
     * Everything else is ignored.
     */
    const position =
      extractNumber(text)

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
     * Ignore occupied positions.
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
          `🎮 *TIC TAC TOE — GAME OVER!*\n\n` +

          `${renderBoard(game.board)}\n\n` +

          `🏆 Winner: ${nameOf(winnerJid)}\n` +
          `${symbolEmoji[winner]} *${winner}* wins!`,
        
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
          `🎮 *TIC TAC TOE — DRAW!*\n\n` +

          `${renderBoard(game.board)}\n\n` +

          `🤝 Nobody wins this round.`
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
        `${renderBoard(game.board)}\n\n` +

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

  return `@${String(jid).split('@')[0]}`
}

/* ----------------------------------------------------------------
 * EXPORT
 * ---------------------------------------------------------------- */

export default ttt
```
