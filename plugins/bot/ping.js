export default {
  name: 'ping',
  alias: ['p', 'speed', 'latency'],
  category: 'BOT',
  desc: 'Check the bot response time',
  usage: '.ping',
  cooldown: 3,

  async run({ m }) {
    const start = Date.now()

    console.log(`[PING] Command started: ${new Date().toISOString()}`)

    const sent = await m.reply('🏓 Pinging...')

    const replyMs = Date.now() - start
    console.log(`[PING] First reply took ${replyMs}ms`)

    const rating =
      replyMs < 300
        ? 'Excellent'
        : replyMs < 800
          ? 'Good'
          : replyMs < 2000
            ? 'Fair'
            : 'Slow'

    await m.send(
      {
        text:
          `🏓 *Pong!*\n` +
          `⚡ Speed: *${replyMs} ms*\n` +
          `📶 Status: *${rating}*`,
        edit: sent.key
      },
      { jid: m.chat }
    )

    console.log(`[PING] Finished in ${Date.now() - start}ms`)
  }
}