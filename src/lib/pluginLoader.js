import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import config from '../config.js'
import log from './logger.js'

/**
 * Plugin Loader
 *
 * Supports:
 *
 * 1. Command plugins
 *    export default {
 *      name: 'ping',
 *      async run() {}
 *    }
 *
 * 2. Message middleware
 *    export default {
 *      name: 'antilink',
 *      async before() {}
 *    }
 *
 * 3. Delete-event handlers
 *    export default {
 *      name: 'antidelete',
 *      async onDelete() {}
 *    }
 *
 * 4. Other event hooks can also be exported without
 *    being incorrectly treated as before() middleware.
 */

/* ============================================================
 * REGISTRIES
 * ============================================================ */

/** command name/alias -> plugin */
export const commands = new Map()

/**
 * Plugins that receive every normal message.
 *
 * IMPORTANT:
 * Only plugins with before() are placed here.
 */
export const middlewares = []

/**
 * Plugins that receive WhatsApp delete/revoke events.
 *
 * Anti-delete belongs here.
 */
export const deleteHandlers = []

/** category -> plugins */
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
      {
        withFileTypes: true
      }
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
  if (!plugin || typeof plugin !== 'object') {
    log.warn(
      `Skipped ${path.basename(file)} - invalid plugin export`
    )

    return false
  }

  /*
   * ----------------------------------------------------------
   * MESSAGE MIDDLEWARE
   * ----------------------------------------------------------
   *
   * Only plugins that actually have before() go here.
   */
  if (
    typeof plugin.before === 'function'
  ) {
    middlewares.push(plugin)
  }

  /*
   * ----------------------------------------------------------
   * DELETE HANDLER
   * ----------------------------------------------------------
   *
   * Anti-delete/snipe hooks go here.
   */
  if (
    typeof plugin.onDelete === 'function'
  ) {
    deleteHandlers.push(plugin)
  }

  /*
   * ----------------------------------------------------------
   * COMMAND PLUGIN
   * ----------------------------------------------------------
   */

  if (
    !plugin.name ||
    typeof plugin.run !== 'function'
  ) {
    /*
     * A plugin can legitimately be an event-only plugin.
     *
     * So don't complain if it has one of our supported hooks.
     */
    const isHookOnly =
      typeof plugin.before === 'function' ||
      typeof plugin.onDelete === 'function'

    if (!isHookOnly) {
      log.warn(
        `Skipped ${path.basename(file)} - missing "name" or "run"`
      )

      return false
    }

    /*
     * Event-only plugin successfully loaded.
     */
    plugin.file = file

    return true
  }

  /* ==========================================================
   * COMMAND METADATA
   * ========================================================== */

  plugin.file = file

  plugin.category =
    (
      plugin.category ||
      'MISC'
    ).toUpperCase()

  /*
   * Command name + aliases
   */
  const names = [
    plugin.name,
    ...(Array.isArray(plugin.alias)
      ? plugin.alias
      : [])
  ]
    .filter(Boolean)
    .map(
      (n) =>
        String(n).toLowerCase()
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
   * Category
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

/* ============================================================
 * LOAD PLUGINS
 * ============================================================ */

/**
 * Load every plugin from config.pluginDir.
 */
export async function loadPlugins() {
  commands.clear()

  middlewares.length = 0

  deleteHandlers.length = 0

  categories.clear()

  loadedCount = 0

  const files =
    walk(
      config.pluginDir
    )

  for (
    const file of files
  ) {
    try {
      /*
       * Cache buster allows plugin reloads.
       */
      const mod =
        await import(
          `${pathToFileURL(file).href}?t=${Date.now()}`
        )

      const plugin =
        mod.default || mod

      /*
       * Support:
       *
       * export default [...]
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
    } catch (e) {
      log.error(
        `Failed to load ${path.relative(
          config.pluginDir,
          file
        )}:`,
        e.message
      )
    }
  }

  /* ==========================================================
   * STABLE MENU ORDER
   * ========================================================== */

  for (
    const [, list] of categories
  ) {
    list.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name
        )
    )
  }

  log.ok(
    `Loaded ${loadedCount} plugins across ${categories.size} categories`
  )

  log.ok(
    `Message middleware: ${middlewares.length}`
  )

  log.ok(
    `Delete handlers: ${deleteHandlers.length}`
  )

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

/**
 * Resolve command name or alias.
 */
export const findCommand =
  (name) =>
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
