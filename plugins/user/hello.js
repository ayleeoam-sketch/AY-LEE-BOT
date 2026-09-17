export default {
  name: 'hello',
  alias: ['hi', 'hey'],
  category: 'USER',
  desc: 'Send a personal welcome message',
  usage: '.hello',
  cooldown: 5,

  async run({ m }) {
    await m.reply(
      `👋 *Hello, good day!*\n\n` +
      `Kindly save this number as *AYLEE*.\n\n` +
      `How can I assist you? 🤝`
    )
  }
}
