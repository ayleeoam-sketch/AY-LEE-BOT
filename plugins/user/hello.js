export default {
  name: 'hello',
  alias: ['hi', 'hey'],
  category: 'USER',
  desc: 'Ask the user to save the bot contact',
  usage: '.hello',
  cooldown: 5,

  async run({ m }) {
    await m.reply(
      `Good Day\n` +
      `Kindly save this number as:\n` +
      `*AY-LEE*`
    )
  }
}
