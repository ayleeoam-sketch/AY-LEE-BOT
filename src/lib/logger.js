import pino from 'pino'
import chalk from 'chalk'

/** Silent logger handed to Baileys - its own logs are extremely noisy. */
export const waLogger = pino({ level: 'silent' })

/*
 * Quieten libsignal.
 *
 * libsignal calls console.error() directly (session_cipher.js:157), so it
 * ignores every logger setting Baileys offers. "Bad MAC" / "Failed to decrypt"
 * is normal and unavoidable: a freshly linked device has no Signal session for
 * messages encrypted before it existed, and WhatsApp still delivers retries,
 * receipts and group traffic it cannot read. The message is simply skipped.
 *
 * Left alone this floods the console - one report saw 168,000 errors in two
 * hours and an out-of-memory crash. We swallow the known-benign lines, count
 * them, and surface a single summary so real errors stay visible.
 */
const NOISE = [
  /Failed to decrypt message with any known session/i,
  /^Session error:.*Bad MAC/i,
  /Bad MAC Error: Bad MAC/i,
  /Closing session: SessionEntry/i,
  /Closing open session in favor of incoming prekey bundle/i,
  /No matching sessions found for message/i,
  /^SessionEntry \{/,
  /MessageCounterError/i
]

let suppressed = 0
let lastReport = Date.now()
const REPORT_EVERY = 5 * 60 * 1000

const origError = console.error
const origLog = console.log

const isNoise = (args) => {
  const first = args[0]
  const text = typeof first === 'string' ? first : first?.message || String(first ?? '')
  return NOISE.some((re) => re.test(text))
}

console.error = (...args) => {
  if (isNoise(args)) {
    suppressed++
    // occasional heads-up so the silence is never mysterious
    if (Date.now() - lastReport > REPORT_EVERY) {
      lastReport = Date.now()
      origLog(
        chalk.gray(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}]`),
        chalk.yellow('WARN '),
        chalk.gray(`skipped ${suppressed} undecryptable message(s) - normal for a new device`)
      )
      suppressed = 0
    }
    return
  }
  origError(...args)
}

/** libsignal dumps the raw SessionEntry object through console.log too. */
console.log = (...args) => {
  if (isNoise(args)) {
    suppressed++
    return
  }
  origLog(...args)
}

/** How many noisy lines have been swallowed (used by .stats). */
export const suppressedCount = () => suppressed

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

export const log = {
  info: (...a) => origLog(chalk.gray(`[${stamp()}]`), chalk.cyan('INFO '), ...a),
  ok: (...a) => origLog(chalk.gray(`[${stamp()}]`), chalk.green('OK   '), ...a),
  warn: (...a) => origLog(chalk.gray(`[${stamp()}]`), chalk.yellow('WARN '), ...a),
  error: (...a) => origLog(chalk.gray(`[${stamp()}]`), chalk.red('ERROR'), ...a),
  cmd: (...a) => origLog(chalk.gray(`[${stamp()}]`), chalk.magenta('CMD  '), ...a),
  banner: (text) => origLog(chalk.cyan(text))
}

export default log
