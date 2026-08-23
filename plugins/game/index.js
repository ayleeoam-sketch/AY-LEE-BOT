/* ================================================================
 * MODULAR GAME LOADER
 * ================================================================ */

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import {
  registerProcessor
} from './engine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const gamesDir = path.join(__dirname, 'games')

const gameRegistry = new Map()

/* ----------------------------------------------------------------
 * REGISTER GAME
 * ---------------------------------------------------------------- */

function registerGame(game) {
  if (!game || typeof game !== 'object') {
    return false
  }

  if (!game.name) {
    console.warn('[GAME] Game has no name. Skipping.')
    return false
  }

  const name = String(game.name).toLowerCase()

  gameRegistry.set(name, game)

  /*
   * Register the game's message processor with the engine.
   */
  if (typeof game.process === 'function') {
    registerProcessor(name, game.process)
  } else {
    console.warn(
      `[GAME] ${name} has no process() function.`
    )
  }

  /*
   * Register aliases.
   */
  if (Array.isArray(game.alias)) {
    for (const alias of game.alias) {
      if (!alias) continue

      const aliasName =
        String(alias).toLowerCase()

      gameRegistry.set(aliasName, game)
    }
  }

  return true
}

/* ----------------------------------------------------------------
 * LOAD ALL GAMES
 * ---------------------------------------------------------------- */

export async function loadGames() {
  gameRegistry.clear()

  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, {
      recursive: true
    })

    console.log(
      '[GAME] Created games directory.'
    )

    return gameRegistry
  }

  const files = fs
    .readdirSync(gamesDir)
    .filter(file =>
      file.endsWith('.js') &&
      !file.startsWith('_')
    )

  for (const file of files) {
    try {
      const filePath =
        path.join(gamesDir, file)

      const moduleUrl =
        `${pathToFileURL(filePath).href}?update=${Date.now()}`

      const imported =
        await import(moduleUrl)

      const exported =
        imported.default

      const games =
        Array.isArray(exported)
          ? exported
          : [exported]

      for (const game of games) {
        if (registerGame(game)) {
          console.log(
            `[GAME] Loaded ${file}: ${game.name}`
          )
        }
      }

    } catch (error) {
      console.error(
        `[GAME] Failed to load ${file}:`,
        error
      )
    }
  }

  console.log(
    `[GAME] ${getGames().length} modular game(s) loaded.`
  )

  return gameRegistry
}

/* ----------------------------------------------------------------
 * GET GAME
 * ---------------------------------------------------------------- */

export function getGame(name) {
  if (!name) {
    return null
  }

  return gameRegistry.get(
    String(name).toLowerCase()
  ) || null
}

/* ----------------------------------------------------------------
 * GET ALL GAMES
 * ---------------------------------------------------------------- */

export function getGames() {
  return [
    ...new Set(
      gameRegistry.values()
    )
  ]
}

/* ----------------------------------------------------------------
 * HAS GAME
 * ---------------------------------------------------------------- */

export function hasGame(name) {
  return Boolean(
    getGame(name)
  )
}

/* ----------------------------------------------------------------
 * UNREGISTER GAME
 * ---------------------------------------------------------------- */

export function unregisterGame(name) {
  const game = getGame(name)

  if (!game) {
    return false
  }

  gameRegistry.delete(
    String(game.name).toLowerCase()
  )

  if (Array.isArray(game.alias)) {
    for (const alias of game.alias) {
      gameRegistry.delete(
        String(alias).toLowerCase()
      )
    }
  }

  return true
}

/* ----------------------------------------------------------------
 * EXPORT
 * ---------------------------------------------------------------- */

export {
  gameRegistry
}

export default {
  loadGames,
  getGame,
  getGames,
  hasGame,
  registerGame,
  unregisterGame,
  gameRegistry
}
