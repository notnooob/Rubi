# Using Rubi

This page is for everyone who talks to Rubi, in a direct chat or in a group. For the details of every command, see the
[command reference](commands.md). Group admins also have the [group admin guide](group-admins.md).

- [Sending commands](#sending-commands)
- [Buttons and tappable commands](#buttons-and-tappable-commands)
- [Arguments: members, numbers, times](#arguments-members-numbers-times)
- [Live replies, cooldowns and errors](#live-replies-cooldowns-and-errors)
- [Reminders](#reminders)
- [Polls, games and events](#polls-games-and-events)
- [Tasks, time zones and personal defaults](#tasks-time-zones-and-personal-defaults)
- [Web lookups, Reddit and X](#web-lookups-reddit-and-x)
- [Away and last seen](#away-and-last-seen)
- [Privacy: what Rubi sees and keeps](#privacy-what-rubi-sees-and-keeps)

## Sending commands

A command is a message that starts with `/`, followed by the command name and its arguments:

```
/weather Oslo
/remind 10m stretch
/poll Movie night? | Friday | Saturday
```

- **In a direct chat** with Rubi, everything you send goes to Rubi. Plain messages (not commands) get a short hint to
  send `/help`.
- **In a group**, Rubi only reacts to commands. If you @mention Rubi without a command, it answers with a `/help` hint.
  Replying to one of Rubi's messages doesn't count as talking to it.
- `/help` shows the commands you can use **in that chat**: commands that need a group role you don't have, or that only
  work in DMs or groups, are left out (the list says how many and why). Group admins can also turn commands off for
  their group; those are hidden too.
- `/help utility` lists one category with descriptions. `/help remind` shows everything about one command: usage,
  arguments, examples, who can use it, where it works and its cooldown.
- An unknown command gets a "did you mean" suggestion in DMs. In groups Rubi stays quiet by default, because groups often
  have several bots.

Command names are case-insensitive (`/Weather` works). Some commands have short aliases, like `/r` for `/reddit`; the
reference lists them.

## Buttons and tappable commands

SimpleX has no inline buttons, so Rubi's "buttons" are commands you can tap. Where tapping works depends on the app:

- **Direct chats with Rubi:** commands in Rubi's messages are always tappable, and the `/` button in the message bar
  shows Rubi's command menu.
- **Groups:** only when an owner turned on Rubi's group menu (`/groupmenu`). Then commands are tappable and the `/`
  menu shows Rubi's commands there too.
- **Anywhere else**, commands show as `code` you can copy, and optional buttons (like 🔁 "again") are left out.
  Buttons you need, such as ✅ confirm or ✖ cancel, still show as code.

**Reactions** work everywhere: vote in polls, trivia and would-you-rather by reacting to Rubi's message with the
option's emoji. SimpleX allows these reactions: 👍 👎 😀 😂 😢 ❤ 🚀 ✅, up to 3 per person per message.

**Confirmations:** destructive commands (like `/kick`) ask first. Answer with the ✅ `/confirm` or ✖ `/cancel` shown,
or type `yes` / `no`. Only the person who ran the command can answer, and the question expires after a minute.

## Arguments: members, numbers, times

The usage line in `/help <command>` shows each argument: `<name>` is required, `[name]` is optional, `name...` takes
the rest of the message, and `a|b` means one of those words. If an argument is wrong, Rubi shows the usage line and a
link to the details.

- **Words with spaces:** put them in quotes, `"like this"`. The last argument usually takes the rest of the message
  anyway, so quotes are rarely needed.
- **Members** (groups only): an @mention (`@bob`), a name with spaces in quotes (`@'Jo Do'`), or a member id (`#12`,
  shown by `/members`). If a name matches several members, Rubi asks you to use the id.
- **Numbers** may have commas between digits: `1,000`, `2d1,000`, `1,234.5`.
- **Durations:** `30s`, `10m`, `1h30m`, `2d`, `1w`, `2 hours`, `1h 30m`.
- **Times:** `18:30`, `6pm`, `6:30am`, `tomorrow 9:00`. A bare number like `6` isn't a time.
- **Dates:** `dec 24`, `24 december`, `december 24th 18:00`, `2026-12-24 8am`, `friday 9:00`, `on fri`. Without a
  time it's 9:00. A date without a year that has already passed means next year.

Times use your time zone if you set one with `/time set <place>` in a DM with Rubi, otherwise the time zone of the
server Rubi runs on. Times in groups always use the server's.

## Live replies, cooldowns and errors

- **Live replies:** commands that take a moment (web lookups, Reddit, X) post a placeholder right away, like
  "⏳ Working on /weather 3s", and edit it into the answer. Your app shows it as being typed.
- **Cooldowns:** after you use a command, you wait a couple of seconds before using the same one again (some commands
  wait longer; see the reference). If you send many commands quickly, Rubi asks you to slow down and ignores the
  rest for a few seconds. Typos don't start a cooldown.
- **Errors:** ❌ means the input wasn't right (Rubi says what to fix), 🔒 means you need a role you don't have, and 🚫
  means the command doesn't work in this kind of chat. 💥 "Something went wrong" is a bug: it comes with an
  `Error ref` that the people running Rubi can look up.
- **While Rubi is offline:** commands sent while Rubi was down are not answered when it comes back (unless whoever runs
  it changed that), so you don't get a burst of late replies. Just send the command again.

## Reminders

```
/remind 10m stretch
/remind 1h30m check the oven
/remind 18:30 call mom
/remind tomorrow 9:00 dentist
/remind dec 24 18:00 wrap presents
/remind friday 9:00 send the report
```

Rubi replies in the same chat when it's time, quoting your `/remind` message. In groups it @mentions you. Reminders
survive restarts.

- **Repeating:** `/remind every 2h drink water`, `/remind every day 9:00 standup`, `/remind every monday 18:00 gym`.
  Intervals must be at least an hour, and `every day` / `every <weekday>` need a time. Daily and weekly reminders stay at
  the same clock time when daylight saving time changes. Runs missed while Rubi was offline are skipped, not sent all
  at once.
- **For someone else** (groups): start with their name, `/remind @bob 1h check the PR` or
  `/remind @'Jo Do' every friday 16:00 timesheet`. The reminder @mentions them and says it's from you. You own it: it's
  in your `/reminders` and only you can cancel it.
- **See and cancel:** `/reminders` lists yours in this chat, with a ✖ to cancel each one (`/unremind <id>`). Only the
  person who set a reminder can cancel it.
- **Limits:** at least 10 seconds ahead, at most a year, and 25 reminders per person.
- If you leave a group, or are removed, the reminders you set there, and the ones others set for you there, are
  cancelled.

## Polls, games and events

**Polls:** `/poll Pizza tonight? | yes | no | maybe`. Separate the question and up to 8 options with `|`. With no
options it's a 👍/👎 poll. Vote by reacting with the option's emoji, or tap its vote button where commands are tappable.
Each person has one vote, and changing your reaction changes it. Only the person who started a poll can close it with
`/endpoll <id>` (the button is on the poll), which shows the final result.

**Trivia:** `/trivia` (or `/trivia hard`) asks a question; answer by reacting with the emoji of your answer. The answer
is revealed after 30 seconds. `/trivia tournament 5 medium` plays several rounds (2–10) and keeps score.

**Would you rather:** `/wyr` asks a random question, or `/wyr Explore space | Explore the ocean` asks yours. Vote with
reactions; you can change your vote.

**Events** (groups): `/event new tomorrow 18:30 | Europe/London | Book club` creates an event with a time zone and
visible RSVPs. Members answer with the 👍 yes, 😀 maybe or 👎 no reactions, or `/event rsvp <id> yes|maybe|no`.
`/event list` shows upcoming events. Rubi posts a reminder when the event starts. Only the creator can
`/event cancel <id>`.

**More fun:** `/8ball`, `/coinflip`, `/rps rock`, `/roll 2d6+3`, `/choose tea or coffee`, `/joke`, `/fact`, `/quote`,
`/xkcd`.

## Tasks, time zones and personal defaults

- **Tasks:** `/todo add bring projector`, `/todo list`, `/todo claim <id>`, `/todo done <id>`, `/todo remove <id>`.
  In a DM it's your personal list; in a group it's the group's shared list (up to 100 tasks). The creator or whoever
  claimed a task can complete it; only the creator can remove it.
- **Time zone:** `/time Tokyo` shows the time anywhere. In a DM, `/time set London` saves your time zone, which
  `/remind` then uses for clock times and dates. `/time at 2030-01-01T18:00:00Z | UTC | America/New_York` converts an
  exact moment between zones.
- **Personal defaults** (DMs only): `/prefs set weather Oslo`, `/prefs set country de`, `/prefs set currency EUR`. When
  you leave out the place, country or currency in a DM, Rubi uses these. `/prefs` shows them and `/prefs reset <key>`
  removes one.

## Web lookups, Reddit and X

`/weather`, `/wiki`, `/define`, `/currency`, `/crypto`, `/country`, `/holidays`, `/time`, `/github`, `/npm`, `/hn`,
`/dns`, `/status`, `/deals` and `/xkcd` fetch information from public services (each command's details say which). They
answer with a live reply.

**Reddit and X posts:** `/reddit <link>` (or `/r`) and `/x <link>` show the post's text and stats and attach its images
and videos. Shortcuts:

- **Reply** to a message that contains a link with just `/r` or `/x` to show that post.
- **Add `-`** to skip the media: `/r <link>-`, `/x <link> -`, or reply with `/r -`. Rubi then only lists the media.
- Media of NSFW or sensitive posts is only sent in DMs.

**Other tools:** `/calc (2+3)*4^2`, `/convert 32 F to C` (offline units), `/qr <text>`, `/uuid`, `/hash sha256 <text>`,
`/base64 encode <text>`, `/timestamp`, `/cleanlink <url>` (removes tracking parameters without opening the link), and
`/password` (DMs only, so it isn't shown to a group).

## Away and last seen

- `/afk lunch, back at 2` (or `/away`, `/brb`) marks you as away in that group. When someone @mentions you, Rubi
  replies that you're away, with your reason (at most once a minute). As soon as you post again, Rubi welcomes you back
  and the away status ends.
- `/seen @bob` shows when Bob last posted in the group (to the minute), and whether they're away. Rubi only knows about
  messages since it joined the group.

## Privacy: what Rubi sees and keeps

Rubi is a regular SimpleX contact or group member. It sees what you send to it in DMs, and the messages in groups it's
in. What it keeps:

- **Your settings** (time zone, personal defaults, personal tasks) and **group settings** (rules, welcome message,
  banned words, warnings, events, tasks) are stored in Rubi's own SimpleX database, attached to that chat.
- **Scheduled things** (reminders, event reminders, timed blocks), open polls and games, and the time each member last
  posted in a group (for `/seen`) and away statuses are kept in a small state file next to that database.
- Rubi doesn't log message contents. It logs which commands ran, for whom and how long they took.
- Group admins can ask Rubi to DM them a [moderation log](group-admins.md#the-moderation-log) of moderation actions in
  their group, which can include removed messages. Nothing from that log is posted in the group.
- When Rubi leaves a group, it deletes that group's scheduled jobs, polls and last-seen records. When you leave a
  group, your last-seen and away records there are deleted.
- Web lookups go to the public service the command names (for example Open-Meteo for `/weather`). Whoever runs Rubi can
  route them through Tor.
