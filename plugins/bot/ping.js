export default {
  name: 'ping',
  alias: ['p', 'speed', 'latency'],
  category: 'BOT',
  desc: 'Check the bot response time',
  usage: '.ping',
  cooldown: 3,

  async run({ m }) {
    const start = Date.now()
    const sent = await m.reply('🏓 Pinging...')
    const ms = Date.now() - start
    const rating = ms < 300 ? 'Excellent' : ms < 800 ? 'Good' : ms < 2000 ? 'Fair' : 'Slow'
    await m.send(
      { text: `🏓 *Pong!*\n⚡ Speed: *${ms} ms*\n📶 Status: *${rating}*`, edit: sent.key },
      { jid: m.chat }
    )
  }
}
