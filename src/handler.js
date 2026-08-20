import config, { prefixes } from './config.js'
import log from './lib/logger.js'
import DB from './lib/database.js'
import { getVar } from './lib/vars.js'
import { serialize, resolvePermissions } from './lib/serialize.js'
import {
  commands,
  middlewares,
  findCommand,
  pluginCount
} from './lib/pluginLoader.js'
import {
  resolveRole,
  canRunOwnerCommand,
  atLeast,
  cooldownFor,
  invalidateRoles,
  ROLES
} from './lib/roles.js'

/* ---------------------------- caches ---------------------------- */

const cooldowns = new Map()
let sudoCache = { at: 0, list: [] }
let bannedCache = { at: 0, list: [] }

const commandCleanupKeys = new Map()

const cleanupKey = (
  key,
  fallbackChat = ''
) =>
  `${key?.remoteJid || fallbackChat}:${key?.id || ''}`

function markCommandCleanup(
  key,
  chat
) {
  const now = Date.now()

  commandCleanupKeys.set(
    cleanupKey(key, chat),
    now + 120_000
  )

  if (commandCleanupKeys.size > 500) {
    for (const [id, expires] of commandCleanupKeys) {
      if (expires <= now) {
        commandCleanupKeys.delete(id)
      }
    }
  }
}

function forgetCommandCleanup(
  key,
  chat
) {
  commandCleanupKeys.delete(
    cleanupKey(key, chat)
  )
}

export function isCommandCleanup(key) {
  const id = cleanupKey(key)
  const expires =
    commandCleanupKeys.get(id) || 0

  if (expires > Date.now()) {
    return true
  }

  if (expires) {
    commandCleanupKeys.delete(id)
  }

  return false
}

async function removeForCommandCleanup(
  sock,
  chat,
  key
) {
  if (!key?.id) return

  markCommandCleanup(key, chat)

  try {
    await sock.sendMessage(chat, {
      delete: key
    })
  } catch {
    forgetCommandCleanup(key, chat)
  }
}

async function cleanupCommandMessages(
  sock,
  m
) {
  const seen = new Set()

  for (const key of [
    ...(m.commandResponses || []),
    m.key
  ]) {
    const id = cleanupKey(key, m.chat)

    if (!key?.id || seen.has(id)) {
      continue
    }

    seen.add(id)

    await removeForCommandCleanup(
      sock,
      m.chat,
      key
    )
  }
}

/*
 * Track direct sock.sendMessage replies.
 */
function socketForCommand(
  sock,
  m
) {
  const sendMessage = async (
    jid,
    content,
    options
  ) => {
    const sent =
      await sock.sendMessage(
        jid,
        content,
        options
      )

    const protocolOnly =
      content?.delete ||
      content?.react

    if (
      !protocolOnly &&
      jid === m.chat &&
      sent?.key?.id
    ) {
      m.commandResponses.push(
        sent.key
      )
    }

    return sent
  }

  return new Proxy(sock, {
    get(target, property) {
      if (
        property === 'sendMessage'
      ) {
        return sendMessage
      }

      const value = Reflect.get(
        target,
        property,
        target
      )

      return typeof value === 'function'
        ? value.bind(target)
        : value
    }
  })
}

/* ----------------------------- database ----------------------------- */

async function getSudo() {
  if (
    Date.now() - sudoCache.at <
    30_000
  ) {
    return sudoCache.list
  }

  const rows =
    await DB.sudo.all()

  sudoCache = {
    at: Date.now(),
    list: rows.map(
      (r) => r.number
    )
  }

  return sudoCache.list
}

async function getBanned() {
  if (
    Date.now() - bannedCache.at <
    30_000
  ) {
    return bannedCache.list
  }

  const rows =
    await DB.banned.all()

  bannedCache = {
    at: Date.now(),
    list: rows.map(
      (r) => r.id
    )
  }

  return bannedCache.list
}

export const invalidateCaches = () => {
  sudoCache.at = 0
  bannedCache.at = 0
  invalidateRoles()
}

/* --------------------------- prefix parse --------------------------- */

function parse(body) {
  const list = prefixes()

  for (const p of list) {
    if (p === '') {
      const parts =
        body.trim().split(/\s+/)

      const cmd =
        parts.shift() || ''

      return {
        prefix: '',
        command:
          cmd.toLowerCase(),
        args: parts
      }
    }

    if (body.startsWith(p)) {
      const withoutPrefix =
        body.slice(p.length).trim()

      if (!withoutPrefix) {
        return null
      }

      const parts =
        withoutPrefix.split(/\s+/)

      const cmd =
        parts.shift() || ''

      return {
        prefix: p,
        command:
          cmd.toLowerCase(),
        args: parts
      }
    }
  }

  return null
}

/* ----------------------------- handler ----------------------------- */

export async function handleMessage(
  sock,
  raw,
  ctx = {}
) {
  let cleanupMessage = null

  try {
    const m =
      await serialize(sock, raw)

    if (!m) return

    /*
     * STATUS
     */
    if (m.isStatus) {
      for (const mw of middlewares) {
        if (
          typeof mw.onStatus ===
          'function'
        ) {
          await mw
            .onStatus({
              sock,
              m
            })
            .catch((e) =>
              log.error(
                'onStatus failed:',
                e.message
              )
            )
        }
      }

      return
    }

    /*
     * Resolve permissions BEFORE middleware.
     *
     * IMPORTANT:
     * Do NOT return here when !m.isOwner.
     *
     * Moderation middleware such as:
     * - antilink
     * - antidelete
     * - AFK
     * - anti-spam
     * - chatbot
     *
     * must still work for normal members.
     */
    await resolvePermissions(
      sock,
      m,
      await getSudo()
    )

    await resolveRole(m)

    /* -------------------------- hard bans -------------------------- */

    const banned =
      await getBanned()

    if (
      !m.isOwner &&
      (
        banned.includes(m.sender) ||
        banned.includes(m.chat)
      )
    ) {
      return
    }

    /* -------------------------- presence -------------------------- */

    if (
      getVar('AUTO_READ')
    ) {
      await sock
        .readMessages([m.key])
        .catch(() => {})
    }

    if (
      getVar('ALWAYS_ONLINE')
    ) {
      sock
        .sendPresenceUpdate(
          'available'
        )
        .catch(() => {})
    }

    /*
     * ============================================================
     * MIDDLEWARE
     * ============================================================
     *
     * EVERYONE reaches this section.
     *
     * This is what allows antilink to delete links sent by
     * ordinary group members.
     */
    for (const mw of middlewares) {
      try {
        const stop =
          await mw.before({
            sock,
            m,
            config,
            DB,
            getVar,
            commands,
            categories: null
          })

        if (stop === true) {
          return
        }
      } catch (e) {
        log.error(
          `Middleware ${
            mw.name || mw.file
          } failed:`,
          e.message
        )
      }
    }

    /*
     * From here downward is COMMAND processing.
     */

    if (!m.body) {
      return
    }

    const parsed =
      parse(m.body)

    if (!parsed) {
      return
    }

    const {
      prefix,
      command,
      args
    } = parsed

    if (!command) {
      return
    }

    const plugin =
      findCommand(command)

    if (!plugin) {
      return
    }

    /*
     * ============================================================
     * OWNER-ONLY COMMANDS
     * ============================================================
     *
     * This is deliberately AFTER middleware.
     *
     * Therefore:
     *
     * Normal member:
     *   antilink works
     *   command ignored
     *
     * Bot owner:
     *   antilink works
     *   command works
     */
    if (!m.isOwner) {
      return
    }

    cleanupMessage = m

    const text =
      args.join(' ')

    /* --------------------- command access --------------------- */

    const mode =
      getVar('MODE')

    const privileged =
      m.isSudo ||
      atLeast(
        m.role,
        'vip'
      )

    if (
      mode === 'private' &&
      !privileged
    ) {
      return
    }

    if (
      mode === 'group' &&
      !m.isGroup &&
      !privileged
    ) {
      return
    }

    if (
      mode === 'inbox' &&
      m.isGroup &&
      !privileged
    ) {
      return
    }

    /*
     * Refusal helper.
     */
    const deny = async (
      why
    ) => {
      if (
        getVar('CMD_REACT')
      ) {
        await m
          .react('🚫')
          .catch(() => {})
      }

      return m.reply(why)
    }

    /*
     * Existing role restrictions.
     */
    if (
      plugin.owner &&
      !m.isSudo &&
      !canRunOwnerCommand(
        m.role,
        plugin.name
      )
    ) {
      return deny(
        m.roleLevel > 0
          ? `🚫 *${plugin.name}* is above your ${ROLES[m.role].emoji} ${ROLES[m.role].label} role.`
          : '🚫 This command is for the owner only.'
      )
    }

    if (
      plugin.group &&
      !m.isGroup
    ) {
      return deny(
        '🚫 This command only works in groups.'
      )
    }

    if (
      plugin.private &&
      m.isGroup
    ) {
      return deny(
        '🚫 This command only works in DM.'
      )
    }

    if (
      plugin.admin &&
      m.isGroup &&
      !m.isAdmin &&
      !m.isSudo &&
      !atLeast(
        m.role,
        'mod'
      )
    ) {
      return deny(
        '🚫 You need to be a group admin to use this.'
      )
    }

    if (
      plugin.botAdmin &&
      m.isGroup &&
      !m.isBotAdmin
    ) {
      return deny(
        '🚫 I need to be a group admin to do that.'
      )
    }

    /* ------------------------ cooldown ------------------------ */

    const wait =
      plugin.cooldown
        ? cooldownFor(
            plugin.cooldown,
            m.role
          )
        : 0

    if (
      wait &&
      !m.isSudo
    ) {
      const key =
        `${plugin.name}:${m.sender}`

      const until =
        cooldowns.get(key) || 0

      if (
        Date.now() < until
      ) {
        const left =
          Math.ceil(
            (until - Date.now()) /
            1000
          )

        if (
          getVar('CMD_REACT')
        ) {
          await m
            .react('⏳')
            .catch(() => {})
        }

        return m.reply(
          `⏳ Slow down - wait ${left}s before using *${plugin.name}* again.`
        )
      }

      cooldowns.set(
        key,
        Date.now() +
          wait * 1000
      )
    }

    /* -------------------------- run --------------------------- */

    log.cmd(
      `${prefix}${command}`,
      `| ${m.pushName} (${m.senderNumber})`,
      m.isGroup
        ? `| ${m.groupName}`
        : '| DM'
    )

    if (
      getVar('AUTO_TYPING')
    ) {
      sock
        .sendPresenceUpdate(
          'composing',
          m.chat
        )
        .catch(() => {})
    }

    /*
     * Command reaction.
     */
    const wantReact =
      getVar('CMD_REACT')

    if (wantReact) {
      await m
        .react(
          getVar(
            'CMD_REACT_EMOJI'
          ) || '⚡'
        )
        .catch(() => {})

      m.reacted = false
    }

    let failed = false

    try {
      const pluginSock =
        getVar(
          'AUTO_DELETE_COMMANDS'
        )
          ? socketForCommand(
              sock,
              m
            )
          : sock

      await plugin.run({
        sock: pluginSock,
        m,
        args,
        text,
        command,
        prefix,
        config,
        DB,
        getVar,
        commands,
        pluginCount,
        ...ctx
      })
    } catch (e) {
      failed = true
      throw e
    } finally {
      if (
        wantReact &&
        !m.reacted
      ) {
        await m
          .react(
            failed
              ? '❌'
              : '✅'
          )
          .catch(() => {})
      }
    }
  } catch (e) {
    /*
     * Log full error to terminal.
     */
    log.error(
      'Handler error:',
      e?.stack ||
        e?.message ||
        e
    )

    const raw_msg =
      String(
        e?.message || e
      )

    let friendly

    if (
      /is not a function/.test(
        raw_msg
      )
    ) {
      friendly =
        '⚠️ I could not complete that — WhatsApp did not accept the request.\n\n' +
        '_This usually means I am missing admin rights, or the feature is not available for this chat._'
    } else if (
      /forbidden|not-authorized|401|403/i.test(
        raw_msg
      )
    ) {
      friendly =
        '🚫 WhatsApp refused that action. I probably need to be a group admin.'
    } else if (
      /timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(
        raw_msg
      )
    ) {
      friendly =
        '⏱️ That took too long and timed out. Please try again.'
    } else if (
      /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(
        raw_msg
      )
    ) {
      friendly =
        '🌐 A service I rely on is unreachable right now. Try again shortly.'
    } else if (
      /rate.?limit|429|too many/i.test(
        raw_msg
      )
    ) {
      friendly =
        '🐢 Rate limited. Please wait a moment and try again.'
    } else if (
      /not-acceptable|item-not-found|404/i.test(
        raw_msg
      )
    ) {
      friendly =
        '❓ WhatsApp could not find that chat, user or message.'
    } else {
      friendly =
        `⚠️ Something went wrong:\n_${raw_msg.slice(0, 200)}_`
    }

    try {
      if (
        raw?.key?.remoteJid
      ) {
        const sent =
          await sock.sendMessage(
            raw.key.remoteJid,
            {
              text: friendly
            }
          )

        if (
          cleanupMessage &&
          sent?.key?.id
        ) {
          cleanupMessage.commandResponses.push(
            sent.key
          )
        }
      }
    } catch {}
  } finally {
    /*
     * Only command messages get command cleanup.
     *
     * Antilink messages are NOT put into commandResponses,
     * so normal middleware behavior is preserved.
     */
    if (
      cleanupMessage &&
      getVar(
        'AUTO_DELETE_COMMANDS'
      )
    ) {
      await cleanupCommandMessages(
        sock,
        cleanupMessage
      )
    }
  }
}

export default handleMessage