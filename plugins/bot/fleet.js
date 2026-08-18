import { fleetStats, formatFleet } from '../../src/lib/fleet.js'

export default [
  {
    name: 'totalusers',
    alias: ['users', 'usercount', 'fleet', 'network'],
    category: 'BOT',
    desc: 'Total people using every VENOM MD (hub + Render + other deploys)',
    usage: '.totalusers',
    owner: true,
    cooldown: 8,
    async run({ m }) {
      await m.react('📊').catch(() => {})
      try {
        const stats = await fleetStats()
        await m.reply(formatFleet(stats))
        await m.react('✅').catch(() => {})
      } catch (e) {
        await m.react('❌').catch(() => {})
        await m.reply(`❌ Could not count the network: ${e.message}`)
      }
    }
  }
]
