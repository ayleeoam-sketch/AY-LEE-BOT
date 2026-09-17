export default {
  name: 'aza',
  category: 'BOT',
  desc: 'Show payment details with optional amount',
  usage: '.aza [amount]',

  async run({ m, args }) {
    const input = args?.join(' ').trim()

    let amountText = ''

    if (input) {
      const cleaned = input
        .toLowerCase()
        .replace(/₦/g, '')
        .replace(/,/g, '')
        .trim()

      let amount = null

      if (cleaned.endsWith('k')) {
        const value = parseFloat(cleaned.slice(0, -1))

        if (!Number.isNaN(value)) {
          amount = value * 1000
        }
      } else {
        const value = Number(cleaned)

        if (!Number.isNaN(value)) {
          amount = value
        }
      }

      if (amount !== null && amount >= 0) {
        amountText =
          '\n💰 *Amount:* ₦' +
          amount.toLocaleString('en-NG')
      } else {
        amountText = '\n💰 *Amount:* ' + input
      }
    }

    const message =
      '💳 *PAYMENT DETAILS*\n\n' +
      '🏦 *Opay*\n' +
      '🔢 *6141581496*\n' +
      '👤 *Ayomide Moses Olurankinse*\n' +
      amountText +
      '\n\n⚠️ *Please confirm the account name and amount before sending.*\n' +
      '📸 *After payment, send your receipt immediately.*'

    await m.reply(message)
  }
}
