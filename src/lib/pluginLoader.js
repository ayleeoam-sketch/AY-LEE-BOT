import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import config from '../config.js'
import log from './logger.js'

/* ============================================================
 * PLUGIN REGISTRIES
 * ============================================================ */

/*
 * Command name/alias -> plugin
 */
export const commands = new Map()

/*
 * Plugins that have before()
 */
export const middlewares = []

/*
 * Plugins that have onDelete()
 */
export const deleteHandlers = []

/*
 * category -> plugins
 */
export const categories = new Map()

let loadedCount = 0

/* ============================================================
 * WALK PLUGIN DIRECTORY
 * ============================================================ */

/*
 * IMPORTANT:
 *
 * The game system is modular.
 *
 * plugins/game/
 *
 * contains:
 *
 *   games.js   -> normal plugin bridge
 *   index.js   -> game loader
 *   engine.js  -> game engine
 *   utils.js   -> game utilities
 *   games/     -> individual games
 *
 * Only games.js should be loaded by the normal plugin loader.
 *
 * The individual games are loaded by plugins/game/index.js.
 */

function walk(dir) {
  const out = []

  if (!fs.existsSync(dir)) {
    return out
  }

  for (
    const entry of fs.readdirSync(
      dir,
      { withFileTypes: true }
    )
  ) {
    const full = path.join(
      dir,
      entry.name
    )

    /*
     * Directories
     */
    if (entry.isDirectory()) {

      /*
       * NEVER let the normal plugin loader enter
       * plugins/game/games/
       *
       * Individual game files are handled by the
       * modular game loader.
       */
      if (
        path.basename(full) === 'games' &&
        path.basename(dir) === 'game'
      ) {
        continue
      }

      out.push(
        ...walk(full)
      )

      continue
    }

    /*
     * Only JavaScript files.
     */
    if (
      !entry.name.endsWith('.js')
    ) {
      continue
    }

    /*
     * Determine where this file is located relative
     * to the plugin directory.
     */
    const relative =
      path.relative(
        config.pluginDir,
        full
      )

    const parts =
      relative.split(path.sep)

    /*
     * ========================================================
     * MODULAR GAME SYSTEM
     * ========================================================
     *
     * plugins/game/
     */

    if (
      parts[0] === 'game'
    ) {

      /*
       * Only plugins/game/games.js is a real plugin.
       *
       * Do NOT load:
       *
       * game/index.js
       * game/engine.js
       * game/utils.js
       * game/games/*.js
       */
      if (
        parts.length === 2 &&
        entry.name === 'games.js'
      ) {
        out.push(full)
      }

      continue
    }

    /*
     * Everything else in plugins/ is a normal plugin.
     */
    out.push(full)
  }

  return out
}

/* ============================================================
 * REGISTER PLUGIN
 * ============================================================ */

function register(plugin, file) {
  if (
    !plugin ||
    typeof plugin !== 'object'
  ) {
    log.warn(
      `Skipped ${path.basename(file)} - invalid plugin export`
    )

    return false
  }

  /*
   * Store source file on plugin when possible.
   */
  try {
    if (
      Object.isExtensible(plugin)
    ) {
      plugin.file = file
    }
  } catch {
    /*
     * Non-extensible plugin.
     * Continue normally.
     */
  }

  /* ==========================================================
   * BEFORE MIDDLEWARE
   * ========================================================== */

  if (
    typeof plugin.before === 'function'
  ) {
    middlewares.push(plugin)
  }

  /* ==========================================================
   * DELETE HANDLER
   * ========================================================== */

  if (
    typeof plugin.onDelete === 'function'
  ) {
    deleteHandlers.push(plugin)

    log.info(
      `[PLUGIN] Delete handler registered: ${
        plugin.name ||
        path.basename(file)
      }`
    )
  }

  /* ==========================================================
   * COMMAND
   * ========================================================== */

  if (
    plugin.name &&
    typeof plugin.run === 'function'
  ) {
    plugin.category =
      String(
        plugin.category ||
        'MISC'
      ).toUpperCase()

    const names = [
      plugin.name,
      ...(Array.isArray(plugin.alias)
        ? plugin.alias
        : [])
    ]
      .filter(Boolean)
      .map(
        name =>
          String(name).toLowerCase()
      )

    for (
      const name of names
    ) {
      if (
        commands.has(name)
      ) {
        log.warn(
          `Duplicate command "${name}" in ${path.basename(file)} - overriding`
        )
      }

      commands.set(
        name,
        plugin
      )
    }

    /*
     * Add to category.
     */
    if (
      !categories.has(
        plugin.category
      )
    ) {
      categories.set(
        plugin.category,
        []
      )
    }

    categories
      .get(plugin.category)
      .push(plugin)

    return true
  }

  /* ==========================================================
   * EVENT-ONLY PLUGIN
   * ========================================================== */

  if (
    typeof plugin.before === 'function' ||
    typeof plugin.onDelete === 'function'
  ) {
    return true
  }

  /*
   * Anything that reaches here isn't a valid normal plugin.
   */
  log.warn(
    `Skipped ${path.basename(file)} - missing "name" or "run"`
  )

  return false
}

/* ============================================================
 * LOAD PLUGINS
 * ============================================================ */

export async function loadPlugins() {
  /*
   * Reset registries.
   */
  commands.clear()

  middlewares.length = 0

  deleteHandlers.length = 0

  categories.clear()

  loadedCount = 0

  /*
   * Get plugin files.
   *
   * IMPORTANT:
   *
   * walk() automatically excludes the internal modular
   * game files.
   */
  const files =
    walk(config.pluginDir)

  for (
    const file of files
  ) {
    try {
      /*
       * Cache-busting import.
       */
      const moduleUrl =
        `${pathToFileURL(file).href}?t=${Date.now()}`

      const mod =
        await import(moduleUrl)

      /*
       * Support:
       *
       * export default plugin
       *
       * and:
       *
       * export default [plugin1, plugin2]
       */
      const plugin =
        mod.default || mod

      /*
       * Multiple plugins from one file.
       */
      if (
        Array.isArray(plugin)
      ) {
        for (
          const p of plugin
        ) {
          if (
            register(
              p,
              file
            )
          ) {
            loadedCount++
          }
        }
      }

      /*
       * Single plugin.
       */
      else {
        if (
          register(
            plugin,
            file
          )
        ) {
          loadedCount++
        }
      }

    } catch (error) {
      log.error(
        `Failed to load ${path.relative(
          config.pluginDir,
          file
        )}: ${
          error?.stack ||
          error?.message ||
          error
        }`
      )
    }
  }

  /* ==========================================================
   * STABLE MENU ORDERING
   * ========================================================== */

  for (
    const [, list] of categories
  ) {
    list.sort(
      (a, b) =>
        String(a.name)
          .localeCompare(
            String(b.name)
          )
    )
  }

  /* ==========================================================
   * LOAD SUMMARY
   * ========================================================== */

  log.ok(
    `Loaded ${loadedCount} plugins across ${categories.size} categories`
  )

  log.ok(
    `Message middleware: ${middlewares.length}`
  )

  log.ok(
    `Delete handlers: ${deleteHandlers.length}`
  )

  if (
    deleteHandlers.length
  ) {
    log.ok(
      `Delete handlers loaded: ${
        deleteHandlers
          .map(
            plugin =>
              plugin.name ||
              'unnamed'
          )
          .join(', ')
      }`
    )
  } else {
    log.warn(
      'No delete handlers were registered.'
    )
  }

  return {
    commands,
    categories,
    middlewares,
    deleteHandlers,
    count: loadedCount
  }
}

/* ============================================================
 * HELPERS
 * ============================================================ */

export const pluginCount =
  () =>
    loadedCount

export const findCommand =
  name =>
    commands.get(
      String(
        name || ''
      ).toLowerCase()
    )

/* ============================================================
 * DEFAULT EXPORT
 * ============================================================ */

export default {
  loadPlugins,
  commands,
  categories,
  middlewares,
  deleteHandlers,
  findCommand,
  pluginCount
}
