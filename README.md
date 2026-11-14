<div align="center">

<img src="assets/avatar-round.png" width="120" alt="Rubi logo">

# Rubi

**The first multi-purpose SimpleX Chat bot.**

<p>
  <a href="https://github.com/notnooob/Rubi/wiki"><img alt="Docs: wiki" src="https://img.shields.io/badge/docs-wiki-blue?logo=github"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/notnooob/Rubi"></a>
  <a href="package.json"><img alt="Version" src="https://img.shields.io/github/package-json/v/notnooob/Rubi"></a>
  <a href="https://github.com/notnooob/Rubi/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/notnooob/Rubi"></a>
  <a href="https://www.npmjs.com/package/simplex-chat"><img alt="simplex-chat version" src="https://img.shields.io/github/package-json/dependency-version/notnooob/Rubi/simplex-chat"></a>
</p>

[Features](#features) • [Getting started](#getting-started) • [Commands](#commands) • [Configuration](#configuration) • [Documentation](#documentation) • [Development](#development)

</div>

Rubi brings utilities, web lookups, Reddit and X posts, polls, reminders, games and group moderation to
[SimpleX Chat](https://simplex.chat), the messenger without user IDs. It works in direct messages and in groups,
and it's built on the official [`simplex-chat`](https://www.npmjs.com/package/simplex-chat) Node.js library.

There's no analytics or tracking: group settings live in Rubi's own chat database (which you can encrypt), and web
lookups can go through Tor.

> [!TIP]
> Just want to use Rubi? Connect to a running copy, send `/help`, and read [Using Rubi](https://github.com/notnooob/Rubi/wiki/Using-Rubi).

## Features

- **80 commands** in 7 categories. `/help` builds itself from them and only lists what you can run in the current chat.
- **Live replies:** slow commands answer straight away with a live message that turns into the result.
- **Reddit and X posts in chat:** `/reddit <link>` and `/x <link>` show a post with its stats, quotes, polls and
  community notes, and attach its images and videos. Reply to a link with just `/r` or `/x` to show it.
- **Polls and games:** reaction-based polls, trivia tournaments, Would You Rather, hangman, tic-tac-toe and a
  daily word puzzle with a leaderboard per chat.
- **Reminders** that survive restarts, once or repeating (`/remind every day 9:00 standup`), for yourself or another member.
- **Group moderation** based on SimpleX member roles: kick, block (optionally for a set time), warnings with an
  automatic limit, purge, banned words that see through sp4m-style disguises, slow mode and anti-spam for new members.
- **A private moderation log:** admins get every moderation action by DM, never in the group.
- **Group tools:** rules, welcome messages, events with RSVPs, shared task lists, RSS/Atom feeds and per-group
  command switches.
- **Tappable commands:** commands in Rubi's replies work as buttons in DMs, and in groups that turn on Rubi's command menu.
- **Easy to extend:** one file per command, with typed arguments, cooldowns, anti-flood and timeouts built in.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 22.19 or newer
- Build tools for the native SimpleX library, which `npm install` compiles:
  - **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the
    "Desktop development with C++" workload, plus Python (or use WSL)
  - **Linux:** `build-essential` and `python3`
  - **macOS:** Xcode command line tools (`xcode-select --install`)
- Optional: [ffmpeg](https://ffmpeg.org) on the `PATH`, so Reddit videos keep their sound

Rubi runs on Linux, macOS and Windows, on x86_64 or arm64.

### Install and run

```sh
git clone https://github.com/notnooob/Rubi.git
cd Rubi
npm install
npm run dev
```

On first start Rubi creates its profile, its database in `storage/` and a SimpleX address, then prints the address:

```
Connect: https://smp….simplex.im/a#…
```

Open that link in the SimpleX app to start chatting with Rubi. For production, compile once with `npm run build`
and run with `npm start`.

> [!NOTE]
> If `npm install` fails while linking (`cannot open file …libsimplex.lib`), or Rubi says the native library is
> missing, run `npm run setup:native`. It downloads the SimpleX library again and rebuilds the addon.

> [!IMPORTANT]
> The `storage/` folder *is* Rubi's identity: its keys, contacts and address. Back it up and never commit it.
> Only one Rubi can run on a database at a time; a second copy refuses to start.

### Make yourself a bot admin

Send `/whoami` to Rubi. It replies with your contact id. Add it to `.env` and restart:

```ini
RUBI_BOT_ADMINS=12
```

Bot admins can run every command anywhere, including `/stats`, `/broadcast` and `/reload`, and see error details
when a command crashes.

### Add Rubi to a group

Add Rubi to a group like any other contact, then give it the role it needs: **member** for everyday commands,
**moderator** or **admin** for moderation, and **owner** if you want tappable commands (`/groupmenu`). The
[Group Admin Guide](https://github.com/notnooob/Rubi/wiki/Group-Admin-Guide) walks through roles, moderation and
every group setting.

## Commands

| Category | Commands |
|---|---|
| General | `/help` `/whoami` `/ping` `/about` `/invite` |
| Utility | `/remind` `/reminders` `/poll` `/calc` `/convert` `/prefs` `/todo` `/cleanlink` `/roll` `/choose` `/time` `/qr` `/uuid` `/password` `/hash` `/base64` `/timestamp` |
| Web | `/reddit` `/x` `/deals` `/weather` `/wiki` `/define` `/currency` `/crypto` `/status` `/dns` `/whois` `/github` `/npm` `/country` `/holidays` `/hn` |
| Fun | `/8ball` `/coinflip` `/rps` `/trivia` `/wyr` `/hangman` `/ttt` `/word` `/joke` `/fact` `/quote` `/xkcd` |
| Groups | `/groupinfo` `/members` `/rules` `/welcome` `/event` `/feed` `/link` `/antispam` `/filter` `/slowmode` `/toggle` `/seen` `/afk` `/groupmenu` |
| Moderation | `/kick` `/role` `/block` `/unblock` `/warn` `/warnings` `/unwarn` `/delete` `/purge` `/modlog` |
| Admin | `/reload` `/stats` `/groups` `/leave` `/broadcast` `/join` |

Send `/help <command>` in chat for usage and examples, or browse the
[Command Reference](https://github.com/notnooob/Rubi/wiki/Command-Reference). Web commands use free public APIs that
need no key; the services are listed in [Using Rubi](https://github.com/notnooob/Rubi/wiki/Using-Rubi#privacy-what-rubi-sees-and-keeps).

## Configuration

Rubi runs with no configuration at all. To change something, copy [`.env.example`](.env.example) to `.env`, which
documents every variable. The ones you're most likely to need:

| Variable | Default | Description |
|---|---|---|
| `RUBI_BOT_ADMINS` | *(none)* | Contact ids of the bot's operators, comma-separated |
| `RUBI_NAME` / `RUBI_BIO` / `RUBI_AVATAR` | `Rubi` / … / `./assets/avatar.jpg` | Profile name, bio and picture |
| `RUBI_DB_KEY` | *(none)* | Encrypts the SQLite database |
| `RUBI_HTTP_PROXY` | *(none)* | Route web lookups through a proxy, e.g. `socks5://127.0.0.1:9050` for Tor |
| `RUBI_AUTO_JOIN_GROUPS` | `true` | Accept group invitations automatically |

> [!WARNING]
> Set `RUBI_DB_KEY` before the first start, and don't lose it. Adding a key later makes the existing database fail to open.

The full list, with Postgres, business addresses, rate limits and media options, is in
[Running Rubi](https://github.com/notnooob/Rubi/wiki/Running-Rubi#configuration).

## Documentation

The [wiki](https://github.com/notnooob/Rubi/wiki) is published from the [`guide/`](guide/README.md) folder:

| Page | For |
|---|---|
| [Using Rubi](https://github.com/notnooob/Rubi/wiki/Using-Rubi) | Everyone: commands, buttons, reminders, polls, games, web lookups, privacy |
| [Group Admin Guide](https://github.com/notnooob/Rubi/wiki/Group-Admin-Guide) | Group owners and moderators: setup, roles, moderation, feeds, the moderation log |
| [Running Rubi](https://github.com/notnooob/Rubi/wiki/Running-Rubi) | Whoever hosts Rubi: installation, configuration, admin commands, backups |
| [Command Reference](https://github.com/notnooob/Rubi/wiki/Command-Reference) | Every command with its usage, arguments and permissions |

## Development

```sh
npm run check   # typecheck and tests (no native library or network needed)
npm run guide   # regenerate the command reference after changing a command
```

- Each command is one file in `data/commands/<category>/`. Copy [`_template.ts`](data/commands/_template.ts) to start;
  `/help`, the app menu and argument checking pick it up automatically.
- Commands for your own copy only go in [`data/commands/custom/`](data/commands/custom/README.md), which git ignores.
- [AGENTS.md](AGENTS.md) covers the architecture, the utilities available to commands, and the SimpleX quirks Rubi
  works around. The SimpleX API docs are mirrored in [`docs/`](docs/INDEX.md) (`npm run docs:sync`).
