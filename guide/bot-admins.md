# Running Rubi

For whoever hosts a copy of Rubi. Installing and the full list of settings are in the [project README](../README.md);
this page covers operating it day to day.

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

Every setting is an environment variable, usually set in `.env`. They're all listed with defaults in the
[README](../README.md#configuration) and explained in `.env.example`. A few that change behavior people notice:

- `RUBI_SKIP_MISSED_COMMANDS` (default `true`): commands sent while Rubi was offline aren't answered when it comes back.
  Set `false` to answer them late.
- `RUBI_AUTO_JOIN_GROUPS` / `RUBI_GREET_ON_JOIN`: accept group invitations automatically, and say hello after joining.
- `RUBI_UNKNOWN_COMMAND_REPLY` (`always`, `direct`, `never`), `RUBI_NON_COMMAND_HINT`, `RUBI_MENTION_HINT`: when Rubi
  answers messages it doesn't understand.
- `RUBI_DEFAULT_COOLDOWN`, `RUBI_FLOOD_MAX`, `RUBI_FLOOD_WINDOW_MS`: per-person rate limits.
- `RUBI_HTTP_PROXY`: route every web lookup through a proxy, e.g. `socks5://127.0.0.1:9050` for Tor.
- `RUBI_ALLOW_FILES`: let people send files to Rubi.

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
