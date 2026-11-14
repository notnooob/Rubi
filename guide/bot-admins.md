# Running Rubi

For whoever hosts a copy of Rubi: installing it, configuring it and operating it day to day.

## Installing

The [README](../README.md#getting-started) has the short version. In more detail:

1. **Node.js 22.19 or newer.**
2. **Build tools** for the native SimpleX library, which `npm install` compiles with `node-gyp`:
   - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
     "Desktop development with C++" workload, plus Python. Or run Rubi under WSL.
   - Linux: `build-essential` and `python3` (e.g. `sudo apt install build-essential python3`).
   - macOS: Xcode command line tools (`xcode-select --install`).
3. **Optional: [ffmpeg](https://ffmpeg.org)** on the `PATH`. Reddit stores a video's sound separately, and ffmpeg joins
   them; without it, Reddit videos are sent muted.
4. `git clone https://github.com/notnooob/Rubi.git`, then `npm install` in the folder.
5. Optionally `cp .env.example .env` and adjust it (see [Configuration](#configuration)). If you want an encrypted
   database, set `RUBI_DB_KEY` now, before the first start.
6. `npm run dev` runs from source; `npm run build && npm start` compiles once and runs the compiled code.

On first start Rubi creates its profile, its database in `storage/` and a SimpleX address, and prints the address
(`Connect: https://smp….simplex.im/a#…`). On macOS the very first start can take 20–30 seconds while the system
verifies the library.

**If the native library is missing:** on some Node versions the package's own unzip step stops partway through, so
linking fails (`cannot open file …libsimplex.lib`) or Rubi says the library is missing. `npm run setup:native`
downloads the same release, extracts it with your system's tools and rebuilds the addon.

## Bot admins

Bot admins are the people running Rubi. They can use the Admin commands, pass every permission check (in groups too),
skip cooldowns, and see error details when a command crashes.

1. Connect to Rubi from your own SimpleX profile and send `/whoami` in that DM. It shows your **contact id**. (Rubi's
   log also prints `contact #<id> … connected` when someone connects.)
2. Put it in `.env`: `RUBI_BOT_ADMINS=12` (several: `12,40`), and restart Rubi.

In a group you count as a bot admin only as the member linked to that contact, so use the same profile there.

| Command | What it does |
|---|---|
| `/stats` | Commands run, failures, memory, scheduled jobs. `/stats health` adds storage, jobs and interaction diagnostics. |
| `/groups` | The groups Rubi is in, with their ids. |
| `/join <link>` | Join a group link, or connect to a contact address or one-time invitation. |
| `/leave` / `/leave <groupId>` | Leave a group, after confirming. Rubi also drops that group's reminders, polls and records. |
| `/broadcast <message>` | Send a message to all of Rubi's contacts (DMs only, after confirming, with live progress). |
| `/reload` | Reload command files and the command menu without restarting. Event handlers and `src/` changes still need a restart. |

## Configuration

Every setting is an environment variable, read from `.env` in the folder you start Rubi from. Everything has a default,
so Rubi runs without a `.env`. `.env.example` lists every variable with comments; the most useful:

| Variable | Default | What it does |
|---|---|---|
| `RUBI_BOT_ADMINS` | *(none)* | Comma-separated contact ids of the bot's operators (see [Bot admins](#bot-admins)). |
| `RUBI_NAME` | `Rubi` | Display name. |
| `RUBI_BIO` | *The first multi-purpose SimpleX Chat bot. Send /help.* | Profile bio. |
| `RUBI_AVATAR` | `./assets/avatar.jpg` | Profile picture (.png/.jpg, small), or `none`. |
| `RUBI_DB_PREFIX` | `./storage/rubi` | Where the SQLite database files go. |
| `RUBI_DB_KEY` | *(none)* | Encrypts the SQLite database (`rubi-state.json` stays a separate file). Set it before the first start, and don't lose it. |
| `RUBI_DB_TYPE` / `RUBI_PG_URL` | `sqlite` | Use `postgres` and a connection URL instead (Linux x86_64 only). |
| `RUBI_BUSINESS_ADDRESS` | `false` | Each person who connects gets their own business chat. |
| `RUBI_ALLOW_FILES` | `false` | Let people send files to Rubi. |
| `RUBI_AUTO_JOIN_GROUPS` | `true` | Accept group invitations automatically. |
| `RUBI_GREET_ON_JOIN` | `true` | Say hello (plus the `/groupmenu` tip) after joining a group. |
| `RUBI_UNKNOWN_COMMAND_REPLY` | `direct` | Answer unknown commands `always`, in DMs only (`direct`) or `never`. |
| `RUBI_NON_COMMAND_HINT` | `true` | In DMs, answer plain messages with a `/help` hint. |
| `RUBI_MENTION_HINT` | `true` | In groups, answer an @mention of Rubi with a `/help` hint (replies to Rubi never trigger it). |
| `RUBI_SKIP_MISSED_COMMANDS` | `true` | Ignore commands sent while Rubi was offline instead of answering them late. |
| `RUBI_DEFAULT_COOLDOWN` | `2` | Seconds between uses of the same command, per person. |
| `RUBI_FLOOD_MAX` / `RUBI_FLOOD_WINDOW_MS` | `6` / `15000` | Anti-flood: at most this many commands per person per window. |
| `RUBI_HTTP_PROXY` | *(none)* | Send web lookups through a proxy, e.g. `socks5://127.0.0.1:9050` for Tor. |
| `RUBI_MEDIA_MAX_MB` | `50` | Largest file `/reddit` and `/x` download and attach. |
| `RUBI_FFMPEG` | `ffmpeg` | Path to ffmpeg (adds sound to Reddit videos). Set it to an empty value to turn this off. |
| `RUBI_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

Restart Rubi after changing `.env`. Profile changes (name, bio, picture) are sent to all contacts automatically.

The web commands contact public APIs (listed in [Using Rubi](using-rubi.md#privacy-what-rubi-sees-and-keeps)), which
can see your server's IP address. Set `RUBI_HTTP_PROXY` to a Tor SOCKS proxy to hide it.

## What the log tells you

On start, Rubi logs that it's online, its address, and one summary line: how many groups it's in, scheduled jobs,
open polls and games, and failed jobs. If it skipped commands sent while it was offline, it logs one total once they
stop arriving. Each command run is logged as who ran what and how long it took, never with the message text. Crashes
are logged with a 6-character reference, the same one the user sees, so you can find them.

## Data and backups

Everything lives in `storage/` (never commit it):

- the SimpleX database (`rubi_chat.db`, `rubi_agent.db` with SQLite): Rubi's identity, keys, contacts, groups, and
  every group's and contact's Rubi settings (rules, banned words, warnings, preferences…);
- `rubi-state.json`: scheduled jobs (reminders, timed blocks, event reminders), open polls and games, last-seen and
  away records;
- `media/`: temporary downloads for Reddit and X attachments, deleted after upload and on start.

Back up the whole `storage/` folder while Rubi is stopped. **Never run two copies on the same database**: each one takes
over the other's message queues and messages get lost. Rubi refuses to start a second time on the same database
(`storage/rubi.lock`).

## Your own commands

Put commands for your copy only in `data/commands/custom/`. That folder is ignored by git, so they're never committed,
and they appear in `/help` under 🧩 Custom. See `data/commands/custom/README.md` and the template at
`data/commands/_template.ts`. After editing, `/reload` picks them up.

## Keeping this guide up to date

These pages live in `guide/` in the repository, and the [GitHub wiki](../README.md#documentation) is published from
them: `.github/workflows/wiki.yml` runs `scripts/build-wiki.mjs` on every push to `main` that changes `guide/`, so edit
the files in `guide/`, never the wiki (its pages are replaced on every publish).

The [command reference](commands.md) is generated from the command files. After adding or changing a command, run
`npm run guide`. A test fails while it's out of date. The other pages are written by hand.

**Setting up the wiki** (once per repository, including forks): turn on the wiki in the repository settings, open the
Wiki tab and save a first page with any text. GitHub only creates the wiki's git repository then. After that, push to
`main` or run the Wiki workflow by hand (Actions → Wiki → Run workflow), and it replaces that page.
