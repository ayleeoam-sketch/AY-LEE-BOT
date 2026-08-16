import { collection } from '../../src/lib/database.js'
import { http } from '../../src/lib/api.js'

/**
 * Temporary email - people constantly hunt for this to avoid spam signups.
 *
 *   .tempmail   -> create (or show) your throwaway address
 *   .tempinbox  -> read what arrived
 *
 * Backed by mail.tm: keyless public API. Addresses live as long as the user
 * keeps them (stored in the bot DB), and tokens are fetched fresh each read.
 */

const accounts = collection('tempmail')
let cachedDomain = null
let domainAt = 0

/** Tiny mail.tm client. `client` is injectable for offline tests. */
export function createMailTm(client = http) {
  const base = 'https://api.mail.tm'

  async function domain() {
    if (cachedDomain && Date.now() - domainAt < 3600_000) return cachedDomain
    const { data } = await client.get(`${base}/domains`, { params: { limit: 1 } })
    const d = data?.['hydra:member']?.[0]?.domain || data?.[0]?.domain
    if (!d) throw new Error('no mail domains available right now')
    cachedDomain = d
    domainAt = Date.now()
    return d
  }

  async function register(address, password) {
    await client.post(`${base}/accounts`, { address, password })
  }

  async function token(address, password) {
    const { data } = await client.post(`${base}/token`, { address, password })
    if (!data?.token) throw new Error('mail service would not issue a token')
    return data.token
  }

  async function inbox(t) {
    const { data } = await client.get(`${base}/messages`, {
      headers: { Authorization: `Bearer ${t}` }
    })
    const list = data?.['hydra:member'] || data || []
    return (Array.isArray(list) ? list : []).map((m) => ({
      from: m.from?.address || 'unknown',
      subject: m.subject || '(no subject)',
      intro: (m.intro || '').slice(0, 100).replace(/\s+/g, ' '),
      at: m.createdAt
    }))
  }

  return { domain, register, token, inbox }
}

async function getOrCreateAccount(jid, myNumber, client = createMailTm()) {
  let acct = await accounts.findOne({ id: myNumber })
  if (acct?.address) return acct

  const domain = await client.domain()
  const password = `venom-${Math.random().toString(36).slice(2, 12)}`
  const address = `venom${myNumber.slice(-4)}${Math.floor(Math.random() * 900 + 100)}@${domain}`
  await client.register(address, password)
  acct = { id: myNumber, address, password, createdAt: Date.now() }
  await accounts.set({ id: myNumber }, acct)
  return acct
}

export default [
  {
    name: 'tempmail',
    alias: ['tempmailgen', 'fakeemail', 'disposable'],
    category: 'UTILITIES',
    desc: 'Get a throwaway email address (spam signups, one-time otps)',
    usage: '.tempmail  |  .tempmail new (fresh address)',
    cooldown: 10,
    async run({ m, args }) {
      await m.react('📧')
      try {
        const myNumber = m.sender.split('@')[0].split(':')[0]
        if (args[0] === 'new') await accounts.delete({ id: myNumber })
        const acct = await getOrCreateAccount(m.sender, myNumber)
        await m.reply(
          `╭━━━〔 *TEMP MAIL* 〕━━━╮\n` +
            `┃ 📧 ${acct.address}\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `Use it anywhere, then read replies with *.tempinbox*\n` +
            `Want a different address? *.tempmail new*`
        )
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}\n\n_The free mail service may be down - try again in a bit._`)
      }
    }
  },
  {
    name: 'tempinbox',
    alias: ['tempbox', 'checkmail'],
    category: 'UTILITIES',
    desc: 'Read the messages in your temp mail inbox',
    usage: '.tempinbox',
    cooldown: 8,
    async run({ m }) {
      await m.react('📬')
      try {
        const myNumber = m.sender.split('@')[0].split(':')[0]
        const acct = await accounts.findOne({ id: myNumber })
        if (!acct?.address) return m.reply('📧 You have no temp mail yet - make one with *.tempmail*')

        const client = createMailTm()
        const t = await client.token(acct.address, acct.password)
        const msgs = await client.inbox(t)
        if (!msgs.length) {
          return m.reply(`📬 *${acct.address}*\n\n_Inbox is empty. Wait a minute after the sender hits send._`)
        }

        const body = msgs
          .slice(0, 6)
          .map(
            (v, i) => `*${i + 1}.* ✉️ ${v.subject}\n   from: ${v.from}\n   ${v.intro || '_no preview_'}`
          )
          .join('\n\n')
        await m.reply(`📬 *INBOX* - ${acct.address}\n\n${body}\n\n_(${msgs.length} message${msgs.length === 1 ? '' : 's'})_`)
        await m.react('✅')
      } catch (e) {
        await m.react('❌')
        await m.reply(`❌ ${e.message}`)
      }
    }
  }
]
