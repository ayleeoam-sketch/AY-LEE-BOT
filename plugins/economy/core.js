import DB from '../../src/lib/database.js'
import {
  getUser, saveUser, netWorth, cooldownLeft, prettyTime,
  COOLDOWNS, SHOP, CURRENCY, comma, rand, addXp
} from '../../src/lib/economy.js'
import { toJid } from '../../src/lib/utils.js'

const targetOf = (m, args) => {
  if (m.mentions?.length) return m.mentions[0]
  if (m.quoted?.sender) return m.quoted.sender
  if (args[0] && /^\d{7,}$/.test(args[0].replace(/\D/g, ''))) return toJid(args[0])
  return null
}

/** Shared shape for earn-type commands with a cooldown. */
const earner = ({ name, alias, desc, key, min, max, needs, messages, xp = 10 }) => ({
  name,
  alias,
  category: 'ECONOMY',
  desc,
  usage: `.${name}`,
  async run({ m }) {
    const u = await getUser(m.sender)

    if (needs && !u.inventory[needs]) {
      return m.reply(`❌ You need a ${SHOP[needs].emoji} *${needs}* first.\nBuy one with *.buy ${needs}*`)
    }

    const left = cooldownLeft(u[key], COOLDOWNS[name])
    if (left) return m.reply(`⏳ You're tired. Try *.${name}* again in *${prettyTime(left)}*.`)

    const amount = rand(min, max)
    u.wallet += amount
    u[key] = Date.now()
    await saveUser(u)
    const { leveled, level } = await addXp(m.sender, xp)

    const line = messages[Math.floor(Math.random() * messages.length)].replace('{amount}', `${CURRENCY} ${comma(amount)}`)
    await m.reply(`${line}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}` + (leveled ? `\n🎉 Level up! You are now level *${level}*` : ''))
  }
})

export default [
  /* ----------------------------- balance ----------------------------- */
  {
    name: 'balance',
    alias: ['bal', 'wallet', 'money'],
    category: 'ECONOMY',
    desc: 'Check your coin balance',
    usage: '.bal [@user]',
    async run({ m, args }) {
      const target = targetOf(m, args) || m.sender
      const u = await getUser(target)
      const who = target === m.sender ? 'Your' : `@${target.split('@')[0]}'s`
      await m.reply({
        text:
          `╭━━━〔 *${who} BALANCE* 〕━━━╮\n` +
          `┃ 💵 Wallet: ${CURRENCY} ${comma(u.wallet)}\n` +
          `┃ 🏦 Bank: ${CURRENCY} ${comma(u.bank)} / ${comma(u.bankLimit)}\n` +
          `┃ 💎 Net worth: ${CURRENCY} ${comma(netWorth(u))}\n` +
          `┃ 📊 Level ${u.level} (${u.xp}/${u.level * 100} XP)\n` +
          (u.loan ? `┃ 🧾 Loan owed: ${CURRENCY} ${comma(u.loan)}\n` : '') +
          `╰━━━━━━━━━━━━━━━━━╯`,
        mentions: [target]
      })
    }
  },

  /* ------------------------------ daily ------------------------------ */
  {
    name: 'daily',
    category: 'ECONOMY',
    desc: 'Claim your daily reward',
    usage: '.daily',
    async run({ m }) {
      const u = await getUser(m.sender)
      const left = cooldownLeft(u.lastDaily, COOLDOWNS.daily)
      if (left) return m.reply(`⏳ Already claimed. Come back in *${prettyTime(left)}*.`)

      // streak continues when claimed within 48h
      const within48 = Date.now() - u.lastDaily < 48 * 60 * 60 * 1000
      u.streak = within48 ? u.streak + 1 : 1
      const bonus = Math.min(u.streak * 100, 2000)
      const base = rand(500, 1500)
      const total = base + bonus

      u.wallet += total
      u.lastDaily = Date.now()
      await saveUser(u)
      await addXp(m.sender, 25)

      await m.reply(
        `🎁 *DAILY REWARD*\n\n` +
          `💰 Base: ${CURRENCY} ${comma(base)}\n` +
          `🔥 Streak bonus (${u.streak} days): ${CURRENCY} ${comma(bonus)}\n` +
          `━━━━━━━━━━━━━━\n` +
          `✅ Total: ${CURRENCY} ${comma(total)}\n` +
          `💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },
  {
    name: 'streak',
    category: 'ECONOMY',
    desc: 'Check your daily claim streak',
    usage: '.streak',
    async run({ m }) {
      const u = await getUser(m.sender)
      await m.reply(`🔥 Daily streak: *${u.streak} day${u.streak === 1 ? '' : 's'}*\nNext bonus: ${CURRENCY} ${comma(Math.min((u.streak + 1) * 100, 2000))}`)
    }
  },

  /* ------------------------- earning commands ------------------------- */
  earner({
    name: 'work', desc: 'Work a shift for coins', key: 'lastWork', min: 200, max: 900,
    messages: [
      '👨‍💻 You debugged production and earned {amount}',
      '🚕 You drove passengers all day and made {amount}',
      '🍳 You cooked at a restaurant and got {amount}',
      '📦 You delivered packages and earned {amount}',
      '🎨 You sold a design and made {amount}'
    ]
  }),
  earner({
    name: 'beg', desc: 'Beg strangers for coins', key: 'lastBeg', min: 10, max: 150, xp: 2,
    messages: [
      '🙏 A kind stranger gave you {amount}',
      '🥺 Someone felt bad and handed you {amount}',
      '👵 An old lady gave you {amount}',
      '🪙 You found {amount} on the ground'
    ]
  }),
  earner({
    name: 'fish', desc: 'Go fishing (needs a fishing rod)', key: 'lastFish', min: 150, max: 700, needs: 'fishingrod',
    messages: [
      '🎣 You caught a big tuna worth {amount}',
      '🐟 A decent catch sold for {amount}',
      '🦈 You reeled in something rare worth {amount}',
      '🐠 Your catch fetched {amount} at the market'
    ]
  }),
  earner({
    name: 'mine', desc: 'Mine for ore (needs a pickaxe)', key: 'lastMine', min: 200, max: 1000, needs: 'pickaxe',
    messages: [
      '⛏️ You struck gold worth {amount}',
      '💎 You found a diamond vein worth {amount}',
      '🪨 You sold ore for {amount}',
      '⚒️ A hard day underground earned you {amount}'
    ]
  }),
  earner({
    name: 'hunt', desc: 'Go hunting (needs a rifle)', key: 'lastHunt', min: 250, max: 1100, needs: 'rifle',
    messages: [
      '🦌 You hunted a deer worth {amount}',
      '🐗 A wild boar sold for {amount}',
      '🦃 You bagged game worth {amount}'
    ]
  }),

  /* ------------------------------ crime ------------------------------ */
  {
    name: 'crime',
    category: 'ECONOMY',
    desc: 'Commit a crime - risky but rewarding',
    usage: '.crime',
    async run({ m }) {
      const u = await getUser(m.sender)
      const left = cooldownLeft(u.lastCrime, COOLDOWNS.crime)
      if (left) return m.reply(`⏳ Lay low for *${prettyTime(left)}* before your next job.`)

      u.lastCrime = Date.now()
      const success = Math.random() < 0.55

      if (success) {
        const gain = rand(800, 3000)
        u.wallet += gain
        await saveUser(u)
        await addXp(m.sender, 30)
        return m.reply(`🕵️ *Crime successful!*\nYou got away with ${CURRENCY} ${comma(gain)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
      }

      const fine = Math.min(u.wallet, rand(300, 1200))
      u.wallet -= fine
      await saveUser(u)
      await m.reply(`🚔 *Busted!*\nYou were caught and fined ${CURRENCY} ${comma(fine)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
    }
  },
  {
    name: 'rob',
    category: 'ECONOMY',
    desc: 'Attempt to rob another user',
    usage: '.rob @user',
    group: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('🎯 Tag the person you want to rob: *.rob @user*')
      if (target === m.sender) return m.reply('🤨 You cannot rob yourself.')

      const u = await getUser(m.sender)
      const v = await getUser(target)

      const left = cooldownLeft(u.lastRob, COOLDOWNS.rob)
      if (left) return m.reply(`⏳ The heat hasn't died down. Wait *${prettyTime(left)}*.`)
      if (v.wallet < 200) return m.reply('💸 They have nothing worth stealing.')
      if (u.wallet < 100) return m.reply('💸 You need at least 100 coins to risk a robbery.')

      u.lastRob = Date.now()

      // lockpick improves odds, victim's vault protects half their wallet
      const odds = u.inventory.lockpick ? 0.6 : 0.4
      const protectedWallet = v.inventory.vault ? Math.floor(v.wallet / 2) : v.wallet

      if (Math.random() < odds) {
        const stolen = Math.floor(protectedWallet * (rand(20, 50) / 100))
        u.wallet += stolen
        v.wallet -= stolen
        await saveUser(u)
        await saveUser(v)
        return m.reply({
          text: `🦹 *Robbery successful!*\nYou stole ${CURRENCY} ${comma(stolen)} from @${target.split('@')[0]}` +
                (v.inventory.vault ? '\n🏦 Their vault protected half their money.' : '') +
                `\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`,
          mentions: [target]
        })
      }

      const fine = Math.min(u.wallet, rand(200, 800))
      u.wallet -= fine
      v.wallet += fine
      await saveUser(u)
      await saveUser(v)
      await m.reply({
        text: `🚨 *Caught in the act!*\nYou paid @${target.split('@')[0]} ${CURRENCY} ${comma(fine)} in damages.\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`,
        mentions: [target]
      })
    }
  },

  /* ------------------------------ banking ------------------------------ */
  {
    name: 'deposit',
    alias: ['dep'],
    category: 'ECONOMY',
    desc: 'Move coins into the bank (safe from robbery)',
    usage: '.dep 500 | .dep all',
    async run({ m, args }) {
      const u = await getUser(m.sender)
      const space = u.bankLimit - u.bank
      if (space <= 0) return m.reply(`🏦 Bank is full (${comma(u.bankLimit)}). Upgrade it with *.bankupgrade*`)

      let amount = args[0] === 'all' ? Math.min(u.wallet, space) : parseInt(args[0])
      if (!amount || amount <= 0) return m.reply('📝 Usage: .dep 500  (or .dep all)')
      if (amount > u.wallet) return m.reply(`❌ You only have ${CURRENCY} ${comma(u.wallet)} in your wallet.`)
      if (amount > space) return m.reply(`❌ Your bank only has room for ${CURRENCY} ${comma(space)} more.`)

      u.wallet -= amount
      u.bank += amount
      await saveUser(u)
      await m.reply(`🏦 Deposited ${CURRENCY} ${comma(amount)}\n\n💵 Wallet: ${comma(u.wallet)}\n🏦 Bank: ${comma(u.bank)}/${comma(u.bankLimit)}`)
    }
  },
  {
    name: 'withdraw',
    alias: ['with'],
    category: 'ECONOMY',
    desc: 'Take coins out of the bank',
    usage: '.with 500 | .with all',
    async run({ m, args }) {
      const u = await getUser(m.sender)
      let amount = args[0] === 'all' ? u.bank : parseInt(args[0])
      if (!amount || amount <= 0) return m.reply('📝 Usage: .with 500  (or .with all)')
      if (amount > u.bank) return m.reply(`❌ Your bank only holds ${CURRENCY} ${comma(u.bank)}.`)

      u.bank -= amount
      u.wallet += amount
      await saveUser(u)
      await m.reply(`💸 Withdrew ${CURRENCY} ${comma(amount)}\n\n💵 Wallet: ${comma(u.wallet)}\n🏦 Bank: ${comma(u.bank)}`)
    }
  },
  {
    name: 'bankupgrade',
    alias: ['upgradebank'],
    category: 'ECONOMY',
    desc: 'Increase your bank storage limit',
    usage: '.bankupgrade',
    async run({ m }) {
      const u = await getUser(m.sender)
      const cost = u.bankLimit
      if (u.wallet < cost) return m.reply(`❌ Upgrading costs ${CURRENCY} ${comma(cost)} and you have ${comma(u.wallet)}.`)
      u.wallet -= cost
      u.bankLimit *= 2
      await saveUser(u)
      await m.reply(`🏦 Bank upgraded!\nNew limit: ${CURRENCY} ${comma(u.bankLimit)}\nCost: ${CURRENCY} ${comma(cost)}`)
    }
  },
  {
    name: 'give',
    alias: ['pay', 'transfer'],
    category: 'ECONOMY',
    desc: 'Send coins to another user',
    usage: '.give @user 500',
    group: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Usage: .give @user 500')
      if (target === m.sender) return m.reply('🤨 You cannot pay yourself.')

      const amount = parseInt(args.find((a) => /^\d+$/.test(a)))
      if (!amount || amount <= 0) return m.reply('📝 Give a valid amount: .give @user 500')

      const u = await getUser(m.sender)
      if (u.wallet < amount) return m.reply(`❌ You only have ${CURRENCY} ${comma(u.wallet)}.`)

      const v = await getUser(target)
      u.wallet -= amount
      v.wallet += amount
      await saveUser(u)
      await saveUser(v)

      await m.reply({
        text: `✅ Sent ${CURRENCY} ${comma(amount)} to @${target.split('@')[0]}\n\n💵 Your wallet: ${CURRENCY} ${comma(u.wallet)}`,
        mentions: [target]
      })
    }
  },

  /* ------------------------------- loans ------------------------------- */
  {
    name: 'loan',
    category: 'ECONOMY',
    desc: 'Borrow coins from the bank',
    usage: '.loan 5000',
    async run({ m, args }) {
      const u = await getUser(m.sender)
      if (u.loan > 0) return m.reply(`🧾 You already owe ${CURRENCY} ${comma(u.loan)}. Repay with *.payloan*`)

      const amount = parseInt(args[0])
      const max = 10000 + u.level * 2000
      if (!amount || amount <= 0) return m.reply(`📝 Usage: .loan 5000\nYou can borrow up to ${CURRENCY} ${comma(max)}`)
      if (amount > max) return m.reply(`❌ Your credit limit is ${CURRENCY} ${comma(max)} (raise it by levelling up).`)

      u.wallet += amount
      u.loan = Math.floor(amount * 1.2) // 20% interest
      await saveUser(u)
      await m.reply(`🏦 Loan approved: ${CURRENCY} ${comma(amount)}\n🧾 To repay (20% interest): ${CURRENCY} ${comma(u.loan)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
    }
  },
  {
    name: 'payloan',
    alias: ['repay'],
    category: 'ECONOMY',
    desc: 'Repay your outstanding loan',
    usage: '.payloan [amount]',
    async run({ m, args }) {
      const u = await getUser(m.sender)
      if (!u.loan) return m.reply('✅ You have no outstanding loan.')

      const amount = args[0] ? parseInt(args[0]) : Math.min(u.loan, u.wallet)
      if (!amount || amount <= 0) return m.reply('📝 Usage: .payloan 1000')
      if (amount > u.wallet) return m.reply(`❌ You only have ${CURRENCY} ${comma(u.wallet)}.`)

      const paid = Math.min(amount, u.loan)
      u.wallet -= paid
      u.loan -= paid
      await saveUser(u)
      await m.reply(
        u.loan
          ? `💸 Paid ${CURRENCY} ${comma(paid)}\n🧾 Still owed: ${CURRENCY} ${comma(u.loan)}`
          : `✅ Loan fully repaid! You are debt free.\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`
      )
    }
  },

  /* ---------------------------- leaderboards ---------------------------- */
  {
    name: 'leaderboard',
    alias: ['lb', 'rich', 'top'],
    category: 'ECONOMY',
    desc: 'Richest users',
    usage: '.lb',
    cooldown: 10,
    async run({ m }) {
      const rows = await DB.users.all()
      if (!rows.length) return m.reply('📊 Nobody has earned anything yet.')
      const ranked = rows
        .map((r) => ({ ...r, total: netWorth({ ...r, inventory: r.inventory || {} }) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
      const medals = ['🥇', '🥈', '🥉']
      await m.reply({
        text:
          `╭━━━〔 *RICHEST USERS* 〕━━━╮\n` +
          ranked.map((r, i) => `┃ ${medals[i] || `${i + 1}.`} @${r.id} — ${CURRENCY} ${comma(r.total)}`).join('\n') +
          `\n╰━━━━━━━━━━━━━━━━━╯`,
        mentions: ranked.map((r) => `${r.id}@s.whatsapp.net`)
      })
    }
  },
  {
    name: 'poor',
    category: 'ECONOMY',
    desc: 'Poorest users',
    usage: '.poor',
    cooldown: 10,
    async run({ m }) {
      const rows = await DB.users.all()
      if (!rows.length) return m.reply('📊 No economy data yet.')
      const ranked = rows
        .map((r) => ({ ...r, total: netWorth({ ...r, inventory: r.inventory || {} }) }))
        .sort((a, b) => a.total - b.total)
        .slice(0, 10)
      await m.reply({
        text: `💸 *POOREST USERS*\n\n` + ranked.map((r, i) => `${i + 1}. @${r.id} — ${CURRENCY} ${comma(r.total)}`).join('\n'),
        mentions: ranked.map((r) => `${r.id}@s.whatsapp.net`)
      })
    }
  },
  {
    name: 'networth',
    alias: ['nw'],
    category: 'ECONOMY',
    desc: 'Total value of everything you own',
    usage: '.networth [@user]',
    async run({ m, args }) {
      const target = targetOf(m, args) || m.sender
      const u = await getUser(target)
      const items = Object.entries(u.inventory).filter(([, q]) => q > 0)
      const itemValue = items.reduce((s, [i, q]) => s + (SHOP[i]?.price || 0) * q, 0)
      await m.reply({
        text:
          `💎 *NET WORTH* — @${target.split('@')[0]}\n\n` +
          `💵 Wallet: ${CURRENCY} ${comma(u.wallet)}\n` +
          `🏦 Bank: ${CURRENCY} ${comma(u.bank)}\n` +
          `🎒 Items: ${CURRENCY} ${comma(itemValue)}\n` +
          `━━━━━━━━━━━━━━\n` +
          `📊 Total: ${CURRENCY} ${comma(netWorth(u))}`,
        mentions: [target]
      })
    }
  },
  {
    name: 'profile',
    category: 'ECONOMY',
    desc: 'Your full economy profile',
    usage: '.profile [@user]',
    async run({ m, args }) {
      const target = targetOf(m, args) || m.sender
      const u = await getUser(target)
      const items = Object.entries(u.inventory).filter(([, q]) => q > 0)
      const bar = (v, max, len = 10) => '█'.repeat(Math.round((v / max) * len)).padEnd(len, '░')
      await m.reply({
        text:
          `╭━━━〔 *PROFILE* 〕━━━╮\n` +
          `┃ 👤 @${target.split('@')[0]}\n` +
          `┃ 📊 Level: ${u.level}\n` +
          `┃ ⭐ XP: ${bar(u.xp, u.level * 100)} ${u.xp}/${u.level * 100}\n` +
          `┃ 💵 Wallet: ${CURRENCY} ${comma(u.wallet)}\n` +
          `┃ 🏦 Bank: ${CURRENCY} ${comma(u.bank)}\n` +
          `┃ 💎 Net worth: ${CURRENCY} ${comma(netWorth(u))}\n` +
          `┃ 🔥 Streak: ${u.streak} days\n` +
          `┃ 🎒 Items: ${items.length || 'none'}\n` +
          (u.loan ? `┃ 🧾 Debt: ${CURRENCY} ${comma(u.loan)}\n` : '') +
          `╰━━━━━━━━━━━━━━━╯`,
        mentions: [target]
      })
    }
  },

  /* ------------------------------ admin ------------------------------ */
  {
    name: 'addmoney',
    alias: ['setmoney'],
    category: 'ECONOMY',
    desc: 'Owner: give coins to a user',
    usage: '.addmoney @user 5000',
    owner: true,
    async run({ m, args }) {
      const target = targetOf(m, args) || m.sender
      const amount = parseInt(args.find((a) => /^-?\d+$/.test(a)))
      if (!amount) return m.reply('📝 Usage: .addmoney @user 5000')
      const u = await getUser(target)
      u.wallet = Math.max(0, u.wallet + amount)
      await saveUser(u)
      await m.reply({ text: `✅ Adjusted @${target.split('@')[0]} by ${CURRENCY} ${comma(amount)}\nNew wallet: ${CURRENCY} ${comma(u.wallet)}`, mentions: [target] })
    }
  },
  {
    name: 'resetecon',
    category: 'ECONOMY',
    desc: 'Owner: wipe a user\'s economy data',
    usage: '.resetecon @user',
    owner: true,
    async run({ m, args }) {
      const target = targetOf(m, args)
      if (!target) return m.reply('📝 Tag the user to reset.')
      await DB.users.delete({ id: target.split('@')[0].split(':')[0] })
      await m.reply(`♻️ Economy data reset for ${target.split('@')[0]}`)
    }
  }
]
