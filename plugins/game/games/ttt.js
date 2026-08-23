```js
/* ================================================================
 * TIC TAC TOE
 * ================================================================ */

import {
  createTTTBoard,
  checkTTTWinner,
  isTTTDraw,
  extractNumber
} from '../utils.js'

/* ----------------------------------------------------------------
 * BOARD DISPLAY
 * ---------------------------------------------------------------- */

function renderBoard(board) {
  const numbers = [
    '1️⃣', '2️⃣', '3️⃣',
    '4️⃣', '5️⃣', '6️⃣',
    '7️⃣', '8️⃣', '9️⃣'
  ]

  const cells = board.map((cell, index) => {
    if (cell === 'X') return '❌'
    if (cell === 'O') return '⭕'

    return numbers[index]
  })

  return [
    `${cells[0]} ${cells[1]} ${cells[2]}`,
    `${cells[3]} ${cells[4]} ${cells[5]}`,
    `${cells[6]} ${cells[7]} ${cells[8]}`
  ].join('\n')
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

    if (!result || !result.ok) {
      return {
        error:
          result?.error ||
          '❌ Failed to start Tic Tac Toe.'
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
   * PROCESS PLAYER MOVE
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
     * Extract board position.
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
     * Prevent playing an occupied position.
     */
    if (
      game.board[index] !== ' '
    ) {
      await m.reply(
        '❌ That position is already occupied.\n\n' +
        'Choose another number from *1-9*.'
      )

      return true
    }

    /*
     * Get the player's symbol.
     */
    const symbol =
      game.symbols[m.sender]

    if (!symbol) {
      return false
    }

    /*
     * Place the move.
     */
    game.board[index] = symbol

    /* ------------------------------------------------------------
     * CHECK WINNER
     * ------------------------------------------------------------ */

    const winner =
      checkTTTWinner(game.board)

    if (winner) {
      const winnerJid =
        Object.keys(game.symbols).find(
          jid =>
            game.symbols[jid] === winner
        )

      await m.reply({
        text:
          `🎮 *TIC TAC TOE — GAME OVER!*\n\n` +
          `${renderBoard(game.board)}\n\n` +
          `🏆 Winner: ${nameOf(winnerJid)}\n` +
          `🎯 ${winner === 'X' ? '❌' : '⭕'} *WINS!*`,
        
        mentions: [
          winnerJid
        ]
      })

      engine.endGame(m.chat)

      return true
    }

    /* ------------------------------------------------------------
     * CHECK DRAW
     * ------------------------------------------------------------ */

    if (
      isTTTDraw(game.board)
    ) {
      await m.reply({
        text:
          `🤝 *TIC TAC TOE — DRAW!*\n\n` +
          `${renderBoard(game.board)}\n\n` +
          `Nobody wins this round.`
      })

      engine.endGame(m.chat)

      return true
    }

    /* ------------------------------------------------------------
     * NEXT TURN
     * ------------------------------------------------------------ */

    const next =
      engine.nextTurn(game)

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
 * EXPORT
 * ---------------------------------------------------------------- */

export default ttt
```
