/* ================================================================
 * GAME SYSTEM INDEX
 * ================================================================
 *
 * Central entry point for the modular game system.
 *
 * Every individual game will eventually live in:
 *
 *   plugins/game/games/
 *
 * This file loads the game modules and exposes them to the
 * game engine.
 * ================================================================ */

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const gamesDir = path.join(__dirname, 'games')

/*
 * Loaded game modules.
 */
const gameRegistry = new Map()

/*
 * Load all JavaScript game files from ./games
 */
export async function loadGames() {
  gameRegistry.clear()

  /*
   * The games directory may not exist yet while we are migrating
   * the old games.js system.
   */
  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true })

    console.log('[GAME] Created games directory.')

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
      const filePath = path.join(gamesDir, file)

      /*
       * Cache-busting allows the loader to pick up updated game
       * files when the bot is restarted/reloaded.
       */
      const moduleUrl =
        `${pathToFileURL(filePath).href}?update=${Date.now()}`

      const imported = await import(moduleUrl)

      /*
       * Support:
       *
       * export default game
       *
       * and:
       *
       * export default [game1, game2]
       */
      const exported = imported.default

      const games = Array.isArray(exported)
        ? exported
        : [exported]

      for (const game of games) {
        if (!game || typeof game !== 'object') {
          console.warn(
            `[GAME] Skipping invalid game export: ${file}`
          )
          continue
        }

        if (!game.name) {
          console.warn(
            `[GAME] Game in ${file} has no name. Skipping.`
          )
          continue
        }

        const name = String(game.name).toLowerCase()

        if (gameRegistry.has(name)) {
          console.warn(
            `[GAME] Duplicate game "${name}" from ${file} - overriding`
          )
        }

        gameRegistry.set(name, game)

        /*
         * Register aliases.
         */
        if (Array.isArray(game.alias)) {
          for (const alias of game.alias) {
            if (!alias) continue

            const aliasName = String(alias).toLowerCase()

            gameRegistry.set(aliasName, game)
          }
        }
      }

      console.log(`[GAME] Loaded ${file}`)

    } catch (error) {
      console.error(
        `[GAME] Failed to load ${file}:`,
        error
      )
    }
  }

  console.log(
    `[GAME] ${gameRegistry.size} game entries registered.`
  )

  return gameRegistry
}

/*
 * Get a game by command/name/alias.
 */
export function getGame(name) {
  if (!name) return null

  return gameRegistry.get(
    String(name).toLowerCase()
  ) || null
}

/*
 * Get all registered games.
 *
 * Duplicate aliases are removed.
 */
export function getGames() {
  return [
    ...new Set(gameRegistry.values())
  ]
}

/*
 * Check whether a game exists.
 */
export function hasGame(name) {
  return Boolean(getGame(name))
}

/*
 * Register a game manually.
 *
 * Useful for future dynamic game loading.
 */
export function registerGame(game) {
  if (!game || typeof game !== 'object') {
    throw new TypeError(
      '[GAME] Invalid game module.'
    )
  }

  if (!game.name) {
    throw new Error(
      '[GAME] Game must have a name.'
    )
  }

  const name = String(game.name).toLowerCase()

  gameRegistry.set(name, game)

  if (Array.isArray(game.alias)) {
    for (const alias of game.alias) {
      if (!alias) continue

      gameRegistry.set(
        String(alias).toLowerCase(),
        game
      )
    }
  }

  return game
}

/*
 * Remove a game from the registry.
 */
export function unregisterGame(name) {
  const game = getGame(name)

  if (!game) return false

  /*
   * Remove the main name.
   */
  gameRegistry.delete(
    String(game.name).toLowerCase()
  )

  /*
   * Remove aliases.
   */
  if (Array.isArray(game.alias)) {
    for (const alias of game.alias) {
      gameRegistry.delete(
        String(alias).toLowerCase()
      )
    }
  }

  return true
}

/*
 * Export the registry itself for the engine.
 */
export { gameRegistry }

/*
 * Default export.
 */
export default {
  loadGames,
  getGame,
  getGames,
  hasGame,
  registerGame,
  unregisterGame,
  gameRegistry
}
