export default {
  name: 'aza',
  category: 'BOT',
  desc: 'Show payment details',
  usage: '.aza',

  async run({ m }) {
    await m.reply(
      '💳 *PAYMENT DETAILS*\n\n' +
      '🏦 *OPay*\n' +
      '🔢 *6141581496*\n' +
      '👤 *Ayomide Moses Olurankinse*\n\n' +
      '✅ Kindly confirm the name before sending.\n' +
      '🙏 Thanks for your payment.'
    )
  }
}
