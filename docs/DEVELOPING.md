# Developing

[← back to the README](../README.md)

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
| `src/builtin-keys.js` | Keys + database URI that ship with the code — the one file to edit. |
| `src/lib/mongoStore.js` | Persists a URI set with `.setmongo` outside the database. |
| `src/lib/roles.js` | Staff ladder — who may run what. |
| `src/lib/affiliate.js` | Referral codes, claims, rewards, leaderboard. |
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

---

## 🧪 Testing

```bash
node test/fulltest.js       # 124 assertions, offline + live APIs
node test/selftest.js       # quick smoke test
node test/dltest.js         # downloader assertions (fast)
node test/dltest.js --full  # + real YouTube/TikTok downloads (~3 min)
node test/capcut-test.mjs   # .capcut editor - 196 assertions, fully offline
node test/movie-test.mjs    # .movie finder  - 81 assertions, fully offline
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
