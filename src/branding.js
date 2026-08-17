/**
 * Permanent public credit for the original VENOM MD creator.
 *
 * Deployment owners still come from OWNER_NUMBER and keep all administrative
 * permissions, but public creator/contact commands must not be replaced when
 * somebody forks or deploys the bot.
 */
export const CREATOR = Object.freeze({
  name: 'TAPRUSH EMP (Micheal)',
  number: '2348021016309',
  jid: '2348021016309@s.whatsapp.net',
  github: 'https://github.com/MykelGoal'
})

export function creatorPromo(prefix = '.') {
  return (
    `💡 *New here?* Use *${prefix}menu <category>* or *${prefix}menu <command>* to learn what a command does.\n` +
    `🤖 *Want your own VENOM MD bot?* Contact the original creator with *${prefix}owner*.\n` +
    `📞 https://wa.me/${CREATOR.number}`
  )
}

export default CREATOR
