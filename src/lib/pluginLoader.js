import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import config from '../config.js'
import log from './logger.js'

/**
 * Plugin Loader
 *
 * Loads every .js file under /plugins.
 *
 * A normal command plugin:
 *
 * export default {
 *   name: 'ping',
 *   alias: ['p'],
 *   category: 'BOT',
 *   desc: 'Check bot response time',
 *   usage: '.ping',
 *
 *   async run({ sock, m, args, text, command, plugins }) {
 *     ...
 *   }
 * }
 *
 * Plugins may also provide event hooks:
 *
 *   before()
 *   onDelete()
 *   onGroupUpdate()
 *
 * These hooks are registered in middlewares so the main
 * connection handler can call them.
 */

/* ============================================================
 * REGISTRIES
 * ============================================================ */

/**
 * command name / alias -> plugin
 */
export const commands = new Map()

/**
 * Plugins that have event hooks.
 *
 * Examples:
 * - before
 * - onDelete
 * - onGroupUpdate
 */
export const middlewares = []

/**
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
 * CHECK EVENT HOOKS
 * ============================================================ */

/**
 * Returns true when a plugin contains at least
 * one supported event hook.
 *
 * Anti-delete is important here because it uses:
 *
 *   onDelete()
 */
function hasEventHooks(plugin) {
  if (!plugin) {
    return false
  }

  return (
    typeof plugin.before === 'function' ||
    typeof plugin.onDelete === 'function' ||
    typeof plugin.onGroupUpdate === 'function' ||
    typeof plugin.onMessage === 'function' ||
    typeof plugin.onCall === 'function'
  )
}

/* ============================================================
 * REGISTER PLUGIN
 * ============================================================ */

function register(plugin, file) {
  if (!plugin) {
    log.warn(
      `Skipped ${path.basename(file)} - empty plugin`
    )

    return false
  }

  /*
   * ----------------------------------------------------------
   * EVENT HOOK ONLY PLUGIN
   * ----------------------------------------------------------
   *
   * A plugin can exist only to listen for events.
   *
   * Example:
   *
   * export default {
   *   onDelete() {}
   * }
   *
   * Such a plugin does not need name/run.
   */
  const eventPlugin =
    hasEventHooks(plugin)

  /*
   * ----------------------------------------------------------
   * NORMAL COMMAND VALIDATION
   * ----------------------------------------------------------
   */

  if (
    (!plugin.name ||
      typeof plugin.run !== 'function') &&
    !eventPlugin
  ) {
    log.warn(
      `Skipped ${path.basename(file)} - missing "name" or "run"`
    )

    return false
  }

  /*
   * ----------------------------------------------------------
   * REGISTER COMMAND
   * ----------------------------------------------------------
   */

  if (
    plugin.name &&
    typeof plugin.run === 'function'
  ) {
    plugin.file = file

    plugin.category =
      (
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
        (n) =>
          String(n).toLowerCase()
      )

    for (
      const n of names
    ) {
      if (commands.has(n)) {
        log.warn(
          `Duplicate command "${n}" in ${path.basename(file)} - overriding`
        )
      }

      commands.set(
        n,
        plugin
      )
    }

    /*
     * Add to menu categories only
     * for actual command plugins.
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
  }

  /*
   * ----------------------------------------------------------
   * REGISTER EVENT HOOK
   * ----------------------------------------------------------
   *
   * THIS IS THE IMPORTANT FIX.
   *
   * Previously only plugins with before()
   * were added to middlewares.
   *
   * Anti-delete has onDelete(), so it was
   * never being called.
   */
  if (eventPlugin) {
    if (
      !middlewares.includes(plugin)
    ) {
      middlewares.push(plugin)
    }

    log.info(
      `[PLUGIN] Event hooks registered: ${path.basename(file)}`
    )
  }

  return true
}

/* ============================================================
 * LOAD PLUGINS
 * ============================================================ */

/**
 * Load every plugin from disk.
 */
export async function loadPlugins() {
  /*
   * Clear previous registry.
   */
  commands.clear()

  middlewares.length = 0

  categories.clear()

  loadedCount = 0

  /*
   * Find every JS plugin.
   */
  const files =
    walk(
      config.pluginDir
    )

  log.info(
    `[PLUGIN] Scanning ${files.length} plugin files...`
  )

  /*
   * Load each plugin.
   */
  for (
    const file of files
  ) {
    try {
      /*
       * Cache buster.
       *
       * This ensures reloads actually read
       * the newest version of the file.
       */
      const mod =
        await import(
          `${pathToFileURL(file).href}?t=${Date.now()}`
        )

      const plugin =
        mod.default || mod

      /*
       * Support a file exporting multiple plugins.
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
        )}: ${e.message}`
      )
    }
  }

  /*
   * ----------------------------------------------------------
   * STABLE MENU ORDER
   * ----------------------------------------------------------
   */

  for (
    const [, list]
    of categories
  ) {
    list.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name
        )
    )
  }

  /*
   * ----------------------------------------------------------
   * DEBUG INFORMATION
   * ----------------------------------------------------------
   */

  log.ok(
    `Loaded ${loadedCount} plugins across ${categories.size} categories`
  )

  log.ok(
    `Registered ${middlewares.length} event middleware(s)`
  )

  /*
   * Specifically tell us whether anti-delete
   * has been registered.
   */
  const antiDeleteMiddleware =
    middlewares.find(
      (plugin) =>
        plugin?.name ===
        'antidelete'
    )

  if (
    antiDeleteMiddleware
  ) {
    log.ok(
      '[ANTI-DELETE] onDelete hook registered successfully'
    )
  }

  return {
    commands,
    categories,
    middlewares,
    count: loadedCount
  }
}

/* ============================================================
 * PLUGIN COUNT
 * ============================================================ */

export const pluginCount =
  () => loadedCount

/* ============================================================
 * FIND COMMAND
 * ============================================================ */

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
  findCommand,
  pluginCount
}
