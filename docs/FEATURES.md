# Features

[← back to the README](../README.md)

---

## 🎓 VENOM SCHOOL — the bot teaches its own commands

A 380-command menu is unreadable, so people learn six commands and never find the rest. Dumping the menu on them does not fix that. **Teaching one command at a time, on a timetable, with a quiz and a register, does.**

**One group, pinned in the code.** Put your class group's invite link in `SCHOOL_GROUP` (in [`src/builtin-keys.js`](../src/builtin-keys.js) or `.env`) and school runs *there and nowhere else*:

```js
SCHOOL_GROUP: 'https://chat.whatsapp.com/YourClassGroupLink',
```

**This bot ships with `SCHOOL_GROUP: 'support'`** — class is held in the force-join group from `SUPPORT_GROUP_LINK`, which is where the members already are. Change `SUPPORT_GROUP_LINK` and the classroom follows it; put a link or jid in `SCHOOL_GROUP` to teach somewhere else entirely.

Left blank, **no class runs anywhere** until the owner sends `.school on` in the group they want. It never guesses — the force-join group is usually not where you want to teach.

The link is resolved to a group id once, then enforced everywhere. Every other group the bot sits in gets **no lessons, no register, and no AI questions** — which is also what stops strangers draining your API keys. It cannot be moved from chat: `.school on` in another group is refused, and even a database edit loses to the pin. Leave it blank and the classroom is simply whichever group runs `.school on`.

Three classes a day:

```
.school on                     confirm the classroom (owner)
.classtime 08:00,14:00,20:00   timetable
.classtz Africa/Lagos          timezone
.lesson                        teach one right now
```

**How a class runs**

1. At the scheduled minute the bot posts the lesson — what the command does, how to type it, its aliases, whether it is admin-only
2. A **pop quiz** follows: three options, the right answer plus two real commands as decoys
3. **Attendance is passive** — anyone who speaks during the window is in the room. Typing a bare `A`/`B`/`C` counts as answering, because in a real class nobody types `.answer`
4. When the register closes the bot posts who came, who answered correctly, **and tags whoever missed it** — exactly like a teacher reading absentees

| Student | Owner |
|---|---|
| `.present` `.answer A` | `.school on/off` `.lesson` `.endclass` |
| `.askteacher <question>` | `.classlock on 2` `.classquestions 3` |
| `.mygrades` `.classtop` | `.classtime` `.classtz` |
| `.attendance` `.syllabus` | |

**The syllabus builds itself** from the live plugin registry — 425 lessons today, ordered so consecutive classes come from different categories. Install a plugin and it enters the syllabus by itself; owner-only and hidden commands are excluded so nobody is taught something they cannot run.

Scoring is 1 point for attending, 2 for a correct answer, plus coins (`.setvar SCHOOL_REWARD 100`). Progress, the register and the current class all live in the database, so a restart mid-class resumes and still posts the register.

**Students can ask questions, and the bot answers like a teacher**

```
.askteacher how do I download a song?
```

During class you do not even need the command — **end any message with `?`** and the bot answers, because in a real class nobody types a command to raise their hand.

Answers are **grounded in the live command registry**: the bot searches its own plugins first and hands those real entries to the AI, with instructions never to invent a command that does not exist. Word matching is weighted by rarity, so *"remove background from picture"* is decided by "background", not by "remove" appearing in forty descriptions.

Each student gets a **question budget per class** (`.classquestions 3`) — that is what stops one person draining your AI key in a single lesson. Outside class hours `.askteacher` still works, but only in the class group or the bot's DM; in any other group it politely declines.

**Should the group be locked?** Your call, and there is a middle path:

```
.classlock on 2      hush the group for 2 minutes, then open the floor
```

The bot mutes the group the moment the lesson lands so it is not buried under chat, then **unmutes and announces "the floor is open"**. It never locks during the quiz or the register — students must be able to talk to be marked present. The group is always unmuted when the register closes, even if the bot restarts mid-class. Needs the bot to be group admin; if it is not, class runs anyway without the hush.

**No API key needed.** Lessons come from the plugin registry itself, which is always accurate. With a key, the bot adds a warmer "teacher's note" and answers free-form questions; without one it still answers from the registry — less charming, never wrong.

---

---

## 👥 Staff Roles

Other people can help run the bot without holding the keys to it. Each rung inherits everything below it.

<div align="center">

| Role | Unlocks |
|:---|:---|
| 👑 **Owner** | everything — from `OWNER_NUMBER`, cannot be granted |
| 🛡️ **Admin** | every command except the locked list |
| ✏️ **Editor** | bot content: `.setcmd`, filters, welcome/goodbye — plus moderation |
| 🔨 **Moderator** | `.ban` `.warn` `.kick` `.mute` `.lock` and group guards, **without being a WhatsApp admin** |
| 💎 **VIP** | half cooldowns, answered even in private mode |
| 👤 **User** | the default |

</div>

```
.setrole @user editor     .delrole @user
.roles                    .myrole          .rolehelp
```

**Locked to the owner forever**, whatever role anyone holds: `.setmongo` `.setkey` `.setrole` `.setsudo` `.restart` `.shutdown` `.plugin` `.reload` `.setpp` `.setname` `.block` `.addmoney` `.resetecon`. An Admin runs your bot; only you can *take* it.

Existing `.setmod` moderators keep working — they read as 🔨 Moderator.

---

---

## 🎙️ Voice clone

Reply to a voice note and the bot speaks *your* words in that voice's range — pitch, brightness, speed.

```
.voiceclone I will call you in five minutes     (reply to a VN)
.savevoice mum                                  (reply to a VN)
.usevoice mum I am on my way
.myvoices   .delvoice mum
.speak hello there        .speak yo: bawo ni
.voiceprint                                     (reply to a VN)
```

## 🤖 Get your own bot — `.owner` then `.pair`

Every command reply carries a one-line footer. `.owner` and `.pair` work even when the bot is in **private** mode, so a stranger who just saw `.vv` can still reach the creator.

- `.pair` only runs on the **official** VENOM MD (TAPRUSH EMP), never on a random deployer's copy.
- After a successful pair they must join https://chat.whatsapp.com/JQrMgboto6b3kbySokt8lP — other commands stay locked until they do.
- They get a short `SESSION_TOKEN` and the official hub **starts their bot for them**. They can also paste a session ID or run `.autodeploy VNM-XXXXXX`. Render / Railway stay optional.

## 🤝 Affiliate Programme

Give people a reason to spread the bot.

```
.affiliate      your code, link, invites and earnings
.ref V7K2M9     claim the code of whoever invited you
.reftop         leaderboard
.refstats       who you invited, and who invited you
.setaffiliate https://your-page.com     (owner)
```

Every user has a permanent code derived from their number — stable across restarts, and salted per deploy so codes from another bot never resolve here. Share links come out as `https://your-page.com?ref=V7K2M9`, so your host's analytics tell you who sent the traffic.

A newcomer claims once: the inviter earns coins, the newcomer gets a starter bonus, and at the milestone the inviter is **auto-promoted to 💎 VIP**. Self-referral, double claims and A↔B loops are all rejected.

Tune it live, no redeploy:

```
.setvar REF_REWARD 500     coins to the inviter
.setvar REF_BONUS 250      coins to the newcomer
.setvar REF_VIP_AT 5       invites needed for VIP (0 = off)
```

---

---

## 🧰 Commands added from a survey of other bots

I diffed VENOM's ~400 commands against the plugin lists of GataBot-MD, TheMystic-Bot-MD, wabot-aq and Levanter (900+ plugin files). Almost everything they had, VENOM already had. These were the real gaps:

| Command | Why it earned its place |
|---|---|
| `.ttp` / `.attp` | The most-used command in most bots. Text → sticker, rendered **locally** with SVG + sharp, so no API can kill it. 10 colours: `.ttp venom GOAT` |
| `.ttpimg` | Same render, sent as an image |
| `.remind 30m call mum` | Reminders stored in the database — they **survive restarts**, and fire late with an apology rather than vanishing |
| `.reminders` / `.delremind` | Manage them |
| `.schedule 8h Good morning` | Post to a chat later, as the bot |
| `.broadcast` | Message every group, sequentially with a pause (parallel blasting is how numbers get banned) |
| `.grouplist` | Every group, member counts, where you are admin |
| `.ison 234801…` | Is that number on WhatsApp? |
| `.alive` | Fast health card |
| `.backup` | Whole database as a JSON document — **session keys excluded on purpose**, a backup must never be able to log in as you |
| `.fetch <url>` | Owner: GET a URL, see the JSON |
| `.horoscope leo` | Daily horoscope, keyless |

Deliberately skipped: `jadibot` (multi-session, a support nightmare), `spam` (gets numbers banned), `removebg` (needs a paid key), and the Indonesian/Spanish word games that need locale word lists.

---

---

## 📡 YouTube: two routes, automatic failover

`.play` and `.video` used to die on hosted deploys with *"Sign in to confirm you're not a bot"*. That is not a bug in the bot — yt-dlp downloads **from your server**, and YouTube blocks datacenter IPs.

Bots that stay up (SubZero MD and friends) never download from YouTube themselves: they ask a public API to do it and fetch the direct link it returns. That service absorbs the bot check. VENOM now does both:

| `DL_SOURCE` | Behaviour |
|---|---|
| `auto` *(default)* | public APIs first, yt-dlp as fallback |
| `api` | APIs only — no binary needed |
| `ytdlp` | local yt-dlp only, best quality when your IP is clean |

Six keyless providers are tried in order, and the JSON parser is shape-agnostic on purpose — these services rename their fields without warning, so it scores every URL in the response instead of trusting a fixed path.

```
.ytstatus                       which routes work from YOUR host (owner)
.setvar DL_PROVIDER gifted      pin the fastest one
.setvar DL_SOURCE ytdlp         force local downloads
```

Search and metadata fall back the same way, through Piped and Invidious, so `.ytsearch` and `.ytinfo` work even with no yt-dlp installed at all.

---

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

---

## 🍿 `.movie` — say it, get it

Type the title the way you'd say it out loud. The bot works out the title,
season, episode, year and quality on its own, searches its sources, and sends
the video back.

```
.movie naruto epi 1
.movie external fragrance epi 1
.movie interstellar
.movie the office s02e05
.movie night of the living dead 1968 720p
.movie <any video link>
```

**Aliases:** `.movie` · `.film` · `.episode` · `.ep` · `.watch` · `.cinema` — category **DOWNLOADER**.

### It understands how people actually type

| You type | It understands |
|:---|:---|
| `naruto epi 1` · `ep 1` · `episode 1` | episode 1 |
| `the office s02e05` · `S2 E5` · `2x05` | season 2, episode 5 |
| `one piece part 12` | part/episode 12 |
| `night of the living dead 1968` | title + year |
| `attack on titan ep 3 720p` | title + episode + quality |
| `please send me naruto epi 1` | strips the request filler |

Filler is only stripped when it's unambiguous, so real titles like **Free
Willy**, **Full Metal Jacket** and **The Film Star** survive intact.

Results are ranked before anything downloads: the right episode beats the
wrong one, and trailers, soundtracks and reaction videos are pushed down —
so `.movie naruto epi 1` doesn't hand you a trailer.

A pasted link skips the search and goes straight to yt-dlp (1800+ sites).

### Sources

Tried in order, keyless first:

1. **Archive.org** — a large, legal, public-domain catalogue (classic films,
   cartoons, lots of TV). No API key.
2. **yt-dlp** — any pasted link, plus legitimately free full-length uploads.

> **Honest limitation:** this searches *free, legal* catalogues. A blockbuster
> still in cinemas will not be there, and the bot says so plainly instead of
> pretending. It deliberately does not scrape piracy streaming sites — those
> break constantly and can get your host banned.

If the file is over WhatsApp's ~64MB limit, the bot sends the source link
rather than failing silently.

---

---

## 🎬 `.capcut` — the plain-English video editor

One command that behaves like a real editor. Reply to a video and **describe the
edit in normal words** — no flags, no chaining five commands together. The bot
parses what you meant, runs the whole pipeline, and sends the finished clip back.

```
.capcut I want a voiceover saying "Welcome back to the channel" and make it cinematic
.capcut reverse it, slow it down, put a caption "send this to her 😂"
.capcut make it black and white with my voiceover read from the quoted message
.capcut trim from 0:10 to 0:25, crop 9:16 and make it go viral
.capcut trending style
```

**Aliases:** `.capcut` · `.edit` · `.videoedit` · `.autoedit` — category **CONVERTER**.

### 🔥 Viral one-worders

Just say what you want. These all resolve to a full punch-up edit
(saturation, sharpen, zoom-in, 30fps):

```
.capcut make it go viral
.capcut trending style
.capcut make this insane
.capcut make it fire
.capcut do something cool with it
```

### 🧠 What it understands

| | Say it like this |
|:---|:---|
| **Voiceover** | `voiceover saying "..."` · `add voice saying ...` · `narrate ...` · `read the quoted message` |
| **Captions** | `caption "..."` · `subtitle "..."` · `put text "..."` · `add words "..."` |
| **Styles** | `cinematic` `vintage` `vaporwave` `black and white` `glitch` `viral` `warm` `cold` `bright` `dark` |
| **Motion** | `reverse` · `slow` · `fast` · `boomerang` · `smooth` · `zoom at the start/end` · `shake` · `speed ramp` |
| **Cut & crop** | `trim from 0:05 to 0:20` · `crop 9:16` `1:1` `16:9` `4:5` · `make it vertical` |
| **Audio** | `mute` · `keep my audio` (mixes the voiceover over the original at 20%) |

Chain as many as you like — `reverse and slow and bw with a caption "wait for it"`.
Ops always execute in a canonical order (**trim → crop → speed → style → motion →
captions → audio**), so the result is the same no matter what order you typed them in.

An instruction it genuinely doesn't know returns a help card listing every verb —
never a stack trace.

### 🏗️ Create mode — no video needed

Give it a topic and it builds the whole thing from scratch:

```
.capcut create a 2 minute video about Lagos nightlife from stock clips, with a voiceover
.capcut create a 30 second video about jollof rice from stock images with voiceover and captions
```

1. The AI (`chat()`, multi-provider with keyless fallback) writes a narration
   script — one line per scene.
2. Each line is spoken with keyless Google Translate TTS, chunked at 200
   characters per request and concatenated.
3. **Scene length follows the narration audio**, so the picture and the voice
   stay locked together.
4. Stock media per scene from the line's keywords, with Ken Burns motion
   (zoom in / out / pan left / pan right, alternating) over stills.
5. Optional caption strip per scene, then everything is concatenated and muxed.
6. You get the video plus a scene list card.

**Optional stock keys** — everything above works with **no keys at all** (keyless
stills + Ken Burns motion). Add either key to `.env` and create mode upgrades to
real moving stock footage:

```env
PEXELS_KEY=      # https://www.pexels.com/api/new/
PIXABAY_KEY=     # https://pixabay.com/api/docs/
```

### 📐 Technical notes

- **Output:** MP4 · h264 · CRF 28 · 720p30 · AAC 128k · faststart.
- **Limits:** 40MB input, ~5 min per job, hard `-t` caps on every render.
- Captions are rendered as PNG strips with **sharp/SVG** and overlaid — the
  bundled static ffmpeg has no `drawtext`, and emojis work this way.
- A voiceover longer than the clip **holds the last frame** instead of being cut
  off mid-word.
- Every temp file lives in a per-job workspace that is always removed, even on
  failure. Nothing is left in `tmp/`.
- **Avatar lip-sync is marked "coming soon"** rather than faked — narration
  voiceover is the real, working feature today.

---

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

Keys shipped in [`src/builtin-keys.js`](../src/builtin-keys.js) are used automatically, so a deployer needs none of the above. To use your own instead: `.env`, or from WhatsApp with `.setkey groq gsk_xxx` — that command deletes your message immediately and verifies the key with a real call before confirming. `.aikeys` lists every provider, `.aistatus` latency-tests the ones you configured.

---

---

## 🎞️ Why reaction GIFs are transcoded

WhatsApp has no GIF format. What the app shows as a "GIF" is an **MP4 flagged `gifPlayback`** that it loops silently. Send a real `.gif` in the video slot and you get a frozen first frame with a GIF badge that never plays.

So `.punch`, `.kiss`, `.hug`, `.slap`, `.animegif` and friends pull the GIF, then run it through `gifToMp4()` in `src/lib/media.js` — baseline H.264, `yuv420p`, even dimensions, `faststart` — before sending. If ffmpeg is unavailable it degrades to a still image rather than posting a badge that does nothing.

Missing ffmpeg? `npm run setup`.

---
