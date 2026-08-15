import { getUser, saveUser, cooldownLeft, prettyTime, COOLDOWNS, CURRENCY, comma, rand } from '../../src/lib/economy.js'

/** Parse a bet: a number, or "all"/"half". */
const parseBet = (arg, wallet) => {
  if (!arg) return null
  const a = String(arg).toLowerCase()
  if (a === 'all') return wallet
  if (a === 'half') return Math.floor(wallet / 2)
  const n = parseInt(a)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Shared validation for every gambling command. */
async function stake(m, args, min = 50) {
  const u = await getUser(m.sender)
  const bet = parseBet(args[0], u.wallet)
  if (!bet) return { error: `📝 Place a bet: e.g. *${min * 2}*, *half*, or *all*` }
  if (bet < min) return { error: `❌ Minimum bet is ${CURRENCY} ${comma(min)}` }
  if (bet > u.wallet) return { error: `❌ You only have ${CURRENCY} ${comma(u.wallet)}` }
  return { u, bet }
}

export default [
  {
    name: 'gamble',
    alias: ['bet'],
    category: 'ECONOMY',
    desc: 'Gamble your coins',
    usage: '.gamble 500 | .gamble all',
    async run({ m, args }) {
      const { u, bet, error } = await stake(m, args)
      if (error) return m.reply(error)

      const win = Math.random() < 0.45
      const multiplier = win ? (Math.random() < 0.1 ? 3 : 2) : 0
      const delta = win ? bet * (multiplier - 1) : -bet
      u.wallet += delta
      await saveUser(u)

      await m.reply(
        win
          ? `🎰 *YOU WON!* ${multiplier === 3 ? '💎 JACKPOT ×3!' : '×2'}\n\n📈 Profit: ${CURRENCY} ${comma(bet * (multiplier - 1))}\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
          : `🎰 *You lost.*\n\n📉 Lost: ${CURRENCY} ${comma(bet)}\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'coinflip',
    alias: ['cf', 'flip'],
    category: 'ECONOMY',
    desc: 'Flip a coin - heads or tails',
    usage: '.cf heads 500',
    async run({ m, args }) {
      const side = (args[0] || '').toLowerCase()
      if (!['heads', 'tails', 'h', 't'].includes(side)) {
        return m.reply('🪙 Usage: *.cf heads 500* or *.cf tails all*')
      }
      const pick = side.startsWith('h') ? 'heads' : 'tails'
      const { u, bet, error } = await stake(m, [args[1]])
      if (error) return m.reply(error)

      const result = Math.random() < 0.5 ? 'heads' : 'tails'
      const won = result === pick
      u.wallet += won ? bet : -bet
      await saveUser(u)

      await m.reply(
        `🪙 The coin landed on *${result.toUpperCase()}*\n\n` +
          (won ? `✅ You won ${CURRENCY} ${comma(bet)}` : `❌ You lost ${CURRENCY} ${comma(bet)}`) +
          `\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'dice',
    alias: ['roll'],
    category: 'ECONOMY',
    desc: 'Beat the dealer\'s dice roll',
    usage: '.dice 500',
    async run({ m, args }) {
      const { u, bet, error } = await stake(m, args)
      if (error) return m.reply(error)

      const you = rand(1, 6)
      const dealer = rand(1, 6)
      const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

      let outcome, delta
      if (you > dealer) { outcome = '✅ You win!'; delta = bet }
      else if (you < dealer) { outcome = '❌ Dealer wins.'; delta = -bet }
      else { outcome = '🤝 Push - bet returned.'; delta = 0 }

      u.wallet += delta
      await saveUser(u)
      await m.reply(
        `🎲 *DICE*\n\nYou: ${faces[you]} (${you})\nDealer: ${faces[dealer]} (${dealer})\n\n${outcome}\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'slots',
    alias: ['slot'],
    category: 'ECONOMY',
    desc: 'Play the slot machine',
    usage: '.slots 500',
    async run({ m, args }) {
      const { u, bet, error } = await stake(m, args)
      if (error) return m.reply(error)

      const reel = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣']
      const s = [reel[rand(0, 5)], reel[rand(0, 5)], reel[rand(0, 5)]]

      let mult = 0
      if (s[0] === s[1] && s[1] === s[2]) mult = s[0] === '7️⃣' ? 10 : s[0] === '💎' ? 7 : 4
      else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) mult = 1.5

      const payout = Math.floor(bet * mult) - bet
      u.wallet += payout
      await saveUser(u)

      await m.reply(
        `🎰 ═══════════\n` +
          `    ${s.join(' | ')}\n` +
          `🎰 ═══════════\n\n` +
          (mult >= 4 ? `🎉 *BIG WIN ×${mult}!*` : mult > 0 ? `✅ Small win ×${mult}` : '❌ No match') +
          `\n${payout >= 0 ? '📈' : '📉'} ${payout >= 0 ? '+' : ''}${CURRENCY} ${comma(payout)}` +
          `\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'blackjack',
    alias: ['bj'],
    category: 'ECONOMY',
    desc: 'Play a hand of blackjack',
    usage: '.bj 500',
    async run({ m, args }) {
      const { u, bet, error } = await stake(m, args)
      if (error) return m.reply(error)

      const draw = () => rand(1, 11)
      const hand = () => {
        let total = draw() + draw()
        while (total < 17) total += draw()
        return total
      }

      const you = hand()
      const dealer = hand()

      let outcome, delta
      if (you > 21) { outcome = '💥 You bust!'; delta = -bet }
      else if (dealer > 21) { outcome = '✅ Dealer busts - you win!'; delta = bet }
      else if (you > dealer) { outcome = '✅ You win!'; delta = bet }
      else if (you < dealer) { outcome = '❌ Dealer wins.'; delta = -bet }
      else { outcome = '🤝 Push.'; delta = 0 }

      u.wallet += delta
      await saveUser(u)
      await m.reply(
        `🃏 *BLACKJACK*\n\nYour hand: *${you}*\nDealer: *${dealer}*\n\n${outcome}\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'rps',
    category: 'ECONOMY',
    desc: 'Rock paper scissors for coins',
    usage: '.rps rock 500',
    async run({ m, args }) {
      const map = { rock: '🪨', paper: '📄', scissors: '✂️', r: '🪨', p: '📄', s: '✂️' }
      const choice = (args[0] || '').toLowerCase()
      if (!map[choice]) return m.reply('📝 Usage: *.rps rock 500* (rock/paper/scissors)')

      const you = choice.length === 1 ? { r: 'rock', p: 'paper', s: 'scissors' }[choice] : choice
      const { u, bet, error } = await stake(m, [args[1]])
      if (error) return m.reply(error)

      const options = ['rock', 'paper', 'scissors']
      const bot = options[rand(0, 2)]
      const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' }

      let outcome, delta
      if (you === bot) { outcome = '🤝 Draw.'; delta = 0 }
      else if (beats[you] === bot) { outcome = '✅ You win!'; delta = bet }
      else { outcome = '❌ You lose.'; delta = -bet }

      u.wallet += delta
      await saveUser(u)
      await m.reply(
        `${map[you]} vs ${map[bot]}\n\nYou: ${you}\nBot: ${bot}\n\n${outcome}\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'heist',
    category: 'ECONOMY',
    desc: 'High-risk bank heist',
    usage: '.heist',
    async run({ m }) {
      const u = await getUser(m.sender)
      const left = cooldownLeft(u.lastHeist, COOLDOWNS.heist)
      if (left) return m.reply(`⏳ Too hot right now. Next heist in *${prettyTime(left)}*.`)
      if (u.wallet < 1000) return m.reply('💸 You need at least 1,000 coins to fund a heist.')

      u.lastHeist = Date.now()
      const success = Math.random() < 0.3

      if (success) {
        const loot = rand(5000, 25000)
        u.wallet += loot
        await saveUser(u)
        return m.reply(`🏦💰 *HEIST SUCCESSFUL!*\n\nYou cracked the vault and escaped with ${CURRENCY} ${comma(loot)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
      }

      const loss = Math.floor(u.wallet * 0.3)
      u.wallet -= loss
      await saveUser(u)
      await m.reply(`🚨 *HEIST FAILED!*\n\nAlarms went off. You lost ${CURRENCY} ${comma(loss)} escaping.\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
    }
  },
  {
    name: 'bankrob',
    category: 'ECONOMY',
    desc: 'Rob the bank - huge risk, huge reward',
    usage: '.bankrob',
    async run({ m }) {
      const u = await getUser(m.sender)
      const left = cooldownLeft(u.lastHeist, COOLDOWNS.heist)
      if (left) return m.reply(`⏳ Security is tight. Wait *${prettyTime(left)}*.`)
      if (u.wallet < 2500) return m.reply('💸 You need 2,500 coins for equipment.')

      u.lastHeist = Date.now()
      if (Math.random() < 0.2) {
        const loot = rand(15000, 60000)
        u.wallet += loot
        await saveUser(u)
        return m.reply(`🏦🎉 *YOU ROBBED THE BANK!*\n\nHaul: ${CURRENCY} ${comma(loot)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
      }
      const loss = Math.min(u.wallet, rand(2000, 8000))
      u.wallet -= loss
      await saveUser(u)
      await m.reply(`🚔 *ARRESTED!*\n\nBail cost you ${CURRENCY} ${comma(loss)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
    }
  }
]
