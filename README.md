<!-- VENOM MD BOT — by TAPRUSH EMP (Micheal) -->

<div align="center">

<img src="assets/menu.jpg" width="100%" style="border-radius:12px;" />

<br/>

[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Orbitron&weight=900&size=22&duration=3000&pause=800&color=8A2BE2&center=true&vCenter=true&width=600&lines=%E2%9A%A1+VENOM+MD+BOT;BUILT+BY+TAPRUSH+EMP+%F0%9F%87%B3%F0%9F%87%AC;401+COMMANDS+%C2%B7+23+CATEGORIES;NO+API+KEYS+NEEDED;FORK+%26+DEPLOY+IN+MINUTES)](https://git.io/typing-svg)

<br/>

[![GitHub](https://img.shields.io/badge/MykelGoal-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/MykelGoal)
[![Baileys](https://img.shields.io/badge/Baileys-v7-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://www.npmjs.com/package/baileys)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Session ID](https://img.shields.io/badge/Get%20Session%20ID-5500ff?style=for-the-badge&logo=key&logoColor=white)](https://session-site-2odn.onrender.com)

<br/>

[![Stars](https://img.shields.io/github/stars/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2&label=Stars)](https://github.com/MykelGoal/VENOM-MD-BOT/stargazers)
[![Forks](https://img.shields.io/github/forks/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2&label=Forks)](https://github.com/MykelGoal/VENOM-MD-BOT/network/members)
[![Repo Size](https://img.shields.io/github/repo-size/MykelGoal/VENOM-MD-BOT?style=flat-square&color=8A2BE2)](https://github.com/MykelGoal/VENOM-MD-BOT)
[![License](https://img.shields.io/badge/License-MIT-8A2BE2?style=flat-square)](LICENSE)

</div>

---

## 🐍 What is VENOM MD?

**VENOM MD** is a modular, plugin-driven WhatsApp bot on **Baileys v7** — fast, clean, and honest about what works. Every command is auto-discovered from `plugins/`. Maintained by **TAPRUSH EMP (Micheal) 🇳🇬**.

**No API keys to hunt for.** Keys and the database ship inside the code, so a fresh clone works out of the box.

<div align="center">

| ⌨️ Commands | 🗂️ Categories | 🔑 Keys Needed | 💾 Setup |
|:---:|:---:|:---:|:---:|
| **401** | **23** | **0** | **none** |

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
git clone https://github.com/MykelGoal/VENOM-MD-BOT
cd VENOM-MD-BOT

npm install          # dependencies
npm run setup        # yt-dlp for downloaders

cp .env.example .env # set OWNER_NUMBER, then:
npm start
```

Scan the QR, or use a pairing code with `npm run pair`. On panels with no terminal, paste a [**SESSION_ID**](https://session-site-2odn.onrender.com) instead.

> 📖 Full walkthrough, hosting notes and runtime settings → **[docs/SETUP.md](docs/SETUP.md)**

---

## ✨ What makes it different

| | |
|:---|:---|
| 🔑 **Zero-key deploys** | Keys + MongoDB ship in [`src/builtin-keys.js`](src/builtin-keys.js). Your own always wins — `.env`, `.setkey` or `.setmongo`, live, no restart |
| 🎓 **VENOM SCHOOL** | The bot teaches its own commands 3× a day — lesson, pop quiz, register, and it **tags whoever skipped class** |
| 👥 **Staff roles** | admin · editor · mod · vip, each inheriting the last. Credentials and code stay owner-only, always |
| 🤝 **Affiliate** | Everyone gets a referral code and link; invites pay coins and earn VIP |
| 📡 **Downloads that survive hosting** | Six keyless YouTube routes with failover — `.play` and `.ytv` keep working where yt-dlp gets IP-blocked |
| 🎬 **`.capcut`** | Plain-English video editing: *"cut 0-10, speed 2x, add subtitles"* |
| 🍿 **`.movie`** | Say a film or episode by name and get the file |
| 🧹 **Self-cleaning DB** | Sweeps spent records every 6h so the free 512 MB never fills — balances and logins untouched |

---

## 📋 Commands

<div align="center">

| Category | Highlights |
|:---|:---|
| **FUN** · 58 | 43 reaction GIFs · `ship` `truth` `dare` `emojimix` `pokemon` |
| **TEXTMAKER** · 50 | `ttp` stickers + 47 text effects, all rendered locally |
| **GROUP** · 42 | `poll` `vcf` `kick` `promote` `mute` `tagall` `warn` `antilink` `welcome` |
| **CONVERTER** · 40 | `capcut` `sticker` `take` `mp4` `gif` `tomp3` `ptv` + 17 audio effects |
| **ECONOMY** · 38 | `daily` `work` `mine` `fish` `rob` `heist` · banking · `slots` `blackjack` |
| **UTILITIES** · 35 | `tempmail` `quran` `praytimes` `weather` `wiki` `calc` `tts` `ss` `pdf` |
| **CONFIG** · 35 | `setvar` `mode` `forcejoin` `setrole` `school` `setmongo` `antidelete` |
| **IMAGE-MEME** · 29 | `fakechat` `wanted` `jail` `drake` `wasted` `triggered` `carbon` |
| **DOWNLOADER** · 26 | `movie` `play` `music` `video` `spotify` `tiktok` `instagram` `apk` |
| **AI** · 22 | 8 providers with failover — `ai` `gpt` `gemini` `groq` `imagine` |
| **USER** · 26 | `pp` `rank` `affiliate` `mygrades` `classtop` `present` `askteacher` |
| **TOOLS** · 21 | `snipe` `afk` `remind` `schedule` `setcmd` `msgs` `listonline` |
| **BOT** · 20 | `ping` `stats` `alive` `broadcast` `grouplist` `backup` `dbsize` |
| **SEARCH** · 13 | `news` `tvshow` `img` `wallpaper` `github` `lyrics` `shazam` |
| **+9 more** | ANIME · IMAGE · GAME · MISC · PRIVACY · AUTOREPLY · PLUGINS · PROCESS · HELP |

</div>

> 💡 `.menu` for everything · `.menu <category>` for one section · `.menu <command>` for a help card.

---

## 📚 Documentation

| Guide | What's inside |
|:---|:---|
| **[Setup & Hosting](docs/SETUP.md)** | Session ID, Render/Koyeb/Pterodactyl, `.setvar`, force-join gate |
| **[Database](docs/DATABASE.md)** | MongoDB, `.setmongo`, per-deploy isolation, housekeeping |
| **[Features](docs/FEATURES.md)** | School, roles, affiliate, downloaders, `.movie`, `.capcut`, AI |
| **[Developing](docs/DEVELOPING.md)** | Writing a plugin, architecture, testing, known limits |

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

> Built for **educational purposes only**. **DO NOT misuse** this software.
> Redistribution without credit to the original author is **strictly prohibited**.

Licensed under [MIT](LICENSE).

---

<div align="center">

### ⭐ Star the repo if VENOM MD helped you

**《 POWERED BY TAPRUSH EMP 🇳🇬 》**

</div>
