<div align="center">

<img src="assets/avatar-round.png" width="140" alt="Rubi">

# Rubi

**The first multi-purpose SimpleX Chat bot.**

Utilities, web lookups, Reddit and X posts, polls, reminders, games and group moderation in one bot,<br>
built on the official [`simplex-chat`](https://www.npmjs.com/package/simplex-chat) Node.js library.

</div>

---

[SimpleX Chat](https://simplex.chat) is a messenger without user IDs. Rubi works in direct messages and in groups,
with no analytics or tracking. Group settings live in Rubi's own chat database (which you can encrypt), and web
lookups can go through Tor.

## Features

- **61 commands**, each in its own file, in 7 categories. `/help` builds itself from them and only shows what
  you're allowed to run in the current chat.
- **Live replies:** slow commands answer straight away with a live message that turns into the result
  (and jokes reveal their punchline live).
- **Reddit posts in chat:** send `/reddit <link>` (or `/r`), or reply to a message containing a Reddit link with just
  `/reddit` or `/r`, to get the post's text, score and upvote ratio, with its images, GIFs and videos attached.
  Share links (`reddit.com/r/…/s/…`) work too. Append `-` to the URL, or use `/reddit -` / `/r -` as a reply,
  to report the available attachments without downloading or sending them.
- **X (Twitter) posts in chat:** `/x <link>` shows the post with its replies/reposts/likes/views, quoted post,
  the post it replies to, polls and community notes, and attaches its photos and videos. You can also reply to a
  message containing an X link with just `/x`; `/x <url>-` or a `/x -` reply reports media without sending it.
- **Attachments are temporary:** downloaded media is deleted a minute after SimpleX finishes uploading it.
- **Polls and trivia** that count emoji reactions. Rubi adds the reactions itself, so people can just tap them.
- **Group moderation** based on SimpleX member roles: kick, roles, block, warnings with an automatic removal limit,
  delete, anti-spam for new members, welcome messages and rules.
- **Reminders** that survive restarts, in DMs and groups. Only the person who made a poll or reminder can close or
  cancel it.
- **Tappable commands:** in DMs, commands in Rubi's replies are buttons. In groups they show as `code`, unless the
  group enables Rubi's command menu (see [Using Rubi in groups](#using-rubi-in-groups)).
- **Typed arguments, cooldowns, anti-flood, timeouts**, "did you mean" suggestions, and friendly error messages
  with reference ids.

## Commands

| Category | Commands |
|---|---|
| 📖 General | `/help` `/whoami` `/ping` `/about` `/invite` |
| 🛠 Utility | `/remind` `/reminders` `/poll` `/calc` `/roll` `/choose` `/time` `/qr` `/uuid` `/password` `/hash` `/base64` `/timestamp` |
| 🌐 Web | `/reddit` `/x` `/weather` `/wiki` `/define` `/currency` `/crypto` `/status` `/dns` `/github` `/npm` `/country` `/holidays` `/hn` |
| 🎲 Fun | `/8ball` `/coinflip` `/rps` `/trivia` `/joke` `/fact` `/quote` `/xkcd` |
| 👥 Groups | `/groupinfo` `/members` `/rules` `/welcome` `/link` `/antispam` `/groupmenu` |
| 🛡 Moderation | `/kick` `/role` `/block` `/unblock` `/warn` `/warnings` `/unwarn` `/delete` (reply to a message) |
| ⚙️ Admin | `/reload` `/stats` `/groups` `/leave` `/broadcast` `/join` (bot admins only) |

In chat, send `/help <category>` for descriptions, or `/help <command>` for usage, arguments and examples.

The web commands use free public APIs that need no key: Open-Meteo, Wikipedia, Free Dictionary, Frankfurter (ECB rates),
CoinGecko, Cloudflare DNS-over-HTTPS, GitHub, npm, Nager.Date, Hacker News, JokeAPI, xkcd and Open Trivia DB.
`/country` uses built-in data and makes no request. `/reddit` reads posts from the
[Arctic Shift](https://arctic-shift.photon-reddit.com) archive and downloads media from Reddit's servers.
`/x` uses the [FxTwitter](https://github.com/FxEmbed/FxEmbed) API and downloads media from X's servers.

## Setup

### 1. Requirements

- **Node.js 20.12 or newer**
- **Build tools for the native SimpleX library.** `npm install` compiles a small addon with `node-gyp`:
  - **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
    **"Desktop development with C++"** workload, plus Python. (Or run Rubi under WSL.)
  - **Linux:** `build-essential` and `python3` (e.g. `sudo apt install build-essential python3`).
  - **macOS:** Xcode command line tools (`xcode-select --install`).

- **Optional: [ffmpeg](https://ffmpeg.org)** on the `PATH`, for sound in `/reddit` videos (Reddit stores a video's
  audio separately, and ffmpeg joins them). Without it, videos are sent muted.

Supported platforms: Linux, macOS and Windows on x86_64 or arm64.

### 2. Install

```sh
git clone https://github.com/notnooob/Rubi.git
cd Rubi
npm install
```

`npm install` downloads the SimpleX core library and builds the addon. If it fails while linking
(`cannot open file …libsimplex.lib`), or Rubi later says the native library is missing, run:

```sh
npm run setup:native
```

On some Node versions the package's own unzip step stops partway through. This script downloads the same
release, extracts it with your system's tools, and rebuilds the addon.

### 3. Configure (optional)

```sh
cp .env.example .env
```

Everything has a sensible default, so Rubi runs with no `.env` at all. See [Configuration](#configuration) below.
If you want an **encrypted database**, set `RUBI_DB_KEY` now, before the first start.

### 4. Start

```sh
npm run dev                  # run from source
# or, for production:
npm run build && npm start   # compile once, run the compiled JS
```

On first start Rubi creates its profile, its database in `./storage/`, and a SimpleX address, then prints:

```
Connect: https://smp….simplex.im/a#…
```

Open that link in the SimpleX app to start chatting with Rubi. On macOS the very first start can take 20–30 seconds
while the system verifies the library.

Keep the `storage/` folder: it *is* Rubi's identity (keys, contacts, address). Back it up, and never commit it.
Only one Rubi can run per database; a second copy refuses to start, because two would steal each other's messages.

### 5. Make yourself a bot admin

Connect to Rubi and send `/whoami`. It replies with your contact id (the console also logs
`contact #<id> @name connected`). Put it in `.env` and restart:

```ini
RUBI_BOT_ADMINS=<id>
```

Bot admins can run every command anywhere (including ⚙️ Admin ones like `/stats`, `/broadcast` and `/reload`) and see
error details when something crashes. Separate several ids with commas.

## Configuration

All settings are environment variables, read from `.env` in the folder you start Rubi from.
[`.env.example`](.env.example) lists every one with comments. The most useful:

| Variable | Default | What it does |
|---|---|---|
| `RUBI_BOT_ADMINS` | *(none)* | Comma-separated contact ids of the bot's operators (see step 5). |
| `RUBI_NAME` | `Rubi` | Display name. |
| `RUBI_BIO` | *The first multi-purpose SimpleX Chat bot. Send /help.* | Profile bio. |
| `RUBI_AVATAR` | `./assets/avatar.jpg` | Profile picture (.png/.jpg, small), or `none`. |
| `RUBI_DB_PREFIX` | `./storage/rubi` | Where the SQLite database files go. |
| `RUBI_DB_KEY` | *(none)* | Encrypts the database. Set it before the first start, and don't lose it. |
| `RUBI_DB_TYPE` / `RUBI_PG_URL` | `sqlite` | Use `postgres` + a connection URL instead (Linux x86_64 only). |
| `RUBI_BUSINESS_ADDRESS` | `false` | Each person who connects gets their own business chat. |
| `RUBI_ALLOW_FILES` | `false` | Let people send files to Rubi. |
| `RUBI_AUTO_JOIN_GROUPS` | `true` | Accept group invitations automatically. |
| `RUBI_GREET_ON_JOIN` | `true` | Say hello (plus the `/groupmenu` tip) after joining a group. |
| `RUBI_UNKNOWN_COMMAND_REPLY` | `direct` | Answer unknown commands in `always`, `direct` (DMs only) or `never`. |
| `RUBI_NON_COMMAND_HINT` | `true` | In DMs, answer plain messages with a `/help` hint. |
| `RUBI_MENTION_HINT` | `true` | In groups, answer an @mention of Rubi with a `/help` hint (replies to Rubi never trigger it). |
| `RUBI_DEFAULT_COOLDOWN` | `2` | Seconds between uses of the same command, per person. |
| `RUBI_FLOOD_MAX` / `RUBI_FLOOD_WINDOW_MS` | `6` / `15000` | Anti-flood: at most this many commands per person per window. |
| `RUBI_HTTP_PROXY` | *(none)* | Send web lookups through a proxy, e.g. `socks5://127.0.0.1:9050` for Tor. |
| `RUBI_MEDIA_MAX_MB` | `50` | Largest file `/reddit` and `/x` download and attach. |
| `RUBI_FFMPEG` | `ffmpeg` | Path to ffmpeg (adds sound to Reddit videos). Set it empty to turn this off. |
| `RUBI_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

Restart Rubi after changing `.env`. Profile changes (name, bio, picture) are sent to all contacts automatically.

**Privacy note:** the web commands contact the public APIs listed above, which can see your server's IP address.
Set `RUBI_HTTP_PROXY` to a Tor SOCKS proxy to hide it.

## Using Rubi in groups

1. Connect to Rubi, then in your group's info choose **Add members** and pick Rubi. It accepts automatically, says
   hi, and explains how to turn on its command menu.
2. Give Rubi the role that matches what you want it to do (member list → Rubi → role):
   - **member**: everything except moderation
   - **moderator**: also `/block`, `/delete` and anti-spam
   - **admin**: also `/kick`, `/role`, `/link` and automatic removal at the warning limit
   - **owner**: also `/groupmenu`, which makes commands **tappable** in the group and adds Rubi's commands to
     the `/` menu for all members
3. Admins can set `/rules`, a `/welcome` message for new members, and `/antispam on`.

Why `/groupmenu`? The SimpleX apps only make commands in messages tappable in a group when the group profile has a
bot command menu, and only owners can change the group profile. Without it, Rubi shows commands as `code` in that
group and leaves out convenience buttons.

## Development

- One command per file in `data/commands/<category>/`. Copy `data/commands/_template.ts` to start a new one;
  `/help`, the app menu and argument checking pick it up automatically.
- `npm run check` runs the typecheck and tests. The tests use a fake chat core, so they need no native library or network.
- `npm run docs:sync` mirrors the official SimpleX bot API docs into `docs/`.
- `npm run avatar` re-renders the profile pictures from `assets/avatar.svg`.
- [AGENTS.md](AGENTS.md) covers the architecture, the utilities available to commands, and the SimpleX quirks Rubi
  works around.

## License

[AGPL-3.0](LICENSE), the same as `simplex-chat`. Country data comes from [mledoze/countries](https://github.com/mledoze/countries) (ODbL).
