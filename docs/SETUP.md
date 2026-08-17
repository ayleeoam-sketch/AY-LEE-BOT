# Setup & Hosting

[← back to the README](../README.md)

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

`OWNER_NUMBER` identifies the administrator of that deployment for permissions and private startup alerts. It does **not** replace the public original-creator credit: `.owner` and the menu always direct users to TAPRUSH EMP at `2348021016309`.

**No API keys to hunt for.** Everything the bot needs ships in [`src/builtin-keys.js`](../src/builtin-keys.js) — database included — and is used whenever the environment leaves a value blank. Clone, set `OWNER_NUMBER`, run.

| Want to override? | How |
|---|---|
| Your own key, permanently | edit `src/builtin-keys.js` (ships with the fork) |
| Your own key, this deploy only | set it in `.env` or your panel — env always wins |
| Your own key, right now, from chat | `.setkey groq gsk_xxxxx` |

Order of precedence: **environment → `.setkey` → built-in**.

---

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

---

## ⚙️ Runtime Configuration

No redeploy needed — values persist in the database:

```
.setvar MODE private      .allvar         .getvar MODE
.setvar AUTO_READ true    .delvar MODE    .mode public
```

**Keys:** `PREFIX` `MODE` `AUTO_READ` `AUTO_READ_STATUS` `AUTO_TYPING` `ALWAYS_ONLINE` `REJECT_CALL` `ANTI_DELETE` `STARTUP_MESSAGE` `CMD_REACT` `CMD_REACT_EMOJI` `AUTO_DELETE_COMMANDS` `BOT_NAME` `OWNER_NAME` `USER_TAG`

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

To keep chats clean, the owner can use `.del on`. The bot will remove each recognized command message and its replies from the original chat; media deliberately sent elsewhere, such as `.vvpr` results in the requester's DM, is kept. Use `.del off` to leave them visible again. The bot must be a group admin to remove messages sent by other group members.

</details>

---

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
