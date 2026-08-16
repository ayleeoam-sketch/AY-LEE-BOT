<!-- VENOM MD BOT — by TAPRUSH EMP (Micheal) -->

<div align="center">

<img src="assets/menu.jpg" width="100%" style="border-radius:12px;" />

<br/>

[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Orbitron&weight=900&size=22&duration=3000&pause=800&color=8A2BE2&center=true&vCenter=true&width=600&lines=%E2%9A%A1+VENOM+MD+BOT;BUILT+BY+TAPRUSH+EMP+%F0%9F%87%B3%F0%9F%87%AC;464+PLUGINS+%C2%B7+23+CATEGORIES;FORK+%26+DEPLOY+IN+MINUTES)](https://git.io/typing-svg)

<br/>

[![GitHub](https://img.shields.io/badge/MykelGoal-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/MykelGoal)
[![Baileys](https://img.shields.io/badge/Baileys-v7-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://www.npmjs.com/package/baileys)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Session ID](https://img.shields.io/badge/Get%20Session%20ID-5500ff?style=for-the-badge&logo=key&logoColor=white)](https://session-site-2odn.onrender.com)

<br/>

[![Stars](https://img.shields.io/github/stars/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2&label=Stars)](https://github.com/MykelGoal/VENOM-MD-BOT/stargazers)
[![Forks](https://img.shields.io/github/forks/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2&label=Forks)](https://github.com/MykelGoal/VENOM-MD-BOT/network/members)
[![Watchers](https://img.shields.io/github/watchers/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2&label=Watchers)](https://github.com/MykelGoal/VENOM-MD-BOT/watchers)
[![Repo Size](https://img.shields.io/github/repo-size/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2)](https://github.com/MykelGoal/VENOM-MD-BOT)
[![License](https://img.shields.io/badge/License-MIT-8A2BE2?style=flat-square)](LICENSE)

</div>

---

## 🐍 What is VENOM MD?

**VENOM MD** is a modular, plugin-driven WhatsApp bot built on **Baileys v7** — engineered for speed, clean code, and honest documentation. Every command is auto-discovered from `plugins/`, hot-reloadable, and audited live. Maintained by **TAPRUSH EMP (Micheal) 🇳🇬**.

<div align="center">

| 🔌 Plugins | 🗂️ Categories | ⌨️ Command Names | ✅ Broken |
|:---:|:---:|:---:|:---:|
| **464** | **23** | **810** | **0** |

</div>

---

## ⚡ Quick Deploy

<div align="center">

| Platform | Deploy |
|----------|--------|
| **Render** | [![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://dashboard.render.com/web/new) |
| **Koyeb** | [![Koyeb](https://img.shields.io/badge/Deploy-Koyeb-FF009D?style=for-the-badge&logo=koyeb&logoColor=white)](https://app.koyeb.com/services/deploy?type=git&repository=MykelGoal/VENOM-MD-BOT) |
| **Railway** | [![Railway](https://img.shields.io/badge/Deploy-Railway-FF8700?style=for-the-badge&logo=railway&logoColor=white)](https://railway.app/new) |
| **Heroku** | [![Heroku](https://img.shields.io/badge/Deploy-Heroku-430098?style=for-the-badge&logo=heroku&logoColor=white)](https://dashboard.heroku.com/new?template=https://github.com/MykelGoal/VENOM-MD-BOT) |
| **Panel/ZIP** | [![ZIP](https://img.shields.io/badge/Download-ZIP-CC00FF?style=for-the-badge&logo=files&logoColor=white)](https://github.com/MykelGoal/VENOM-MD-BOT/archive/refs/heads/main.zip) |

</div>

---

## 🛠️ Manual Deployment

```bash
# 1. Clone the repo
git clone https://github.com/MykelGoal/VENOM-MD-BOT
cd VENOM-MD-BOT

# 2. Install dependencies
npm install

# 3. Fetch yt-dlp (downloaders)
npm run setup

# 4. Configure your environment
cp .env.example .env
#    → set OWNER_NUMBER and OWNER_NAME

# 5. Start the bot
npm start
```

> ⚠️ Minimum required in `.env`:
>
> ```env
> OWNER_NUMBER=2348012345678     # digits only, no + or spaces
> OWNER_NAME=Your Name
> ```

**Strongly recommended** — both are free and take two minutes:

```env
MONGO_URI=mongodb+srv://...    # free tier, never sleeps
GROQ_API_KEY=gsk_...           # makes every AI command fast
```

Neither is required — the bot falls back to JSON files and a keyless AI endpoint. Set a key without touching a file: `.setkey groq gsk_xxxxx`

---

## 🔑 Session ID (skip the QR)

<div align="center">

[![Session ID](https://img.shields.io/badge/GENERATE%20SESSION%20ID-session--site-5500ff?style=for-the-badge&logo=key&logoColor=white)](https://session-site-2odn.onrender.com)

**Generator:** <https://session-site-2odn.onrender.com>

</div>

<details>
<summary><b>How it works</b></summary>

<br/>

The session generator produces a session ID so the bot starts already authenticated — useful on Render, Pterodactyl, or anywhere without a terminal.

1. Open **<https://session-site-2odn.onrender.com>** (it runs on Render's free tier, so the first load can take ~30 s to wake up).
2. Choose **QR code** or **8-digit pairing code**. For pairing, enter your number with country code, digits only — e.g. `2348012345678`.
3. On your phone: **WhatsApp → Linked devices → Link a device**, then scan the QR or type the pairing code.
4. Copy the session ID into `.env`:

```env
SESSION_ID=eyJub2lzZUtleSI6...
```

The bot decodes it at boot and connects with no QR. Invalid values are rejected with a clear log line and it falls back to normal login.

> ⚠️ **Treat your session ID like a password.** Anyone holding it controls your WhatsApp account — never post it publicly, commit it to Git, or share it in chats.

</details>

---

## 📋 Command Categories

<div align="center">

| Category | # | Highlights |
|:---|:---:|:---|
| **FUN** | 58 | 43 anime reaction GIFs (`hug` `slap` `kiss` `dance`…), `ship`, `truth`, `dare`, `emojimix`, `pokemon` |
| **TEXTMAKER** | 48 | 47 text effects rendered locally — `neonlight` `hacker` `glitch` `galaxy` `fire` `gaming` `zodiac` |
| **GROUP** | 42 | `poll` `vcf` `kick` `add` `promote` `demote` `mute` `tagall` `warn` `antilink` `antiword` `welcome` |
| **ECONOMY** | 38 | `daily` `work` `mine` `fish` `hunt` `crime` `rob` `heist`, banking, loans, shop, `slots` `blackjack` |
| **CONVERTER** | 39 | `sticker` `take` `photo` `mp4` `gif` `tomp3` `ptv` `circlestk` `exif` `doc` + 17 audio effects + `boomerang` `vidfast` `vidslow` `vidreverse` `smooth` |
| **UTILITIES** | 35 | `tempmail` `tempinbox` `quran` `praytimes` `weather` `wiki` `define` `bible` `calc` `tts` `tinyurl` `ss` `pdf` |
| **CONFIG** | 29 | `setvar` `getvar` `allvar` `mode` `forcejoin` `setsudo` `antidelete` `antiedit` `readstatus` `savecmd` |
| **IMAGE-MEME** | 29 | `fakechat` `wanted` `jail` `drip` `drake` `pooh` `oogway` `wasted` `triggered` `stonks` `carbon` |
| **AI** | 22 | 8 providers with failover — `ai` `gpt` `gemini` `groq` `deepseek` `cerebras` `imagine` |
| **DOWNLOADER** | 24 | `play` `music` `sc` `audiomack` `video` `spotify` `spotifyinfo` `tiktok` `instagram` `facebook` `twitter` `autodl` `gitclone` `mediafire` `apk` |
| **USER** | 20 | `pp` `setpp` `setname` `bio` `block` `blocklist` `forward` `archive` `pinchat` `jid` `rank` `topranks` |
| **TOOLS** | 17 | `snipe` `editsnipe` `afk` `msgs` `listonline` `listoffline` `setcmd` `permit` `areact` `element` |
| **BOT** | 14 | `ping` `stats` `owner` `uptime` `ban` `unban` `banlist` `repo` `ignore` |
| **SEARCH** | 13 | `news` `tvshow` `websearch` `img` `wallpaper` `github` `npm` `lyrics` `country` `urban` `shazam` |
| **ANIME** | 10 | `anime` `manga` `character` `airing` `animerec` `animequote` `waifu` `animenews` |
| **IMAGE** | 12 | `enhance` `couple` + local sharp filters — `grey` `sepia` `sharpen` `negate` `pixelate` `compress` |
| **MISC** | 10 | `quote` `fact` `advice` `8ball` `choose` `ebinary` `dbinary` `q` |
| **GAME** | 8 | `ttt` `hangman` `wcg` `trivia` `guess` |
| **PRIVACY** | 8 | `lastseen` `online` `mypp` `mystatus` `read` `allow-gcadd` `privacy` |
| **AUTOREPLY** | 5 | `pfilter` `pstop` `gfilter` `gstop` `listfilters` |
| **PLUGINS** | 4 | `plugin` `plugins` `reload` `remove` |
| **PROCESS** | 3 | `restart` `shutdown` `pstatus` |
| **HELP** | 1 | `menu` — the full styled command list |
| **Total** | **464** | across 23 categories · 810 names including aliases |

</div>

> 💡 Type `.menu` for the full list · `.menu <category>` for one section · `.menu <command>` for a help card.

---

## 🧩 Writing a Plugin

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

<details>
<summary><b>The <code>m</code> object</b></summary>

<br/>

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

</details>

<details>
<summary><b>Hooks</b></summary>

<br/>

```js
export default {
  name: 'watcher', category: 'TOOLS', desc: '...',
  async run({ m }) {},
  async before({ sock, m }) { return false },        // every message; true = stop
  async onGroupUpdate({ sock, event, metadata }) {}, // joins / leaves
  async onDelete({ sock, key, messageStore }) {}     // anti-delete
}
```

</details>

---

## 🏗️ Architecture

<details>
<summary><b>File map</b></summary>

<br/>

| File | Role |
|:---|:---|
| `index.js` | Boot: DB → vars → plugins → socket. Crash-resistant, clean shutdown. |
| `src/connection.js` | QR + pairing login, backoff reconnect, group cache, call rejection. |
| `src/handler.js` | Prefix parsing, permission gates, cooldowns, mode gating, ban checks. |
| `src/lib/serialize.js` | Flattens any message shape into one clean `m` object. |
| `src/lib/pluginLoader.js` | Recursive auto-discovery + hot reload. |
| `src/lib/database.js` | MongoDB with automatic JSON fallback. |
| `src/lib/mongoAuth.js` | Session in Mongo — **survives Pterodactyl redeploys**. |
| `src/lib/media.js` | Bundled ffmpeg: stickers, EXIF, audio FX, PTV. |
| `src/lib/api.js` | HTTP helper with multi-source failover. |
| `src/lib/economy.js` | Shared economy state, items, cooldowns, XP. |
| `src/lib/vars.js` | Runtime config persisted to DB. |
| `src/lib/keepalive.js` | Tiny HTTP health server — lets UptimeRobot keep Render awake. |
| `test/fulltest.js` | 124 assertions across every subsystem. |

</details>

---

## 🗄️ Database

<details>
<summary><b>MongoDB setup (recommended)</b></summary>

<br/>

Your data is document-shaped — nested inventories, per-group flag sets that plugins extend freely — which Mongo stores natively with no migrations. Atlas's free M0 tier never sleeps.

1. Create a free **M0** cluster at <https://cloud.mongodb.com>
2. **Database Access** → add a user, copy the password
3. **Network Access** → allow `0.0.0.0/0` (your host's IP is not fixed)
4. **Connect → Drivers** → copy the connection string

```env
MONGO_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGO_DB=venom
```

If the password contains `@ : / ? # [ ] %`, URL-encode it — otherwise the driver misreads the URI.

**No `MONGO_URI`?** The bot writes JSON files to `./data` and boots fine. Good for local testing, but most free hosts wipe the disk on redeploy, so you would lose economy balances and group settings.

`.stats` shows which backend is live.

</details>

---

## ⚙️ Runtime Configuration

No redeploy needed — values persist in the database:

```
.setvar MODE private      .allvar         .getvar MODE
.setvar AUTO_READ true    .delvar MODE    .mode public
```

**Keys:** `PREFIX` `MODE` `AUTO_READ` `AUTO_READ_STATUS` `AUTO_TYPING` `ALWAYS_ONLINE` `REJECT_CALL` `ANTI_DELETE` `STARTUP_MESSAGE` `CMD_REACT` `CMD_REACT_EMOJI` `BOT_NAME` `OWNER_NAME` `USER_TAG`

**Modes:** `public` · `private` (owner only) · `group` · `inbox`
**Prefix:** one character, `multi` (`. / ! # $ ,`), or `none`

<details>
<summary><b>Command reactions</b></summary>

<br/>

Every command reacts so you can see it was received, even before the reply arrives:

| Reaction | Meaning |
|:---:|:---|
| ⚡ | command accepted, now running |
| ✅ | finished successfully |
| ❌ | failed — the reply explains why |
| 🚫 | refused (wrong chat type, or you lack permission) |
| ⏳ | on cooldown |

Slow commands (downloads, image generation) show their own progress emoji instead — `.play` reacts ⏳ then ✅, and the handler does not override it.

Turn it off with `.setvar CMD_REACT false`, or change the trigger emoji with `.setvar CMD_REACT_EMOJI 🔥`.

</details>

---

## 🔒 Support-Group Gate (`.forcejoin`)

Users must join your WhatsApp support group before the bot will answer their commands — and if they leave, the bot pulls them back in.

| Behaviour | What happens |
|:---|:---|
| **Gate on** (`FORCE_JOIN=true`, default) | Commands only answer support-group members. Only real commands are intercepted — plain chat passes through. Owner + sudo are always exempt. |
| **Auto-add** (`FORCE_AUTOADD=true`, default) | The moment a non-member runs a command, the bot **adds them into the group** and the command runs normally. If WhatsApp refuses the add (their privacy blocks it, bot not admin…), they get an *ACCESS LOCKED* card with the invite link instead. |
| **Auto re-add** (`FORCE_READD=true`, default) | Anyone who leaves the support group is pulled back (10-minute per-user cooldown so it never wars) with a DM explaining why. If their privacy blocks adds, they're DMed the link instead. |
| **Fail-open** | If the invite link breaks or the bot can't read the group, commands keep working — check the state with `.forcejoin`. |

**Setup (3 steps):**

1. Add the **bot's number** to the support group and make it an **admin** (admin is required for re-add).
2. Set `SUPPORT_GROUP_LINK` in `.env` (or live: `.forcejoin link https://chat.whatsapp.com/XXXX`).
3. `.forcejoin` shows the status card: gate state, member count, and whether the bot is admin enough to re-add.

Manage everything from WhatsApp: `.forcejoin on | off`, `.forcejoin autoadd on | off`, `.forcejoin readd on | off`, `.forcejoin link <url>`, `.forcejoin check @user`.

---

## 🚀 Hosting

<details>
<summary><b>Render — and keeping it awake 24/7</b></summary>

<br/>

Render's free tier sleeps after ~15 minutes with no inbound traffic. A WhatsApp bot never receives HTTP traffic on its own, so it naps — and while it naps it can't answer messages. Two-part fix:

1. **Run as a Web Service, not a background worker.** Workers have no public URL, so nothing can ping them. A Web Service gets `https://your-bot.onrender.com` and Render injects a `PORT`.
2. **This bot already runs a keep-alive HTTP server** (`src/lib/keepalive.js`), enabled by default. It answers `200 OK` on `/` with a small JSON status.

**Step by step**

1. On Render: **New → Web Service**, connect the Git repo.
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Runtime:** Node 20+
2. Add env vars — at minimum `OWNER_NUMBER`. Set a [`SESSION_ID`](https://session-site-2odn.onrender.com) to skip the QR — there is no terminal on Render to scan one, so generate the session ID first. Set `MONGO_URI` so data and session survive redeploys. Leave `PORT` alone — Render sets it.
3. Deploy, then open `https://your-bot.onrender.com`:
   ```json
   { "ok": true, "name": "VENOM MD BOT", "connected": true }
   ```
4. Free **UptimeRobot** account → **New monitor** → HTTP(s), your URL, every 5 minutes. That ping counts as traffic, so Render never sleeps.

Alternatives: [cron-job.org](https://cron-job.org), [Better Uptime](https://betterstack.com), or a GitHub Actions workflow that curls the URL.

**Troubleshooting**

- **"Deploy failed, port not listening"** — the bot binds `0.0.0.0:$PORT`. Check logs for a keep-alive bind error.
- **Bot disconnects right after waking** — a sleeping instance takes seconds to re-open the socket. The 5-minute ping prevents this; drop to 1 minute if needed.

</details>

<details>
<summary><b>Pterodactyl</b></summary>

<br/>

1. Upload the folder (skip `node_modules`) or point the panel at your Git repo.
2. **Startup:** `npm start` · **Node:** 20+
3. Set `MONGO_URI` and `SESSION_STORE=mongo` — this is what stops redeploys logging the bot out.
4. Link once with `AUTH_METHOD=pair`, then switch back to `qr`.

ffmpeg is bundled via `ffmpeg-static` — no system install needed for stickers or audio.

</details>

---

## 🧪 Testing

```bash
node test/fulltest.js       # 124 assertions, offline + live APIs
node test/selftest.js       # quick smoke test
node test/dltest.js         # downloader assertions (fast)
node test/dltest.js --full  # + real YouTube/TikTok downloads (~3 min)
```

Tests never touch your production database. `test/_isolate.js` is imported first by every suite and strips `MONGO_URI`, so fixtures go to JSON files in `./data`. Run against the real cluster deliberately with `--live-db`.

<details>
<summary><b>Live command audit — all 464 dispatched through the real handler</b></summary>

<br/>

| Result | Count |
|:---|:---:|
| Fully working | 354 |
| Correct guard (needs media, a key, or an argument) | 79 |
| Skipped as destructive (`restart`, `kickall`, `logout`…) | 26 |
| **Broken** | **0** |
| Responded without a reaction | **0** |

All suites are deterministic — they reset their own DB state, so repeated runs give identical results. Third-party API outages are reported separately so an external failure never looks like a bug in your code.

</details>

---

## 📥 Downloaders

<div align="center">

| Platform | Status | How |
|:---|:---:|:---|
| **YouTube** | ✅ Keyless | `yt-dlp` with the `android_vr` player client |
| **SoundCloud** | ✅ Keyless | `.music` / `.sc` - no bot-check, works from server IPs |
| **Audiomack** | ✅ Keyless | `.music` / `.audiomack` - search + track links |
| **Spotify** | ✅ Keyless | metadata via oEmbed/JSON-LD, audio matched on any source |
| **TikTok** | ✅ No watermark | tikwm JSON API, `yt-dlp` fallback |
| **Twitter/X, Facebook** | ✅ Working | `yt-dlp` (public posts) |
| **1800+ other sites** | ✅ Working | `.autodl <link>` |
| **Instagram** | ⚠️ Needs cookies | See below |

</div>

<details>
<summary><b>Three real obstacles I hit and solved</b></summary>

<br/>

1. **YouTube's pre-muxed stream (format 18) returns HTTP 403 from server IPs.** Most player clients (`web`, `ios`, `tv`, `mweb`) refuse to list formats at all. Only `android_vr` works — and then only with *separate* DASH video+audio merged by ffmpeg. That combination is what the code uses.

2. **YouTube throttles bursts from one IP.** A single download nearly always works; the second or third in quick succession gets a 403. Fixed with a serialising queue (6s gap), client rotation, format cycling, and exponential retry. Measured: a burst that failed 1-in-4 now passes 6/6.

3. **Instagram genuinely requires a login session.** yt-dlp returns "empty media response", the GraphQL endpoint 403s, `?__a=1` is dead, and public scraper sites are IP-blocked. I tested nine routes — none work anonymously from a server.

4. **A YouTube bot-check should not kill a song request.** When YouTube refuses, `.play` now falls back automatically: the same song is searched on **SoundCloud** and **Audiomack**, which don't bot-check server IPs. `.music <name>` does the same with SoundCloud first, plus source-specific `.sc` and `.audiomack`. Music keeps arriving even on hosts where YouTube alone would fail.

**To enable Instagram:** install the *Get cookies.txt LOCALLY* browser extension, log into Instagram, export cookies, save as `cookies.txt` in the bot folder. The bot picks it up automatically (`.dlstatus` confirms). The same file unlocks private/age-restricted YouTube and Facebook content.

**Size limits:** audio capped at 30 min, video at 15 min and 64MB (WhatsApp's ceiling). Use `.video <link> 240` for a smaller file.

</details>

<details>
<summary><b>😤 ".play is not working" — read this first</b></summary>

<br/>

**There is no YouTube API key in this bot.** `.play`, `.video`, `.ytsearch` and the new
`.spotify` all run on `yt-dlp`, a free keyless downloader. The official YouTube Data
API v3 cannot download media at all (it only returns metadata), so no API key from any
website will ever fix `.play`. If a video "fails even with an API key", the key was
never the problem.

`.play` fails for exactly three reasons — check them in order:

1. **yt-dlp is not installed** (fresh clone / fresh panel).
   **Fix:** `npm run setup` — verify with `.dlstatus`. The bot says this plainly in chat.
2. **yt-dlp is outdated.** YouTube changes its internals regularly and an old binary
   is the most common cause of "it worked yesterday".
   **Fix:** `npm run update-dl` (run it weekly; many hosts auto-restart anyway).
3. **YouTube is bot-checking your server.** Datacenter/Hostinger/Pterodactyl IPs get
   the "Sign in to confirm you're not a bot" screen.
   **Fix (permanent):** install the *Get cookies.txt LOCALLY* browser extension, open
   youtube.com **while signed in**, export the file as `cookies.txt` into the bot
   folder. The downloader picks it up automatically — `.dlstatus` confirms it.
   TikTok/Twitter/Facebook are unaffected by this.

Optional: if you *still* want a YouTube Data API key for other projects —
[console.cloud.google.com](https://console.cloud.google.com) → new project →
APIs & Services → Enable **YouTube Data API v3** → Credentials → **Create API key**.
Just know it has zero effect on this bot's downloads.

</details>

---

## 🤖 AI Providers

The bot ships with 8 providers and automatic failover. **Groq and Gemini are genuinely free** and take two minutes to set up.

<div align="center">

| Provider | Free tier | Get a key |
|:---|:---|:---|
| **Groq** | Yes, generous — fastest | [console.groq.com/keys](https://console.groq.com/keys) |
| **Gemini** | Yes, very capable | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Cerebras** | Yes, fastest inference | [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| **OpenRouter** | Yes, many `:free` models | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Mistral** | Free experiment tier | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| **Cohere** | Free trial | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) |
| **DeepSeek** | Paid, very cheap | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| **OpenAI** | Paid | [platform.openai.com](https://platform.openai.com/api-keys) |

</div>

Add keys to `.env`, or from WhatsApp with `.setkey groq gsk_xxx` — that command deletes your message immediately and verifies the key with a real call before confirming. `.aikeys` lists every provider, `.aistatus` latency-tests the ones you configured.

---

## ⚠️ Notes & Honest Limitations

<details>
<summary><b>Read before you open an issue</b></summary>

<br/>

- **Baileys v7 is ESM-only** — use `import`, not `require`. `printQRInTerminal` was removed; the QR is rendered from the `connection.update` event.
- **Keyless AI is effectively over.** Pollinations' legacy text API returns `402 Payment Required`, and DuckDuckGo's free chat endpoint demands a browser challenge. Use Groq or Gemini — both free.
- **Third-party APIs rot.** Every network command has multi-source failover and a clear error instead of a crash, but expect to swap an endpoint occasionally. `restcountries` was already dead during the build and was replaced with World Bank + countriesnow.
- **Textmaker is rendered locally, not scraped.** ephoto360 and textpro.me both block automated form submission — every request returns `{"success":false,"code":-1}`. Rather than ship 45 dead commands, the 47 effects are drawn with SVG + sharp: instant, offline, impossible to break from outside.
- **Still missing (26 of the original 380, ~7%):** the `gfx1-12` photo templates, `remini` upscaler and `naturewlp` need paid AI image services. `shazam` needs an AudD/ACRCloud key, `audio2text` needs an OpenAI key, and `subtitle` returns search links because every subtitle site blocks automated downloads. Each becomes a ~30-line plugin the moment you supply a key.
- **Screenshots, QR, memes and PDF are local or keyless.** `.ss` uses thum.io with a microlink fallback and refuses private/internal addresses (SSRF guard). `.qrcode`/`.readqr` run offline. Meme overlays and `.carbon` are drawn with sharp + SVG. `.pdf` hand-builds a valid PDF — verified with a real parser.
- Keep `.env` out of Git — `.gitignore` covers it plus `session/`, `data/`, `tmp/`.
- This is an unofficial library. **Don't spam** — WhatsApp bans numbers for bulk unsolicited messaging. Test with a spare SIM first.

</details>

---

## 📜 Credits

<div align="center">

| Role | Credit |
|:---|:---|
| 👨‍💻 Developer | **TAPRUSH EMP (Micheal)** — [@MykelGoal](https://github.com/MykelGoal) |
| 📦 Core Library | [Baileys v7](https://www.npmjs.com/package/baileys) |
| 🎞️ Media | [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) · [sharp](https://sharp.pixelplumbing.com) |

</div>

---

## ⚖️ Notice

> This bot is built for **educational purposes only**.
> **DO NOT misuse** this software.
> Redistribution without credit to the original author is **strictly prohibited**.

Licensed under [MIT](LICENSE).

---

<div align="center">

### ⭐ Star the repo if VENOM MD helped you

**《 POWERED BY TAPRUSH EMP 🇳🇬 》**

</div>
