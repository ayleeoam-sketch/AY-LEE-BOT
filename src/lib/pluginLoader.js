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

    if (entry.isDirectory()) {
      out.push(
        ...walk(full)
      )
    } else if (
      entry.name.endsWith('.js')
    ) {
      out.push(full)
    }
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
   * Store the source file on the plugin when possible.
   */
  try {
    if (Object.isExtensible(plugin)) {
      plugin.file = file
    }
  } catch {
    // Ignore non-extensible plugins.
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
   * Clear old registries before loading.
   */
  commands.clear()

  middlewares.length = 0

  deleteHandlers.length = 0

  categories.clear()

  loadedCount = 0

  /*
   * Get every plugin file.
   */
  const files =
    walk(config.pluginDir)

  for (
    const file of files
  ) {
    try {
      /*
       * IMPORTANT:
       *
       * We only import the actual plugin file.
       *
       * There is NO import of:
       *
       * src/lib/index.js
       *
       * and NO dependency on a central index.js.
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
      } else {
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
