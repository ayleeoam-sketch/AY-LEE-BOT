/**
 * Permanent public credit for the original VENOM MD creator.
 *
 * Deployment owners still come from OWNER_NUMBER and keep all administrative
 * permissions, but public creator/contact commands must not be replaced when
 * somebody forks or deploys the bot.
 *
 * Pairing (.pair) and the one-click deploy hub only run on the official
 * creator instance — not on someone else's copy.
 */
import config from './config.js'

export const CREATOR = Object.freeze({
  name: 'TAPRUSH EMP (Micheal)',
  number: '2348021016309',
  jid: '2348021016309@s.whatsapp.net',
  github: 'https://github.com/MykelGoal',
  repo: 'https://github.com/MykelGoal/VENOM-MD-BOT',
  group: 'https://chat.whatsapp.com/JQrMgboto6b3kbySokt8lP',
  groupCode: 'JQrMgboto6b3kbySokt8lP',
  wa: 'https://wa.me/2348021016309'
})

/** Tiny line appended to every command reply. */
export function commandFooter(prefix = '.') {
  return `_⚡ Want this bot? *${prefix}owner* then *${prefix}pair*_`
}

export function creatorPromo(prefix = '.') {
  return (
    `💡 *New here?* Use *${prefix}menu <category>* or *${prefix}menu <command>* to learn what a command does.\n` +
    `🤖 *Want your own VENOM MD bot?* Send *${prefix}owner* then *${prefix}pair*.\n` +
    `👥 Official group (required): ${CREATOR.group}\n` +
    `📞 ${CREATOR.wa}`
  )
}

export function getBotCard(prefix = '.') {
  return (
    `🐍 *GET YOUR OWN VENOM MD*\n` +
    `by *${CREATOR.name}*\n\n` +
    `1. Join the official group — the bot will not work until you do:\n` +
    `   ${CREATOR.group}\n\n` +
    `2. Send *${prefix}owner* — that is the original creator, not a random deployer.\n\n` +
    `3. Send *${prefix}pair* on the *official* VENOM MD (this only works there).\n` +
    `   After it links, the bot *starts itself for you* on this hub.\n` +
    `   You can also paste a session ID or *${prefix}autodeploy VNM-XXXXXX*.\n\n` +
    `📞 ${CREATOR.wa}\n` +
    `⭐ ${CREATOR.repo}`
  )
}

/**
 * True only on the original creator's own deployment.
 * Forks / Render copies with a different OWNER_NUMBER cannot mint sessions.
 */
export function isCreatorHub() {
  if (['1', 'true', 'yes', 'on'].includes(String(process.env.PAIR_HUB || '').trim().toLowerCase())) {
    return true
  }
  const owners = Array.isArray(config.ownerNumbers) ? config.ownerNumbers : []
  return owners.includes(CREATOR.number)
}

export function notHubPairMessage(prefix = '.') {
  return (
    `🚫 *.pair* only works on the *official* VENOM MD, not on a copy someone else deployed.\n\n` +
    `Message the original creator:\n` +
    `👤 ${CREATOR.name}\n` +
    `📞 ${CREATOR.wa}\n\n` +
    `Then send *${prefix}owner* and *${prefix}pair* there.\n` +
    `👥 ${CREATOR.group}`
  )
}

/** Detect our own promo so we never stamp the footer twice. */
export function alreadyHasAd(text) {
  return /Want this bot\?|Want your own VENOM MD|\.pair\*|_⚡ Want this bot/i.test(String(text || ''))
}

/** Append the tiny footer to a Baileys content payload or a plain string. */
export function withCommandFooter(payload, prefix = '.') {
  const tag = `\n\n${commandFooter(prefix)}`
  if (typeof payload === 'string') {
    return alreadyHasAd(payload) ? payload : payload + tag
  }
  if (!payload || typeof payload !== 'object') return payload
  if (typeof payload.text === 'string' && !alreadyHasAd(payload.text)) {
    return { ...payload, text: payload.text + tag }
  }
  if (typeof payload.caption === 'string' && !alreadyHasAd(payload.caption)) {
    return { ...payload, caption: payload.caption + tag }
  }
  return payload
}

export default CREATOR
