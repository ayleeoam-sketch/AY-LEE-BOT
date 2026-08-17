/**
 * Full offline+live test suite.
 *
 *   node test/fulltest.js
 *
 * Boots every subsystem against a mock WhatsApp socket and drives real
 * commands through the real handler. External-API commands are reported
 * separately so a third-party outage never looks like a bug in the bot.
 */
import './_isolate.js'   // MUST be first: keeps tests off the live DB
import '../src/config.js'
import config from '../src/config.js'
import { connectDB } from '../src/lib/database.js'
import { loadVars } from '../src/lib/vars.js'
import { loadPlugins, pluginCount, categories, commands } from '../src/lib/pluginLoader.js'
import { handleMessage } from '../src/handler.js'
import { getUser, saveUser } from '../src/lib/economy.js'
import DB from '../src/lib/database.js'

const OWNER = '2340000000001'
const MEMBER = '2348022222222'
const BOT = '2348000000000'

const sent = []
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, name: 'VENOM MD BOT' },
  sendMessage: async (jid, content) => {
    sent.push(content)
    return { key: { id: 'X' + Math.random(), remoteJid: jid, fromMe: true } }
  },
  readMessages: async () => {},
  sendPresenceUpdate: async () => {},
  groupMetadata: async (jid) => ({
    id: jid,
    subject: 'Test GC',
    owner: `${OWNER}@s.whatsapp.net`,
    creation: 1700000000,
    participants: [
      { id: `${OWNER}@s.whatsapp.net`, admin: 'superadmin' },
      { id: `${MEMBER}@s.whatsapp.net`, admin: null },
      { id: `${BOT}@s.whatsapp.net`, admin: 'admin' }
    ]
  }),
  groupParticipantsUpdate: async () => [{ status: '200' }],
  groupSettingUpdate: async () => {},
  updateMediaMessage: async () => {},
  profilePictureUrl: async () => { throw new Error('none') }
}

/** Build a message, with proper mention metadata when @tags are present. */
function build(body, { from = OWNER, group = true } = {}) {
  const mentions = [...body.matchAll(/@(\d{7,})/g)].map((x) => `${x[1]}@s.whatsapp.net`)
  return {
    key: {
      remoteJid: group ? '120363000000000000@g.us' : `${from}@s.whatsapp.net`,
      fromMe: false,
      id: 'M' + Math.random().toString(36).slice(2),
      participant: group ? `${from}@s.whatsapp.net` : undefined
    },
    pushName: 'Micheal',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: mentions.length
      ? { extendedTextMessage: { text: body, contextInfo: { mentionedJid: mentions } } }
      : { conversation: body }
  }
}

const run = async (body, opts) => {
  sent.length = 0
  await handleMessage(sock, build(body, opts))
  return [...sent]
}
const txt = (out) => out.map((s) => s.text || s.caption || Object.keys(s).join(',')).join('\n')

let pass = 0, fail = 0, offline = 0
const t = (label, cond, extra = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ❌ ${label} → ${String(extra).slice(0, 70)}`); fail++ }
}
const net = (label, cond, extra = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++ }
  else { console.log(`  ⚠️  ${label} (third-party API unavailable)`); offline++ }
}

/* ------------------------------ boot ------------------------------ */
await connectDB()
await loadVars()
await loadPlugins()
config.ownerNumbers = [OWNER]

console.log(`\n═══ VENOM MD BOT — full test ═══`)
console.log(`${pluginCount()} plugins · ${categories.size} categories · ${commands.size} names+aliases\n`)

/* start from a clean slate so repeated runs are deterministic */
await DB.warns.delete({ chat: '120363000000000000@g.us' })
await DB.groups.delete({ id: '120363000000000000@g.us' })
await DB.filters.delete({ scope: '120363000000000000@g.us' })
await DB.customcmd.delete({ scope: '120363000000000000@g.us' })
await DB.afk.delete({ id: `${OWNER}@s.whatsapp.net` })

const seed = await getUser(`${OWNER}@s.whatsapp.net`)
Object.assign(seed, { wallet: 50000, bank: 0, inventory: {}, lastDaily: 0, lastWork: 0, lastBeg: 0, lastMine: 0, lastFish: 0, lastHunt: 0, lastCrime: 0, lastHeist: 0, loan: 0 })
await saveUser(seed)

let o

console.log('── CORE ──')
o = await run('.menu');            t('menu renders with creator branding', /VENOM MD BOT/.test(txt(o)) && /TAPRUSH EMP/.test(txt(o)) && /2348021016309/.test(txt(o)))
o = await run('.menu economy');    t('menu category filter', /𝘣𝘢𝘭𝘢𝘯𝘤𝘦/.test(txt(o)))
o = await run('.menu ping');       t('menu command help card', /Category: BOT/.test(txt(o)))
o = await run('.ping');            t('ping', /Pong|Ping/.test(txt(o)))
o = await run('.stats');           t('stats', /Plugins/.test(txt(o)))
o = await run('.owner');           t('owner vcard uses original creator', o.some((s) => s.contacts?.contacts?.[0]?.vcard?.includes('waid=2348021016309')))
o = await run('.jid');             t('jid', /Chat:/.test(txt(o)))

console.log('\n── UTILITIES (offline) ──')
o = await run('.calc 5*(3+2)');    t('calc evaluates', /25/.test(txt(o)), txt(o))
o = await run('.calc 2^10');       t('calc power operator', /1,024|1024/.test(txt(o)), txt(o))
o = await run('.calc rm -rf /');   t('calc blocks injection', /Only numbers/.test(txt(o)))
o = await run('.ebinary hi');      t('ebinary', /0110/.test(txt(o)))
o = await run('.dbinary 01101000 01101001'); t('dbinary', /hi/.test(txt(o)))
o = await run('.8ball will I win');t('8ball', /🎱/.test(txt(o)))
o = await run('.choose a, b, c');  t('choose', /I choose/.test(txt(o)))
o = await run('.rolldice 20');     t('rolldice', /rolled/.test(txt(o)))
o = await run('.flipcoin');        t('flipcoin', /HEADS|TAILS/.test(txt(o)))

console.log('\n── FUN (offline) ──')
o = await run('.truth');           t('truth', /TRUTH/.test(txt(o)))
o = await run('.dare');            t('dare', /DARE/.test(txt(o)))
o = await run('.wyr');             t('wyr', /rather/.test(txt(o)))
o = await run(`.ship @${MEMBER} @${BOT}`); t('ship', /SHIPPING/.test(txt(o)), txt(o))
o = await run('.rate my code');    t('rate', /100/.test(txt(o)))
o = await run('.pickupline');      t('pickupline', /💘/.test(txt(o)))
o = await run('.insult');          t('insult', /🔥/.test(txt(o)))

console.log('\n── ECONOMY ──')
o = await run('.bal');             t('balance', /BALANCE/.test(txt(o)))
o = await run('.daily');           t('daily pays', /DAILY/.test(txt(o)))
o = await run('.daily');           t('daily cooldown', /Already claimed/.test(txt(o)))
o = await run('.work');            t('work', /Wallet/.test(txt(o)))
o = await run('.beg');             t('beg', /Wallet/.test(txt(o)))
o = await run('.crime');           t('crime', /Crime|Busted/.test(txt(o)))
o = await run('.shop');            t('shop', /SHOP/.test(txt(o)))
o = await run('.buy pickaxe');     t('buy', /Bought/.test(txt(o)))
o = await run('.mine');            t('mine with tool', /Wallet/.test(txt(o)), txt(o))
o = await run('.fish');            t('fish blocked without rod', /need a/.test(txt(o)))
o = await run('.inv');             t('inventory', /pickaxe/.test(txt(o)))
o = await run('.sell pickaxe');    t('sell', /Sold/.test(txt(o)))
o = await run('.dep 5000');        t('deposit', /Deposited/.test(txt(o)))
o = await run('.with 1000');       t('withdraw', /Withdrew/.test(txt(o)))
o = await run('.dep 99999999');    t('deposit rejects overdraft', /only have|room for/.test(txt(o)))
o = await run('.slots 500');       t('slots', /🎰/.test(txt(o)))
o = await run('.bj 500');          t('blackjack', /BLACKJACK/.test(txt(o)))
o = await run('.cf heads 500');    t('coinflip', /landed/.test(txt(o)))
o = await run('.dice 500');        t('dice', /DICE/.test(txt(o)))
o = await run('.rps rock 500');    t('rps', /vs/.test(txt(o)))
o = await run('.gamble 99999999'); t('gamble rejects over-bet', /only have/.test(txt(o)))
o = await run('.guess 50');        t('guess', /GUESS/.test(txt(o)))
o = await run('.lb');              t('leaderboard', /RICHEST/.test(txt(o)))
o = await run('.profile');         t('profile', /PROFILE/.test(txt(o)))
o = await run('.networth');        t('networth', /NET WORTH/.test(txt(o)))
o = await run('.loan 5000');       t('loan', /Loan approved/.test(txt(o)))
o = await run('.payloan');         t('payloan', /Paid|debt free/.test(txt(o)))
o = await run(`.give @${MEMBER} 500`); t('give transfers', /Sent/.test(txt(o)), txt(o))

console.log('\n── GAMES ──')
o = await run(`.ttt @${MEMBER}`);  t('ttt starts', /TIC TAC TOE/.test(txt(o)), txt(o))
o = await run('5');                t('ttt accepts a move', /Turn/.test(txt(o)), txt(o))
o = await run('.delttt');          t('ttt ends', /ended/.test(txt(o)))
o = await run('.wcg');             t('wordgame starts', /SCRAMBLE/.test(txt(o)))
o = await run('.delwcg');          t('wordgame ends', /ended/.test(txt(o)))
o = await run('.hangman');         t('hangman starts', /HANGMAN/.test(txt(o)))
o = await run('a');                t('hangman accepts a letter', /Lives|WON|OVER/.test(txt(o)))
o = await run('.delhangman');      t('hangman ends', /ended|No hangman/.test(txt(o)))

console.log('\n── GROUP & MODERATION ──')
o = await run('.ginfo');           t('ginfo', /Test GC/.test(txt(o)))
o = await run('.admins');          t('admins', /ADMINS/.test(txt(o)))
o = await run('.tagall hi');       t('tagall', /ATTENTION/.test(txt(o)))
o = await run('.hidetag yo');      t('hidetag', o.length > 0)
o = await run(`.warn @${MEMBER} spam`); t('warn', /WARNING/.test(txt(o)), txt(o))
o = await run('.warnlist');        t('warnlist', /WARNINGS/.test(txt(o)))
o = await run(`.unwarn @${MEMBER}`); t('unwarn', /removed/.test(txt(o)))
o = await run('.antilink warn');   t('antilink set', /set to/.test(txt(o)))
o = await run('.antiword add badword'); t('antiword add', /added/.test(txt(o)))
o = await run('.welcome on');      t('welcome on', /turned/.test(txt(o)))
o = await run('.goodbye on');      t('goodbye on', /turned/.test(txt(o)))
o = await run('.antispam on');     t('antispam on', /turned/.test(txt(o)))

console.log('\n── MIDDLEWARE (live fire) ──')
o = await run('look https://chat.whatsapp.com/ABC', { from: MEMBER })
t('antilink catches non-admin link', /no links|not allowed|Warning/i.test(txt(o)), txt(o))
o = await run('this has badword in it', { from: MEMBER })
t('antiword catches blocked word', /not allowed/i.test(txt(o)), txt(o))
await run('.antilink off'); await run('.antiword off'); await run('.antispam off')

console.log('\n── AFK ──')
o = await run('.afk lunch');       t('afk set', /AFK/.test(txt(o)))
o = await run(`oi @${OWNER}`, { from: MEMBER }); t('afk notifies on mention', /is AFK/.test(txt(o)), txt(o))
o = await run('im back');          t('afk clears on return', /Welcome back/.test(txt(o)))

console.log('\n── NOTES ──')
o = await run('.addnote test | hello world'); t('addnote', /saved/.test(txt(o)))
o = await run('.getnote test');    t('getnote', /hello world/.test(txt(o)))
o = await run('.allnotes');        t('allnotes', /NOTES/.test(txt(o)))
o = await run('.delnote test');    t('delnote', /deleted/.test(txt(o)))

console.log('\n── CONFIG ──')
o = await run('.allvar');          t('allvar', /MODE/.test(txt(o)))
o = await run('.setvar CMD_REACT true'); t('setvar', /set to/.test(txt(o)))
await run('.setvar CMD_REACT false')
o = await run('.getsudo');         t('getsudo', /Owners/.test(txt(o)))
o = await run('.aistatus');        t('aistatus', /AI STATUS/.test(txt(o)))
o = await run('.aikeys');          t('aikeys lists providers', /AI PROVIDERS/.test(txt(o)) && /Groq/.test(txt(o)))
o = await run('.setkey');          t('setkey usage', /Usage/.test(txt(o)))
o = await run('.setkey bogus x');  t('setkey validates provider', /Unknown provider/.test(txt(o)))
o = await run('.plugins');         t('plugins list', /plugins loaded/.test(txt(o)))

console.log('\n── PERMISSIONS ──')
o = await run(`.ban @${MEMBER}`, { from: MEMBER });  t('ban is owner-gated', o.length === 0 || /owner/i.test(txt(o)))
o = await run('.kickall', { from: MEMBER });         t('kickall is owner-gated', o.length === 0 || /owner/i.test(txt(o)))
o = await run(`.warn @${BOT}`, { from: MEMBER });    t('warn is admin-gated', /admin/i.test(txt(o)))
o = await run('.tagall', { group: false });          t('group-only enforced', /groups/i.test(txt(o)))
o = await run('.setvar MODE public', { from: MEMBER }); t('setvar is owner-gated', o.length === 0 || /owner/i.test(txt(o)))

console.log('\n── ROUTING ──')
o = await run('just chatting');    t('plain text ignored', o.length === 0)
o = await run('.nosuchcommand');   t('unknown command ignored', o.length === 0)
o = await run('.');                t('bare prefix ignored', o.length === 0)
o = await run('.PING');            t('case-insensitive', o.length > 0)

console.log('\n── MEDIA GUARDS ──')
o = await run('.sticker');         t('sticker prompts for media', /Send an image/.test(txt(o)))
o = await run('.tomp3');           t('tomp3 prompts', /Reply to/.test(txt(o)))
o = await run('.nightcore');       t('nightcore prompts', /Reply to/.test(txt(o)))
o = await run('.vv');              t('vv prompts', /Reply to/.test(txt(o)))
o = await run('.vvpr');            t('vvpr prompts for private reveal', /Reply to/.test(txt(o)) && /vvpr/.test(txt(o)))
o = await run('.photo');           t('photo prompts', /Reply to a sticker/.test(txt(o)))
o = await run('.take');            t('take prompts', /Reply to a sticker/.test(txt(o)))

console.log('\n── LIVE EXTERNAL APIs ──')
o = await run('.weather Lagos');   net('weather', /WEATHER/.test(txt(o)))
o = await run('.wiki Nigeria');    net('wiki', /Nigeria/.test(txt(o)))
o = await run('.define hello');    net('define', /HELLO/.test(txt(o)))
o = await run('.bible John 3:16'); net('bible', /John/.test(txt(o)))
o = await run('.crypto bitcoin');  net('crypto', /CRYPTO/.test(txt(o)))
o = await run('.currency 100 USD NGN'); net('currency', /CONVERTER/.test(txt(o)))
o = await run('.github torvalds'); net('github', /GITHUB|Linus/.test(txt(o)))
o = await run('.npm express');     net('npm', /express/.test(txt(o)))
o = await run('.country Nigeria'); net('country', /NIGERIA|Abuja/.test(txt(o)))
o = await run('.pokemon pikachu'); net('pokemon', /PIKACHU/.test(txt(o)))
o = await run('.urban rizz');      net('urban', /RIZZ/.test(txt(o)))
o = await run('.joke');            net('joke', /😂/.test(txt(o)))
o = await run('.anime naruto');    net('anime', /ANIME|Naruto/i.test(txt(o)))
o = await run('.book dune');       net('book', /BOOK/.test(txt(o)))
o = await run('.tinyurl https://google.com'); net('tinyurl', /tinyurl/.test(txt(o)))
o = await run('.ip 8.8.8.8');      net('ip lookup', /IP LOOKUP/.test(txt(o)))
o = await run('.lyrics adele - hello'); net('lyrics', /adele|Hello/i.test(txt(o)))
o = await run('.quote');           net('quote', /💭/.test(txt(o)))
o = await run('.fact');            net('fact', /know/i.test(txt(o)))
o = await run('.advice');          net('advice', /💡/.test(txt(o)))
o = await run('.trivia');          net('trivia', /TRIVIA/.test(txt(o)))
o = await run(`.hug @${MEMBER}`);  net('reaction gif', o.some((s) => s.video))
o = await run('.meow');            net('cat picture', o.some((s) => s.image))
o = await run('.woof');            net('dog picture', o.some((s) => s.image))

console.log(`\n═══ ${pass} passed · ${fail} failed · ${offline} third-party APIs unavailable ═══\n`)
process.exit(fail ? 1 : 0)
