import { getUser, saveUser, SHOP, CURRENCY, comma } from '../../src/lib/economy.js'

export default [
  {
    name: 'shop',
    alias: ['store'],
    category: 'ECONOMY',
    desc: 'Browse items you can buy',
    usage: '.shop',
    async run({ m }) {
      const rows = Object.entries(SHOP)
        .map(([k, v]) => `┃ ${v.emoji} *${k}* — ${CURRENCY} ${comma(v.price)}\n┃    ${v.desc}`)
        .join('\n')
      await m.reply(
        `╭━━━〔 *SHOP* 〕━━━╮\n${rows}\n╰━━━━━━━━━━━━━━━╯\n\n🛒 Buy with *.buy <item>*\n💰 Sell with *.sell <item>* (70% refund)`
      )
    }
  },
  {
    name: 'buy',
    category: 'ECONOMY',
    desc: 'Buy an item from the shop',
    usage: '.buy pickaxe [qty]',
    async run({ m, args }) {
      const item = (args[0] || '').toLowerCase()
      const qty = Math.max(1, parseInt(args[1]) || 1)
      if (!SHOP[item]) return m.reply(`❌ No such item. See *.shop*`)

      const cost = SHOP[item].price * qty
      const u = await getUser(m.sender)
      if (u.wallet < cost) return m.reply(`❌ That costs ${CURRENCY} ${comma(cost)} and you have ${CURRENCY} ${comma(u.wallet)}.`)

      u.wallet -= cost
      u.inventory[item] = (u.inventory[item] || 0) + qty
      await saveUser(u)
      await m.reply(`🛒 Bought ${SHOP[item].emoji} *${item}* ×${qty} for ${CURRENCY} ${comma(cost)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
    }
  },
  {
    name: 'sell',
    category: 'ECONOMY',
    desc: 'Sell an item back for 70% of its price',
    usage: '.sell pickaxe [qty]',
    async run({ m, args }) {
      const item = (args[0] || '').toLowerCase()
      const qty = Math.max(1, parseInt(args[1]) || 1)
      if (!SHOP[item]) return m.reply('❌ No such item. See *.shop*')

      const u = await getUser(m.sender)
      if ((u.inventory[item] || 0) < qty) return m.reply(`❌ You don't own ${qty}× ${item}.`)

      const refund = Math.floor(SHOP[item].price * 0.7) * qty
      u.inventory[item] -= qty
      if (u.inventory[item] <= 0) delete u.inventory[item]
      u.wallet += refund
      await saveUser(u)
      await m.reply(`💰 Sold ${SHOP[item].emoji} *${item}* ×${qty} for ${CURRENCY} ${comma(refund)}\n\n💵 Wallet: ${CURRENCY} ${comma(u.wallet)}`)
    }
  },
  {
    name: 'inventory',
    alias: ['inv', 'bag'],
    category: 'ECONOMY',
    desc: 'See what you own',
    usage: '.inv',
    async run({ m }) {
      const u = await getUser(m.sender)
      const items = Object.entries(u.inventory).filter(([, q]) => q > 0)
      if (!items.length) return m.reply('🎒 Your bag is empty. Buy something with *.shop*')
      await m.reply(
        `╭━━━〔 *YOUR BAG* 〕━━━╮\n` +
          items.map(([k, q]) => `┃ ${SHOP[k]?.emoji || '📦'} ${k} ×${q}`).join('\n') +
          `\n╰━━━━━━━━━━━━━━━╯`
      )
    }
  },
  {
    name: 'gift',
    category: 'ECONOMY',
    desc: 'Gift an item to someone',
    usage: '.gift @user pickaxe',
    group: true,
    async run({ m, args }) {
      const target = m.mentions?.[0] || m.quoted?.sender
      if (!target) return m.reply('📝 Usage: .gift @user pickaxe')
      const item = args.find((a) => SHOP[a.toLowerCase()])?.toLowerCase()
      if (!item) return m.reply('❌ Name a valid item. See *.shop*')

      const u = await getUser(m.sender)
      if (!u.inventory[item]) return m.reply(`❌ You don't own a ${item}.`)

      const v = await getUser(target)
      u.inventory[item]--
      if (u.inventory[item] <= 0) delete u.inventory[item]
      v.inventory[item] = (v.inventory[item] || 0) + 1
      await saveUser(u)
      await saveUser(v)

      await m.reply({ text: `🎁 You gifted ${SHOP[item].emoji} *${item}* to @${target.split('@')[0]}`, mentions: [target] })
    }
  },
  {
    name: 'use',
    category: 'ECONOMY',
    desc: 'Show what an item does',
    usage: '.use laptop',
    async run({ m, args }) {
      const item = (args[0] || '').toLowerCase()
      if (!SHOP[item]) return m.reply('❌ No such item. See *.shop*')
      const u = await getUser(m.sender)
      if (!u.inventory[item]) return m.reply(`❌ You don't own a ${item}.`)
      await m.reply(`${SHOP[item].emoji} *${item}*\n\n${SHOP[item].desc}\n\nThis item works automatically - no need to activate it.`)
    }
  }
]
