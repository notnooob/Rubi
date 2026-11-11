# AGENTS.md — Rubi

Guide for AI agents (and humans) working on this repo. Read this first.

**Agents MUST update this file whenever they make any changes to the project.** Keep the architecture, behavior,
commands, utilities, tests and workflow documented here accurate before finishing.

## What this is

**Rubi is the first multi-purpose SimpleX Chat bot**: utilities, web lookups, Reddit and X posts, polls, reminders, games and
group moderation in one bot. It's written in TypeScript on the **official SimpleX Node.js library**
([`simplex-chat`](https://www.npmjs.com/package/simplex-chat) + [`@simplex-chat/types`](https://www.npmjs.com/package/@simplex-chat/types)).
It's going to be open-sourced, so keep code, comments and docs clean enough for public readers.
(Don't describe Rubi as "a bot with slash commands" or "Discord-style"; it's a *multi-purpose SimpleX Chat bot*.)

- One file per command in `data/commands/<category>/`, loaded automatically at boot. `/help` builds itself from them.
- Typed, validated arguments (`integer`, `boolean`, `member`, `text`, choices, …). Every numeric input accepts commas
  within the digits (`1,000`, `2d1,000`, `1,234.5`), including custom parsers; don't add numeric parsers that reject them.
- **Live commands:** the bot posts a live placeholder right away ("⏳ Working on /x 3s"),
  then edits that same message into the result.
- Works in **DMs and groups**, including business chats. Group admins are identified by their SimpleX member role, and
  commands can require `moderator` / `admin` / `owner`, or `botAdmin` (bot operators).
- **Buttons:** tappable commands (where the apps allow it, see "Tappable commands") and emoji reactions on the bot's
  messages (polls, trivia).
- Utilities for commands: HTTP fetching, per-group settings, a persistent store and scheduler,
  confirm/ask prompts, pagination, QR/images, media downloads and attachments, offline country data (see "Utilities").
- Cooldowns, anti-flood, timeouts with `AbortSignal`, "did you mean", per-error reference ids, graceful shutdown,
  and a one-instance-per-database lock.
- Welcome message (set as the address auto-reply and sent to groups on join), exactly: `Hi, I'm Rubi. Send /help.`

Commands (one file each in `data/commands/<category>/`; the folder is the category):
- **General:** `/help` `/whoami` `/ping` `/about` `/invite`
- **Utility:** `/remind` `/reminders` `/poll` `/calc` `/convert` `/prefs` `/todo` `/cleanlink` `/roll` `/choose` `/time` `/qr` `/uuid` `/password` `/hash`
  `/base64` `/timestamp` (+ hidden helpers `/unremind`, `/endpoll`)
- **Web:** `/reddit` (alias `/r`) `/x` (aliases `/twitter`, `/tweet`) `/deals` `/weather` `/wiki` `/define` `/currency` `/crypto` `/status` `/dns` `/github` `/npm` `/country` `/holidays` `/hn`
- **Fun:** `/8ball` `/coinflip` `/rps` `/trivia` (including `tournament`) `/wyr` `/joke` `/fact` `/quote` `/xkcd`
- **Groups:** `/groupinfo` `/members` `/rules` `/welcome` `/event` `/link` `/antispam` `/groupmenu`
- **Moderation:** `/kick` `/role` `/block` `/unblock` `/warn` `/warnings` `/unwarn` `/delete`
- **Admin** (bot admins): `/reload` `/stats` `/groups` `/leave` `/broadcast` `/join`
- **System** (hidden; buttons send these): `/vote` `/page` `/confirm` `/cancel`

Events (`data/events/`): auto-join + greeting, then a `/groupmenu` tip in groups without the menu (`groups.ts`), custom welcome for new members (`members.ts`), anti-spam (`antispam.ts`).

## Tappable commands, buttons and groups (read before writing replies)

Verified in the SimpleX app source (`ChatInfo.useCommands`, the same on Android/desktop and iOS): commands in messages
are tappable **only** in
- direct chats with a bot, so **DMs with Rubi always**, and
- groups whose profile has a bot command menu (`groupPreferences.commands`). Only **owners** can set it, so Rubi
  must be owner; `/groupmenu` sets it, and `Rubi.syncGroupMenus()` refreshes it on start and on `/reload`.

Everywhere else `/'cmd args'` shows as raw text with quotes. So **never call `fmt.command` / `fmt.button` in
replies.** Use the chat-aware **`ctx.ui`**:
- `ctx.ui.cmd("help", "remind")` renders as tappable `/'help remind'`, or as `` `/help remind` `` (code) where it can't be tapped.
- `ctx.ui.button("🔁", "roll", "2d6")` is a convenience button. **It's omitted entirely** where it can't be tapped.
- `ctx.ui.button("✖", "unremind", id, {important: true})` is needed to act, so it shows as code where it can't be tapped.
  Only help, confirm/cancel, paging, closing your poll, cancelling your reminder and similar actions are "important".
- Messages rendered outside a command (interaction updates, jobs) store `tappable` + `prefix` in their state and
  use `makeUi(tappable, prefix)`.
- Polls and trivia: in non-tappable groups there are no vote buttons; people vote with **reactions** instead.

Live messages: **never end a live text with "…" or "..."**. The apps already animate "..." after every live message
(a test enforces this for `live:` texts).

The `/` menu lives in the bot profile (and in the group profile for `/groupmenu`), together with the avatar (~8.5 KB)
and the address link. SimpleX rejects a profile whose JSON is over **14 694 bytes** ("Profile is too large",
`maxEncodedInfoLength`), so the menu is built to fit what's left (`src/core/profile.ts` → `menuWithin({maxBytes})`):
it drops parameter hints, then shortens labels, then uses bare keywords, and only then leaves commands out (with a
warning in the log). A test fails if the default avatar no longer leaves room for the full menu. Keep `description`
short, and put examples after a colon ("Roll dice: /roll 2d6"); the menu drops that part.

## API reference → `docs/`

**When you need the SimpleX API, look in `docs/` first. Don't guess method names or event shapes.**
Start at [`docs/INDEX.md`](docs/INDEX.md).

| Need | File |
|---|---|
| All `ChatApi` methods (`apiSendMessages`, `apiListMembers`, `apiJoinGroup`, …) | `docs/api.Class.ChatApi.md` |
| `bot.run` options (profile, address, commands menu) | `docs/bot.Interface.BotOptions.md`, `docs/bot.Interface.BotConfig.md` |
| Every chat command string + response types | `docs/bot-api/COMMANDS.md` |
| Every event (`newChatItems`, `receivedGroupInvitation`, …) and its fields | `docs/bot-api/EVENTS.md` |
| Every type (`ChatItem`, `GroupMember`, `GroupMemberRole`, `MsgContent`, …) | `docs/bot-api/TYPES.md` |
| How SimpleX bots work: command menus, `/'cmd params'` syntax, business addresses | `docs/bot-api/BOTS_README.md` |
| Package guide (install, Postgres) | `docs/PACKAGE_README.md` |

`docs/` is a **generated mirror** of the upstream `stable` branch. Don't edit it, because it's wiped on every sync.
Refresh with `npm run docs:sync` (`-- --ref=master` for another branch; set `GITHUB_TOKEN` if rate-limited).
The installed library source is also readable: `node_modules/simplex-chat/src/{api,bot,util,core}.ts`
and the types are in `node_modules/@simplex-chat/types/dist/*.d.ts`.

## Layout

```
AGENTS.md              ← you are here
README.md              ← user-facing overview, setup, configuration
LICENSE                ← AGPL-3.0 (same as simplex-chat)
.env.example           ← every config variable, documented
package.json           ← scripts: dev, build, start, test, typecheck, check, docs:sync, avatar, setup:native
tsconfig.json          ← typecheck config (src + data + test); tsconfig.build.json = build (src + data)
scripts/sync-docs.mjs  ← mirrors upstream docs into docs/
scripts/make-avatar.mjs  ← assets/avatar.svg → avatar.png (512px), avatar-round.png (README) + avatar.jpg (profile pic, ≤ 9K data URI)
scripts/setup-native.mjs ← installs/repairs the simplex-chat native lib + rebuilds the addon
scripts/check-docs.mjs   ← validates command-count, command-table and configuration documentation
assets/                ← avatar.svg (source), avatar.png, avatar-round.png (README), avatar.jpg (default RUBI_AVATAR)
.github/workflows/check.yml ← native-free CI typecheck, tests, build and documentation checks
docs/                  ← GENERATED SimpleX API docs (see above)
data/
  commands/            ← ONE FILE PER COMMAND (auto-loaded, recursive; subfolder = default category)
    help.ts            ← /help — dynamic command list + per-command details
    _template.ts       ← copy-me template with every option (skipped by loader: "_" prefix)
    general/ utility/ web/ fun/ groups/ moderation/ admin/   ← one command per file; folder = category
    system/            ← hidden button targets: vote, page, confirm, cancel
    custom/            ← YOUR OWN commands, gitignored (only its README.md is tracked); category "Custom"
  events/              ← chat event handlers (auto-loaded, recursive)
    groups.ts          ← auto-join group invitations, greet on join + /groupmenu tip (groupMenuTip)
    members.ts         ← custom /welcome for new members
    antispam.ts        ← /antispam: delete links from brand-new members
src/
  index.ts             ← entry: config → Rubi.start(), signals, fatal error reporting
  config.ts            ← RubiConfig + env parsing (.env auto-loaded); welcome message lives here
  paths.ts             ← data/ locations (work from src/ and dist/)
  sdk.ts               ← PUBLIC API for data/ files: defineCommand, defineEvent, fmt, errors, T, …
  core/
    rubi.ts            ← Rubi class: bot.run wiring, core event handlers, menu update, reload, stop
    dispatcher.ts      ← message → command pipeline (parse, checks, args, live, timeout, errors)
    context.ts         ← CommandContext (ctx): where/who/permissions/reply/defer/live/react/members
    command.ts         ← defineCommand + CommandDefinition / Command types
    args.ts            ← tokenizer + typed arg parsing + usage strings
    registry.ts        ← loads data/commands, aliases, suggestions, app command menu
    events.ts          ← EventBus + defineEvent, loads data/events
    messages.ts        ← Messenger: send/update/delete/react, BotMessage, LiveMessage (throttled)
    permissions.ts     ← Permission levels, group role ordering
    cooldowns.ts       ← RateLimiter: cooldowns, anti-flood, throttles
    categories.ts      ← category order + icons for /help and the menu
    errors.ts          ← CommandError family + describeError for library errors
    logger.ts          ← tiny leveled logger
    runtime.ts         ← Runtime interface (what ctx.rt / event handlers get)
    http.ts            ← Http: fetch with timeouts, size caps, friendly errors, proxy/Tor, SSRF guard
    data.ts            ← ChatData: per-group/contact settings in SimpleX customData (GroupSettings type)
    store.ts           ← Store: JSON key-value file (storage/rubi-state.json)
    scheduler.ts       ← Scheduler + defineJob: persistent jobs (reminders, trivia reveal)
    interactions.ts    ← Interactions + defineInteraction: reaction/button messages; REACTIONS
    prompts.ts         ← Prompts: ctx.awaitReply / ctx.confirm waiting for a user's next message
    pages.ts           ← Pages: paginated lists with ◀ ▶ buttons
    lock.ts            ← one-instance-per-database lock
    profile.ts         ← profile size budget: how many bytes the command menu may use next to the avatar
    files.ts           ← TempFiles: attachment files deleted once SimpleX has uploaded them (sndFileCompleteXFTP)
  services/
    geo.ts             ← geocoding, time zones, weather codes (Open-Meteo)
    countries.ts       ← offline country data + findCountry (world-countries, ODbL; REST Countries now needs a key)
    cheapshark.ts      ← /deals: CheapShark game search, every current store deal, historical low and store names
    reddit.ts          ← /reddit: link parsing, share-link unshortening, Arctic Shift API, Reddit→SimpleX markdown, post media
    x.ts               ← /x: link parsing, FxTwitter API, post/quote/reply/poll/community-note formatting, post media
  util/
    format.ts          ← SimpleX markdown helpers (bold, code, bar, mention, duration…)
    ui.ts              ← chat-aware commands/buttons: ctx.ui, makeUi, commandsTappable (see "Tappable commands")
    chat.ts            ← chatRefOf, chatName, itemText … (no native import)
    time.ts            ← parseDuration, parseWhen ("10m", "18:30", "tomorrow 9am"), formatDateTime
    calc.ts            ← safe expression evaluator (no eval)
    units.ts           ← offline /convert units, aliases and affine temperature conversions
    links.ts           ← offline tracking-parameter cleaning and URL extraction
    qr.ts              ← QR code → inline image data URI
    moderation.ts      ← assertCanModerate + moderate() (role checks, friendly chat-core errors)
    media.ts           ← thumbnails (sharp), ffmpeg audio merge / frames, download folders (storage/media)
    attachments.ts     ← download media → SimpleX image/video/file messages → send; fallbacks, DASH audio, notes
test/
  helpers/fake.ts      ← FakeChat (records chat core commands + API calls) + item builders + harness
  core.test.ts         ← parser/args/format unit tests
  bot.test.ts          ← end-to-end dispatcher + /help tests (no native lib needed)
  features.test.ts     ← utilities, polls, confirms, reminders, moderation, trivia, http, lock
  reddit.test.ts       ← /reddit: links, markdown conversion, media extraction, live reply + attachments, temp files
  x.test.ts            ← /x: links, formatting (quotes, replies, polls, notes), media, live reply + attachments
  convert.test.ts      ← /convert: offline unit aliases, conversions, parsing and command replies
  deals.test.ts        ← /deals: CheapShark data, best deals, live image+caption and text fallbacks
  tournament.test.ts   ← /wyr voting and multi-round /trivia tournament scores and jobs
  improvements.test.ts ← preferences, tasks, clean links, future time, events and health diagnostics
storage/               ← SQLite DB files, rubi-state.json, rubi.lock, media/ downloads (gitignored)
```

## How it works

**Boot** (`src/index.ts` → `Rubi.start()`): load the native lib (with a friendly error if it's missing) →
load `data/commands` + `data/events` → `bot.run()` creates or updates the bot profile (`peerType: bot`, the
command menu from the registry), the address (auto-accept, welcome message) and starts chat core.
Event subscribers are passed *into* `bot.run`, so nothing is missed. The `EventBus` holds events until the runtime is ready.

**Message flow** (`Dispatcher`): `newChatItems` → only `rcvMsgContent` from `directRcv`/`groupRcv`
(skips deleted items, members blocked by an admin, and users' live messages until they're finalized) →
`parseCommand` (`/kw args`, also the `/'kw args'` form) → registry lookup (unknown → "did you mean") →
scope → permission → bot role → anti-flood → cooldown → `parseArgs` → optional live placeholder → `run`
with timeout → reply (a returned string/MsgContent is sent as the reply) → errors become user messages.
**Commands are not awaited by the event handler.** The library processes events one at a time, so a slow command
would otherwise block every other event.

**Permissions** (`permission` on a command):
- `everyone` (default) · `moderator` · `admin` · `owner` check the sender's **group member role**
  (`chatItem.chatDir.groupMember.memberRole`, ordered relay < observer < author < member < moderator < admin < owner).
- In DMs there are no roles, so role-gated commands are denied there unless the sender is a bot admin.
- `botAdmin` covers contact ids listed in `RUBI_BOT_ADMINS`. Bot admins pass **every** permission check and skip cooldowns.
  In groups a member counts as a bot admin only if they're linked to that contact (`memberContactId`).
- `botRole`: the minimum role **the bot** needs in the group (e.g. `admin` to remove members). The check uses
  `groupInfo.membership.memberRole`.
- `scope`: `any` | `direct` | `group`. Business chats count as `direct` *and* `group`.
- `/help` only lists what the sender can run here, and says how many commands were left out and why.

**Live replies**: SimpleX live messages are sent with `live=on` and edited in place while live. Clients show them
as being typed. Use `live: true` on a command, or `await ctx.defer()` inside `run`. Then `ctx.progress("…")` updates
it (throttled by `RUBI_LIVE_MIN_INTERVAL_MS`), and `ctx.reply(x)` / `return x` finalizes it (`live=off`).
Errors, timeouts and shutdowns always finalize the placeholder too. Every edit is a network message to every group
member, so keep updates meaningful.

**Errors**: throw `CommandError` (❌), `UsageError` (❌ + usage + help link), `PermissionError` (🔒), `ScopeError` (🚫),
or use `ctx.fail()` / `ctx.usageError()`. Anything else counts as a crash: it's logged with a 6-char ref and the user sees
"💥 Something went wrong… Error ref: ABC123". Bot admins also see the details. `describeError()` unpacks the library's
`ChatCommandError` (`.response`) and `ChatAPIError` (`.chatError`). `chatErrorType(e)` returns tags like `groupUserRole`.

## Utilities (use these instead of reinventing them)

Everything below is exported from `src/sdk.ts` and/or available on `ctx` / `rt`.

- **HTTP:** `await ctx.http.json<T>(url, {service: "Weather", query: {...}})`, plus `.text()` and `.request()`.
  Defaults: 10s timeout, 2 MB cap, cancelled with the command. Failures throw `HttpError` (a 🌐 user-facing reply,
  `.status` set), so catch it for "not found" cases. Use `publicOnly: true` for **user-supplied URLs**: it blocks
  private/LAN addresses on every redirect hop. `RUBI_HTTP_PROXY` routes everything through HTTP or SOCKS5 (Tor).
  In tests, swap `rt.http` for a fake (see `fakeHttp` in `test/features.test.ts`).
- **Group/contact settings:** `await ctx.groupData.get()` and `await ctx.groupData.update((s) => { s.rules = "…" })`.
  Same for `ctx.contactData` in DMs. They're stored in the SimpleX database (`customData.rubi`), and writes per chat
  are serialized. **Add new fields to `GroupSettings` / `ContactSettings` in `src/core/data.ts`.**
- **Persistent store:** `rt.store.collection<V>("name")` gives `get/set/update/delete/values`. It's a JSON file,
  batched and saved atomically. Use it for state that isn't one chat's setting.
- **Scheduler:** call `defineJob<P>("kind", async (job, rt) => …)` at module load, then
  `rt.scheduler.schedule("kind", at, payload)`. Jobs survive restarts and are run once.
  Also: `.list(filter)` and `.cancel(id)`. Payloads must be JSON (store a `ChatRef`, not objects with methods).
- **Buttons:** `ctx.ui.button("🔁", "roll", "2d6")` gives `🔁 /'roll 2d6'`, a tappable command that sends instantly (DMs, and groups
  with `/groupmenu`). `ctx.ui.buttons([...])` makes a row. SimpleX has no inline keyboards, so buttons are just commands.
  See "Tappable commands" for when they're omitted or shown as code.
- **Interactive messages** (polls, quizzes): `defineInteraction<S>("kind", {onReaction, onButton})` at module load.
  Send the message, then call `rt.interactions.create("kind", msg, state, {ttlMs, ownerKey})`. Reactions on that message,
  and `/vote <id> <args>` taps, reach your handlers. Mutate `ix.state` and return the new text
  (or `{text, ack, reply, done}`); Rubi saves the state and edits the message. Handlers for one interaction run one at a time.
  **Reactions are limited to 👍 👎 😀 😂 😢 ❤ 🚀 ✅ (no ❤️ variation selector — use `normalizeReaction`), max 3 per user per message.**
- **Prompts:** `await ctx.confirm("Kick @x?")` shows ✅ /confirm and ✖ /cancel buttons; only the invoker can answer,
  it defaults to a 60s timeout, and the question is edited with the outcome. `await ctx.awaitReply("Question?")` returns the user's next
  message, or `undefined` on timeout or /cancel. Other commands keep working while one is waiting. Don't combine
  them with `live: true` (the placeholder would sit there while waiting).
- **Pagination:** `await ctx.paginate({title, items, perPage})` shows ◀ ▶ `/page` buttons. Pages are in memory for 30 min and
  are bound to their chat.
- **Attachments from the web:** `/reddit <url>-`, `/x <url>-`, and `/reddit -` / `/r -` / `/x -` in reply to a link
  list the available media but deliberately make no media downloads or sends (see "Library quirks"). Otherwise,
  describe media as `MediaItem`s (`{kind, url, alts?, previewUrl?, duration?, caption?}`), then
  `const dl = await downloadAttachments(ctx, items, {label, headers, onProgress})` downloads them (3 at a time, fallbacks
  in `alts` for 404s / too-big files, GIFs over 10 MB swapped for their MP4, DASH audio merged by ffmpeg) and builds
  `image`/`video`/`file` messages with previews (`thumbnail()`, sharp). Reply with the text first, then
  `await sendAttachments(ctx, dl, msg.itemId)`. `dl.notes` has user-facing warnings. Check `attachmentsBlocked(ctx)` first.
  **Files are temporary**: `rt.tempFiles` deletes each folder a minute after SimpleX reports its uploads done
  (`sndFileCompleteXFTP`), right away on errors, after 30 min at the latest, and `storage/media` is emptied on start.
  Lower level: `ctx.http.download(url, path, {maxBytes, accept})`. See `data/commands/web/x.ts`.
- **Images:** `await ctx.replyImage(dataUri, caption)`. The data URI must be ≤ ~12.5K chars and start with `data:image/png;base64,`
  or `data:image/jpg;base64,`. `qrDataUri(text)` makes QR codes that fit. For a live command, `replyImage` deletes the
  text placeholder and sends one image message containing the caption (SimpleX cannot turn live text into an image).
- **Offline units:** `/convert <amount> <from> [to] <to>` uses `convertUnits`/`findUnit` in `src/util/units.ts`.
  Categories: length, mass, temperature (affine), area, volume, speed, time, data, energy, power, pressure and angle.
  `/convert units` is the compact reference; `/currency` keeps money conversion and has the `fx` alias (not `convert`).
- **Tournament and WYR:** `/trivia tournament [2–10] [difficulty]` fetches all questions once, persists scores/names in
  interaction state, and schedules `trivia-reveal` then `tournament-next` (5s between rounds). `/wyr [A | B]` uses a
  built-in prompt if no options are given; votes can change via reactions or buttons.
- **CheapShark deals:** `/deals <title>` calls `/games` search + `/games?id` + `/stores`, then shows every current
  store's USD price, retail price, discount and CheapShark redirect on the following line, plus historical low and tied
  best deals. The game
  thumbnail is downloaded and reduced with `thumbnail()`, and sent in the same image message as the complete caption
  (text fallback if unavailable). CheapShark requires its redirect URLs, not direct store links.
- **Personal/group organization:** `/prefs` stores DM-only weather/country/currency defaults; `/todo` stores bounded
  personal or group tasks; `/event` creates one-off visible group RSVPs with a scheduled reminder; `/cleanlink` removes
  common tracking parameters without opening the URL; `/time at` converts an explicit ISO instant across IANA zones.
- **Time:** `parseWhen("tomorrow 9:00 call mom", now, tz)` gives `{at, rest}`; also `parseDuration("1h30m")`,
  `formatDateTime(at, tz)` and `fmt.relative(at)`.
- **Moderation:** `assertCanModerate(ctx, target, "kick")` checks not self, not the bot, and that both the invoker's and the
  bot's roles are high enough. `await moderate(() => ctx.chat.api…())` maps chat-core role errors to friendly messages.
- **Places:** `geocode(ctx.http, "Oslo")`, `placeLabel`, `isTimeZone`, `utcOffset`, `weatherCode`.
- `ctx.fail()` / `ctx.usageError()` return `never`. Write `return ctx.fail("…")` so TypeScript narrows types after it.

## Adding a command (the common task)

1. Copy `data/commands/_template.ts` to `data/commands/<name>.ts`, or `data/commands/<category>/<name>.ts`.
   The subfolder name becomes the default category. Known categories (order + icons) are in `src/core/categories.ts`.
2. `export default defineCommand({...})`. Only `name`, `description` and `run` are required.
   Import **only from `../../src/sdk`** (`../../../src/sdk` from a subfolder).
3. `run(ctx)` returns a string (the reply) or calls `ctx.reply()`. `ctx.args` is typed from `args`.
4. That's it: `/help`, the app's command menu, aliases and validation all pick it up automatically.
   The menu syncs to the bot profile on the next start.
5. Add a test (`test/bot.test.ts` for core behaviour, `test/features.test.ts` for commands) using the harness
   (`makeHarness`, `dm()`, `groupMsg()`, `member()`, `h.react()`, `fakeHttp`), then run `npm run check`.

**Custom commands** (a user's own, for their copy only) go in `data/commands/custom/` (🧩 Custom category). That
folder is gitignored except its README, and `scripts/check-docs.mjs` skips it, so they're never committed and never
counted in the README. **Never add built-in commands there, and never commit files from it.** They load like any other
command, so they're also in the local test registry and name clashes with built-ins fail the load.

Conventions:
- Lowercase keywords (`[a-z0-9_]`, unicode letters allowed). There are no duplicate names/aliases; the loader rejects clashes.
- Keep `description` to one short line; it's the menu label (examples after a colon are dropped there). Put long text in `details`.
- Use `fmt.*` for SimpleX markdown (`*bold*`, `_italic_`, `` `code` ``, `!1 red!`). SimpleX only starts formatting at
  the **start of a word** (after a space): `Rubi_(me)_` shows the underscores. `fmt.italic(" (me)")` keeps the space outside
  the markers for you, so put the separating space *inside* the call rather than gluing markers to text. Formatting doesn't nest.
  Newer SimpleX versions (the core's current markdown parser) also render `#` headings, `-`/`1.` lists, `>` quotes, tables and fenced code; older apps show them as
  plain text, so only use them where that still reads fine (e.g. /reddit). Use `ctx.ui.cmd("help", "ping")` for
  command references (never `fmt.command`), and `ctx.mention(member)` for real @mentions.
- Admin or moderation commands: `scope: "group"`, `permission: "admin"`, plus `botRole` when the bot itself acts;
  call `assertCanModerate` and wrap the API call in `moderate()`. Ask `ctx.confirm()` for destructive actions.
- Offer buttons for the obvious next step (🔁 again, cancel, next page) with `ctx.ui.button`; mark only must-have ones `{important: true}`.
- Things a user creates (polls, reminders, …) can only be closed or cancelled **by that user**: store `ctx.sender.key`
  (`ownerKey` on interactions) and compare it. No admin override; group admins have moderation commands for abuse.
- Long work: `live: true`, honor `ctx.signal`, set `timeout`. Live texts never end in "…".
- Raw API: `ctx.chat.api*()` (see `docs/api.Class.ChatApi.md`). For anything not wrapped, use
  `ctx.chat.sendChatCmd(CC.X.cmdString({...}))` (see `docs/bot-api/COMMANDS.md`) and check `r.type`.

## Adding an event handler

`data/events/<name>.ts`: `export default defineEvent("<eventTag>", async (evt, rt) => {...})`, or an array of them.
Tags and fields are in `docs/bot-api/EVENTS.md`. Handlers run in order inside the library's single event loop,
so keep them quick (start long work without awaiting it). Errors are caught and logged.
Don't handle `newChatItems` for commands, because the dispatcher already does that.

## Library quirks (verified against simplex-chat 7.0.2)

- `ChatApi.apiChatItemReaction` checks for `chatItemsDeleted` instead of `chatItemReaction`, so it **always throws**.
  Use `Messenger.react` / `ctx.react`.
- `ChatApi.apiUpdateChatItem` hard-codes `liveMessage: false` and drops the group chat scope, so it can't do live
  edits. Use `Messenger.update` / `LiveMessage`.
- `ChatApi` event handlers are awaited one at a time. A slow handler delays all events.
- `bot.run` calls `process.exit()` on some setup failures, e.g. when `useBotProfile` is combined with custom
  `files/calls/voice/commands` preferences. Pass the command menu via `options.commands`, never via `profile.preferences`.
- Importing `simplex-chat` at runtime loads the native addon. Core modules only `import type` from it.
  `src/core/rubi.ts` is the only runtime import, so tests run without the native lib.
- Native addon: `npm install` runs `node-gyp`. On Windows that needs **VS Build Tools ("Desktop development with C++")**.
  Otherwise use WSL/Linux/macOS. Postgres backend: Linux x86_64 only.
- The package's preinstall unzip (`extract-zip`) **stops silently partway on Node 26**. It leaves a truncated
  `libsimplex.dll` and no `libsimplex.lib`, so linking fails with LNK1104. Fix: `npm run setup:native`.
- npm 11 only runs approved install scripts. `simplex-chat` and `esbuild` are approved in `package.json` → `allowScripts`;
  the dependency ranges remain managed by `package-lock.json`. **When you bump `simplex-chat`, re-approve it** (`npm install-scripts approve simplex-chat`),
  or the addon won't be built.
- Profile images must stay under ~12.5K chars as a data URI. `src/config.ts` warns when they don't. But the whole
  profile (avatar + menu + address link) must also stay under 14 694 bytes, so `npm run avatar` aims for ≤ 9K.
- Profile image data URIs **must** start with `data:image/jpg;base64,` or `data:image/png;base64,`. The apps strip
  only those exact prefixes, so the standard `image/jpeg` shows up as a **blank avatar**. A test in
  `test/core.test.ts` guards this.
- **Never run two Rubi instances on the same database.** Each new subscriber takes the SMP queues from the
  other, so messages get lost. `storage/rubi.lock` now refuses a second live instance. **Before starting the bot
  (e.g. to test), check whether the user already has it running.** If two did run at once, restart the remaining one.
- Running the bot in the background on Windows: stopping `npx tsx …` can leave the child `node` process running,
  which keeps the database open. Check for leftover `node.exe` processes running `src/index.ts`.
- Group welcomes: `connectedToGroupMember` also fires for every existing member when Rubi itself joins a group,
  so `data/events/members.ts` only greets members first announced via `joinedGroupMemberConnecting`, or joined via Rubi.
  Similarly, a member's `createdAt` is when *Rubi* first saw them; anti-spam only treats members as new if they joined after Rubi.
- `meta.userMention` is also true for **replies** to the bot's messages (core: `userMention = userReply || mentioned`).
  To detect a real @mention, check `chatItem.mentions` for the bot's `membership.memberId` (see `mentionsBot` in the
  dispatcher). Otherwise the bot answers every reply to its own messages.
- **Replies as Reddit/X input:** `chatItem.quotedItem.content.text` contains the replied-to message, in DMs and groups.
  `/reddit` and `/r` use `findRedditLink` on it; `/x` uses `findXLink` (the first supported post URL, ignoring prose and
  trailing punctuation). No history API is needed. Explicit URLs still go through `parseRedditLink` / `parseXLink`.
- **Reddit/X without attachments:** appending `-` to the URL (`/r <url>-`) or using it alone after the command
  (`/x <url> -`, `/reddit -` as a reply) skips all media downloads and attachment sends. The response reports the
  available media with `describeMedia(...)` and "available · not downloaded"; fetching the post itself still happens.
- Sending files: in DMs the bot's own "files" preference doesn't matter (core only checks voice). In groups the group's
  `files` preference must allow the bot's role (`groupInfo.fullGroupPreferences.files`), or sending fails.
- Reddit: share links are resolved with Arctic Shift's `/api/short_links` first (it only knows links it has seen in
  posts/comments); the fallback is following the redirect, which only works for browser-like requests (see `BROWSER_HEADERS`), and
  i.redd.it serves its HTML image viewer to requests whose Accept includes `text/html`, so media downloads use
  `MEDIA_HEADERS`. Reddit videos keep audio in a separate DASH track; ffmpeg muxes it in.
- X: FxTwitter's v1 endpoint (`api.fxtwitter.com/<user>/status/<id>`) answers 404 with JSON `{code, message}`.
  Community notes come with links shortened in the text; `noteText` expands them from `entities`/`facets`.
- `#word` in text is parsed by SimpleX as a SimpleX *name* link. Text from other sites gets a word joiner after `#`
  (`plainText` in x.ts, `inlineToSimplex` in reddit.ts) so hashtags stay plain.
- The package is CommonJS. Command files are loaded with `require` (tsx handles `.ts` in dev).

## Workflow

- `npm run dev`: run from TypeScript (tsx). `npm run build && npm start`: compiled (`dist/`).
- `npm run check`: typecheck + tests. **Keep it green.** Tests use `FakeChat` and need no native library or external network.
- Don't commit `storage/` (the chat database holds the bot's identity and keys) or `.env`.
- Don't change the welcome message text without being asked. It's specified as exactly `Hi, I'm Rubi. Send /help.`
