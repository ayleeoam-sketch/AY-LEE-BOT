# VENOM MD BOT

**by TAPRUSH EMP (Micheal)**

A modular, plugin-driven WhatsApp bot on **Baileys v7**.

**Status: 464 plugins · 23 categories · 810 command names · 179 tests passing · verified against live WhatsApp servers.**

Covers **93% of the original 380-command menu** (334/360 verified present).

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

| Category | Commands | Highlights |
|---|---|---|
| **FUN** | 58 | 43 anime reaction GIFs (`hug` `slap` `kiss` `dance`…), `ship`, `truth`, `dare`, `emojimix`, `pokemon`, animal pics |
| **TEXTMAKER** | 48 | 47 text effects rendered locally — `neonlight` `hacker` `glitch` `galaxy` `fire` `gaming` `zodiac`… |
| **GROUP** | 40 | `kick` `add` `promote` `demote` `mute` `tagall` `warn` `antilink` `antiword` `antispam` `welcome` `goodbye` |
| **ECONOMY** | 38 | `daily` `work` `mine` `fish` `hunt` `crime` `rob` `heist`, banking, loans, shop, `slots` `blackjack` `dice`, `tax` |
| **CONVERTER** | 34 | `sticker` `take` `photo` `mp4` `gif` `tomp3` `ptv` `circlestk` `black` `exif` `doc` `aitts` + 18 audio effects |
| **UTILITIES** | 32 | `weather` `wiki` `define` `bible` `calc` `tts` `ip` `tinyurl` `ss` `qrcode` `readqr` `wm` `pdf` `url` `font` `ngl`, notes |
| **CONFIG** | 28 | `setvar` `getvar` `allvar` `mode` `setsudo` `antidelete` `antiedit` `readstatus` `savecmd` `vvcmd` |
| **IMAGE-MEME** | 28 | `wanted` `jail` `drip` `drake` `pooh` `oogway` `wasted` `rip-meme` `triggered` `rainbow` `stonks` `carbon` |
| **DOWNLOADER** | 19 | `play` `video` `tiktok` `instagram` `facebook` `twitter` `autodl` `playdoc` `gitclone` `mediafire` `gdrive` `apk` |
| **USER** | 18 | `pp` `setpp` `setname` `bio` `block` `blocklist` `forward` `archive` `pinchat` `jid` |
| **AI** | 22 | 8 providers with failover — `ai` `gpt` `gemini` `groq` `deepseek` `cerebras` `openrouter` `mistral` `cohere`, plus `coder` `reasoning` `chatbot` `aikeys` `setkey` `aistatus` `imagine` |
| **TOOLS** | 15 | `afk` `msgs` `listonline` `listoffline` `setcmd` `delcmd` `permit` `areact` `element` |
| **BOT** | 14 | `ping` `stats` `owner` `uptime` `ban` `unban` `banlist` `repo` `ignore` |
| **SEARCH** | 11 | `websearch` `img` `wallpaper` `github` `npm` `lyrics` `country` `book` `urban` `subtitle` `shazam` |
| **ANIME** | 10 | `anime` `manga` `character` `airing` `animerec` `animequote` `animegif` `reactions` `waifu` `animenews` |
| **IMAGE** | 10 | 11 local sharp filters — `grey` `sepia` `sharpen` `flipv` `negate` `pixelate` `blur2` `compress` `imageinfo` |
| **MISC** | 10 | `quote` `fact` `advice` `8ball` `choose` `ebinary` `dbinary` `q` |
| **GAME** | 8 | `ttt` `hangman` `wcg` `trivia` `guess` |
| **PRIVACY** | 8 | `lastseen` `online` `mypp` `mystatus` `read` `allow-gcadd` `privacy` |
| **AUTOREPLY** | 5 | `pfilter` `pstop` `gfilter` `gstop` `listfilters` |
| **PLUGINS** | 4 | `plugin` `plugins` `reload` `remove` |
| **PROCESS** | 3 | `restart` `shutdown` `pstatus` |
| **HELP** | 1 | `menu` — the full styled command list |
| **Total** | **464** | across 23 categories, 810 names including aliases |

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

## Session ID (skip the QR entirely)

A companion web app generates session IDs so the bot can start already
authenticated — useful on Render, Pterodactyl, or anywhere without a terminal.

1. Deploy `session-site/` (see its README — one click on Render).
2. Open it, link with QR or a pairing code.
3. Copy the session ID into `.env`:

```env
SESSION_ID=eyJub2lzZUtleSI6...
```

The bot decodes it at boot and connects with no QR. Invalid values are
rejected with a clear log line and it falls back to normal login.

---

## Testing

```bash
node test/fulltest.js     # 124 assertions, offline + live APIs
node test/selftest.js     # quick 31-assertion smoke test
node test/dltest.js       # 21 downloader assertions (fast)
node test/dltest.js --full  # + real YouTube/TikTok downloads (~3 min)
```

All three are deterministic — the suites reset their own DB state, so repeated
runs give identical results.

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
- **AI needs a key now.** The bot ships with 8 providers and automatic
  failover, but the keyless fallback it used to rely on (Pollinations' legacy
  text API) started returning `402 Payment Required` in 2026, and DuckDuckGo's
  free chat endpoint now demands a browser challenge. Free keyless AI is
  effectively over. The good news: **Groq and Gemini are both genuinely free**
  and take two minutes to set up.

  | Provider | Free tier | Get a key |
  |---|---|---|
  | **Groq** | Yes, generous — fastest | https://console.groq.com/keys |
  | **Gemini** | Yes, very capable | https://aistudio.google.com/apikey |
  | **Cerebras** | Yes, fastest inference | https://cloud.cerebras.ai |
  | **OpenRouter** | Yes, many `:free` models | https://openrouter.ai/keys |
  | **Mistral** | Free experiment tier | https://console.mistral.ai/api-keys |
  | **Cohere** | Free trial | https://dashboard.cohere.com/api-keys |
  | **DeepSeek** | Paid, very cheap | https://platform.deepseek.com/api_keys |
  | **OpenAI** | Paid | https://platform.openai.com/api-keys |

  Add keys to `.env`, or set them from WhatsApp with `.setkey groq gsk_xxx` —
  that command deletes your message immediately and verifies the key with a
  real call before confirming. `.aikeys` lists every provider, `.aistatus`
  latency-tests the ones you have configured.
- **Third-party APIs rot.** Every network command has multi-source failover and a clear error message instead of a crash, but expect to swap an endpoint occasionally. `restcountries` was already dead during the build and was replaced with World Bank + countriesnow.
- **Textmaker is rendered locally, not scraped.** ephoto360 and textpro.me both
  now block automated form submission — every request returns
  `{"success":false,"code":-1}`. Rather than ship 45 dead commands, the 47
  effects are drawn with SVG + sharp: instant, offline, and impossible to break
  from outside.
- **Still missing (26 of the original 380, ~7%):** the `gfx1-12` photo
  templates, `remini` upscaler and `naturewlp` all need paid AI image services
  (Replicate, Picsart or similar) — there is no free provider left that works.
  `shazam` needs an AudD/ACRCloud key, `audio2text` needs an OpenAI key, and
  `subtitle` returns search links because every subtitle site blocks automated
  downloads. Each becomes a ~30-line plugin the moment you supply a key.
- **Screenshots, QR, memes and PDF are all local or keyless.** `.ss` uses
  thum.io with a microlink fallback and refuses private/internal addresses
  (SSRF guard). `.qrcode`/`.readqr` run entirely offline. The meme overlays and
  `.carbon` are drawn with sharp + SVG. `.pdf` hand-builds a valid PDF —
  verified with a real parser (single A4 page, embedded DCTDecode JPEG).
- Keep `.env` out of Git — `.gitignore` covers it plus `session/`, `data/`, `tmp/`.
- This is an unofficial library. Don't spam; WhatsApp bans numbers for bulk unsolicited messaging. Test with a spare SIM first.
