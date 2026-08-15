# VENOM MD BOT

**by TAPRUSH EMP (Micheal)**

A modular, plugin-driven WhatsApp bot on **Baileys v7**.

**Status: 246 plugins · 19 categories · 400+ commands+aliases · 151 tests passing · verified against live WhatsApp servers.**

---

## Quick start

```bash
cd wa-bot
npm install             # also fetches yt-dlp automatically
cp .env.example .env    # your details are already filled in
npm start
```

If the downloader engine ever needs refreshing (YouTube changes often):

```bash
npm run setup
```

Scan the QR in the terminal: **WhatsApp → Settings → Linked devices → Link a device**.

On a panel with no scannable terminal, use the pairing code instead:

```bash
npm run pair
```

Enter the 8-digit code under **Link with phone number**.

---

## Command categories

| Category | Count | Highlights |
|---|---|---|
| **FUN** | 60 | 43 anime reaction GIFs (`hug` `slap` `kiss` `dance`…), `ship`, `truth`, `dare`, `emojimix`, `pokemon`, animal pics |
| **ECONOMY** | 36 | `daily` `work` `mine` `fish` `hunt` `crime` `rob` `heist`, banking, loans, shop + inventory, `slots` `blackjack` `dice` `rps`, leaderboards |
| **CONVERTER** | 26 | `sticker` `take` `photo` `mp4` `gif` `tomp3` `tovn` `ptv` + 18 audio effects (`bass` `nightcore` `8d` `reverse`…) |
| **DOWNLOADER** | 11 | `play` `video` `ytsearch` `ytinfo` `tiktok` `ttmp3` `instagram` `facebook` `twitter` `autodl` `dlstatus` |
| **GROUP** | 25 | `kick` `add` `promote` `demote` `mute` `tagall` `warn` `antilink` `antiword` `antispam` `welcome` `goodbye` `kickall` |
| **UTILITIES** | 16 | `weather` `wiki` `define` `bible` `calc` `tts` `crypto` `currency` `ip` `tinyurl`, notes system |
| **USER** | 12 | `pp` `setpp` `setname` `bio` `block` `blocklist` `forward` `archive` |
| **AI** | 10 | `ai` `gpt` `gemini` `coder` `translate` `summarize` `grammar` `imagine` |
| **CONFIG** | 9 | `setvar` `getvar` `allvar` `mode` `setsudo` `antidelete` |
| **MISC** | 9 | `quote` `fact` `advice` `8ball` `choose` `ebinary` |
| **GAME** | 8 | `ttt` `hangman` `wcg` `trivia` `guess` |
| **BOT / SEARCH / TOOLS / PLUGINS / PROCESS / ANIME / HELP / PRIVACY** | 24 | `ping` `stats` `owner` `ban`, `github` `npm` `lyrics` `country` `book` `urban`, `afk` `vv` `hidetag`, `plugin` `reload` |

Type `.menu` for the full list, `.menu <category>` for one section, `.menu <command>` for a help card.

---

## Architecture

| File | Role |
|---|---|
| `index.js` | Boot: DB → vars → plugins → socket. Crash-resistant, clean shutdown. |
| `src/connection.js` | QR + pairing login, backoff reconnect, group cache, call rejection, event fan-out. |
| `src/handler.js` | Prefix parsing, permission gates, cooldowns, mode gating, ban checks. |
| `src/lib/serialize.js` | Flattens any message shape into one clean `m` object. |
| `src/lib/pluginLoader.js` | Recursive auto-discovery + hot reload. |
| `src/lib/database.js` | MongoDB with automatic JSON fallback. |
| `src/lib/mongoAuth.js` | Session in Mongo — **survives Pterodactyl redeploys**. |
| `src/lib/media.js` | Bundled ffmpeg: stickers, EXIF, audio FX, PTV. |
| `src/lib/api.js` | HTTP helper with multi-source failover. |
| `src/lib/economy.js` | Shared economy state, items, cooldowns, XP. |
| `src/lib/vars.js` | Runtime config persisted to DB. |
| `test/fulltest.js` | 124 assertions across every subsystem. |

---

## Writing a plugin

Drop a file under `plugins/`. Picked up on the next `.reload` — no restart.

```js
// plugins/fun/myplugin.js
export default {
  name: 'hello',
  alias: ['hi'],
  category: 'FUN',        // becomes a menu section automatically
  desc: 'Say hello',
  usage: '.hello',
  cooldown: 5,            // seconds, per user
  owner: false,           // owner/sudo only
  admin: false,           // group admins only
  botAdmin: false,        // bot must be admin
  group: false,           // groups only
  private: false,         // DM only
  hidden: false,          // hide from .menu

  async run({ sock, m, args, text, command, prefix, config, DB, getVar }) {
    await m.reply(`Hello ${m.pushName}!`)
  }
}
```

Export an **array** for several commands in one file.

### The `m` object

```js
m.body / m.text     // text of any message type
m.chat  m.sender  m.senderNumber  m.pushName
m.isGroup  m.isOwner  m.isSudo  m.isAdmin  m.isBotAdmin
m.groupName  m.groupMetadata  m.participants
m.mentions          // tagged jids
m.quoted            // { text, sender, type, download(), key } or null
await m.reply('hi')                     // reply quoting the user
await m.send('hi')                      // send without quoting
await m.react('🔥')
const buf  = await m.download()         // this message's media
const buf2 = await m.quoted.download()  // the replied-to media
```

### Hooks

```js
export default {
  name: 'watcher', category: 'TOOLS', desc: '...',
  async run({ m }) {},
  async before({ sock, m }) { return false },        // every message; true = stop
  async onGroupUpdate({ sock, event, metadata }) {}, // joins / leaves
  async onDelete({ sock, key, messageStore }) {}     // anti-delete
}
```

---

## Runtime configuration

No redeploy needed — values persist in the database:

```
.setvar MODE private      .allvar         .getvar MODE
.setvar AUTO_READ true    .delvar MODE    .mode public
```

Keys: `PREFIX` `MODE` `AUTO_READ` `AUTO_READ_STATUS` `AUTO_TYPING` `ALWAYS_ONLINE` `REJECT_CALL` `ANTI_DELETE` `STARTUP_MESSAGE` `CMD_REACT` `CMD_REACT_EMOJI` `BOT_NAME` `OWNER_NAME` `USER_TAG`

**Modes:** `public` · `private` (owner only) · `group` · `inbox`
**Prefix:** one character, `multi` (`. / ! # $ ,`), or `none`.

---

## Deploying on Pterodactyl

1. Upload the folder (skip `node_modules`) or point the panel at your Git repo.
2. **Startup:** `npm start` · **Node:** 20+
3. Set `MONGO_URI` and `SESSION_STORE=mongo` — this is what stops redeploys logging the bot out.
4. Link once with `AUTH_METHOD=pair`, then switch back to `qr`.

ffmpeg is bundled via `ffmpeg-static` — no system install needed for stickers or audio.

---

## Testing

```bash
node test/fulltest.js     # 124 assertions, offline + live APIs
node test/selftest.js     # quick 31-assertion smoke test
node test/dltest.js       # 21 downloader assertions (fast)
node test/dltest.js --full  # + real YouTube/TikTok downloads (~3 min)
```

The suite drives real commands through the real handler against a mock socket, and reports third-party API outages separately so an external failure never looks like a bug in your code. Run it after adding plugins.

---

## Downloaders — what works and why

Findings from testing every route live, rather than assuming:

| Platform | Status | How |
|---|---|---|
| **YouTube** | ✅ Working, keyless | `yt-dlp` with the `android_vr` player client |
| **TikTok** | ✅ Working, no watermark | tikwm JSON API, `yt-dlp` as fallback |
| **Twitter/X, Facebook** | ✅ Working | `yt-dlp` (public posts) |
| **1800+ other sites** | ✅ Working | `.autodl <link>` |
| **Instagram** | ⚠️ Needs cookies | See below |

**Three real obstacles I hit and solved:**

1. **YouTube's pre-muxed stream (format 18) returns HTTP 403 from server IPs.** Most player clients (`web`, `ios`, `tv`, `mweb`) refuse to list formats at all. Only `android_vr` works — and then only with *separate* DASH video+audio merged by ffmpeg. That combination is what the code uses.

2. **YouTube throttles bursts from one IP.** A single download nearly always works; the second or third in quick succession gets a 403. Fixed with a serialising queue (6s gap), client rotation, format cycling, and exponential retry. Measured: a burst that failed 1-in-4 now passes 6/6.

3. **Instagram genuinely requires a login session.** yt-dlp returns "empty media response", the GraphQL endpoint 403s, `?__a=1` is dead, and the public scraper sites are IP-blocked or rate-limited. I tested nine routes — none work anonymously from a server.

**To enable Instagram:** install the *Get cookies.txt LOCALLY* browser extension, log into Instagram, export cookies, and save the file as `cookies.txt` in the bot folder. The bot picks it up automatically (`.dlstatus` confirms). The same file also unlocks private/age-restricted YouTube and Facebook content.

Without it, `.instagram` fails with that exact instruction rather than a vague error.

**Size limits:** audio capped at 30 min, video at 15 min and 64MB (WhatsApp's ceiling). Use `.video <link> 240` for a smaller file.

---

## Notes & honest limitations

- **Baileys v7 is ESM-only** — use `import`, not `require`. `printQRInTerminal` was removed; the QR is rendered from the `connection.update` event.
- **AI commands** work keyless through a free fallback, but it rate-limits. Add `OPENAI_API_KEY` or `GEMINI_API_KEY` to `.env` for reliable results (`.aistatus` shows what's configured).
- **Third-party APIs rot.** Every network command has multi-source failover and a clear error message instead of a crash, but expect to swap an endpoint occasionally. `restcountries` was already dead during the build and was replaced with World Bank + countriesnow.
- **Not yet built**: textmaker image effects and screenshot tools. The plugin template makes each a ~30-line file when you find a working provider.
- Keep `.env` out of Git — `.gitignore` covers it plus `session/`, `data/`, `tmp/`.
- This is an unofficial library. Don't spam; WhatsApp bans numbers for bulk unsolicited messaging. Test with a spare SIM first.
