# Database

[← back to the README](../README.md)

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

**No `MONGO_URI`?** The bot falls back to the shared cluster in [`src/builtin-keys.js`](../src/builtin-keys.js), so data still survives a restart or redeploy with zero setup. It is shared and public — anyone running this repo can read and write it, so create your own free M0 cluster for anything private.

`.stats` shows which backend is live.

</details>

<details>
<summary><b>Switch database from WhatsApp — <code>.setmongo</code></b></summary>

<br/>

Already hosted and want your own database? You do not need the panel, a redeploy or a text editor.

```
.setmongo mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/
.setmongo mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/ mybotdb   # custom db name
```

What happens, in order:

1. your message is **deleted immediately** — it carries a live password
2. the URI is **connection-tested** before anything is saved; if it fails, nothing changes and you get the actual error plus the usual causes
3. it is written to `mongo.local.json` (gitignored) and to `.env` when the filesystem is writable
4. the live connection is **swapped in place — no restart**

| Command | Does |
|---|---|
| `.setmongo <uri> [db]` | test, save and switch, live |
| `.getmongo` | which database is active, where the URI came from, password masked |
| `.delmongo` | forget yours, fall back to the built-in cluster |

Owner-only. Precedence: **panel/`.env` `MONGO_URI` → `.setmongo` → built-in cluster → JSON files**.

</details>

<details>
<summary><b>Sharing the built-in cluster — what other deployers can and cannot touch</b></summary>

<br/>

Everyone who leaves the built-in URI in place logs into the **same MongoDB account**, so each deploy is automatically given **its own database** inside it: `venom_<BOT_ID>`, where `BOT_ID` defaults to your `OWNER_NUMBER`.

| | Shared? |
|---|---|
| `.setvar BOT_NAME`, `OWNER_NAME`, prefix, mode, menu image | ❌ private to your deploy |
| Economy balances, XP, warns, AFK, notes, custom commands | ❌ private to your deploy |
| Group settings (antilink, welcome, filters) | ❌ private to your deploy |
| WhatsApp session when `SESSION_STORE=mongo` | ❌ private — namespaced by `BOT_ID` too |
| The database **credentials** themselves | ✅ **shared — they are in the repo** |

So another deployer cannot rename your bot or spend your users' coins by accident. But anyone reading the repo *does* hold the cluster login and could open your database deliberately. For anything you care about, run `.setmongo <your own uri>` — it takes three minutes and costs nothing.

Set `BOT_ID` explicitly in `.env` if you run two bots from one owner number.

</details>

---

---

## 🧹 Keeping the 512 MB free tier from filling up

Atlas M0 gives you 512 MB and **no warning before it stops accepting writes** — at which point balances, settings and (if the session lives in Mongo) the login itself stop saving. So the bot cleans up after itself.

```
.dbsize            what is used, and which collections ate it
.dbclean dry       preview - deletes nothing
.dbclean           remove spent records
.dbclean deep      also prune spent WhatsApp pre-keys, then compact
.dbkeep 90         days of history to keep
```

An automatic sweep runs every 6 hours (`.setvar DB_AUTOCLEAN false` to stop it) and only goes `deep` once storage passes 80%. Past 90% the owner gets a warning in the log.

**What it deletes** — only records that are provably spent:

| Collection | Rule |
|---|---|
| `attendance` | older than `DB_RETAIN_DAYS` (90) |
| `tasks` | reminders that fired or expired over 7 days ago |
| `afk` | notes nobody ever came back from |
| `users` | ghost records: no coins, no bank, no xp, no items, never played |
| `session` | `deep` only: oldest pre-keys, keeping the newest 150 |

**What it never touches:** balances, inventories, xp, roles, group settings, autoreplies, custom commands, `.setvar` values, AI keys, and `creds` — your WhatsApp login. If a rule cannot prove a record is dead, the record stays.

> The pre-key rule is the only one that can bite: WhatsApp issues one-time keys, and deleting one that has not been consumed loses messages encrypted to it. That is why it is opt-in, capped, and never runs on the automatic sweep below 80%.

---
