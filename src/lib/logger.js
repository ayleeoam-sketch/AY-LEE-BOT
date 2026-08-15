import pino from 'pino'
import chalk from 'chalk'

/** Silent logger handed to Baileys - its own logs are extremely noisy. */
export const waLogger = pino({ level: 'silent' })

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

export const log = {
  info: (...a) => console.log(chalk.gray(`[${stamp()}]`), chalk.cyan('INFO '), ...a),
  ok: (...a) => console.log(chalk.gray(`[${stamp()}]`), chalk.green('OK   '), ...a),
  warn: (...a) => console.log(chalk.gray(`[${stamp()}]`), chalk.yellow('WARN '), ...a),
  error: (...a) => console.log(chalk.gray(`[${stamp()}]`), chalk.red('ERROR'), ...a),
  cmd: (...a) => console.log(chalk.gray(`[${stamp()}]`), chalk.magenta('CMD  '), ...a),
  banner: (text) => console.log(chalk.cyan(text))
}

export default log
