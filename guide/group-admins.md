# Group admin guide

For group owners, admins and moderators. It covers adding Rubi to a group, the roles it needs, and every group setting.
Exact usage of each command is in the [command reference](commands.md); what members can do is in
[Using Rubi](using-rubi.md).

- [Setting up a group](#setting-up-a-group)
- [Roles: yours and Rubi's](#roles-yours-and-rubis)
- [Group basics](#group-basics)
- [Moderation toolkit](#moderation-toolkit)
- [Automatic moderation](#automatic-moderation)
- [The moderation log](#the-moderation-log)
- [Turning commands off](#turning-commands-off)
- [What's public and what stays private](#whats-public-and-what-stays-private)
- [Group settings at a glance](#group-settings-at-a-glance)
- [Troubleshooting](#troubleshooting)

## Setting up a group

1. **Invite Rubi** to the group like any contact: in the group, add a member and pick Rubi. (Connect to Rubi first if
   you haven't; anyone can send `/invite` in a chat with Rubi to get its address.) Rubi accepts group invitations
   automatically, unless whoever runs it turned that off.
2. Rubi says hello in the group, and if the group has no command menu yet, explains `/groupmenu`.
3. **Give Rubi a role.** As a plain member it can run all the everyday commands. For moderation it needs more; see
   [Roles](#roles-yours-and-rubis). Most groups make Rubi an **admin**. Make it an **owner** if you want tappable
   commands.
4. **Make commands tappable** (optional, owners only): with Rubi as an owner, send `/groupmenu`. SimpleX apps then make
   commands in Rubi's messages tappable in this group and show Rubi's commands in the `/` menu. Members may need to
   reopen the chat. `/groupmenu off` removes it. Without it, commands show as `code`, and members vote with reactions
   instead of buttons.
5. **Set the basics:** `/rules set …`, `/welcome set …`, and whatever automatic moderation you want (below).
6. **Get the moderation log** by DM: `/modlog on` (see [The moderation log](#the-moderation-log)).

`/groupinfo` shows the group, Rubi's role and the current settings at any time.

## Roles: yours and Rubi's

Commands check **your** role in the group, and some also need **Rubi's** role, because SimpleX only lets members
moderate members below them.

| You need to be | Commands |
|---|---|
| Anyone | everyday commands, `/rules`, `/members`, `/groupinfo`, `/event`, `/seen`, `/afk`, `/warnings` (your own) |
| Moderator | `/delete`, `/purge`, `/block`, `/unblock`, `/warn`, `/unwarn`, `/warnings @member` |
| Admin | `/kick`, `/role`, `/link`, `/welcome`, `/rules set`, `/warn limit`, `/antispam`, `/filter`, `/slowmode`, `/toggle`, `/modlog`, `/feed add/remove` |
| Owner | `/groupmenu` |

| Rubi needs to be | For |
|---|---|
| Member | everything that doesn't moderate |
| Moderator | deleting messages (`/delete`, `/purge`, anti-spam, banned words, slow mode), `/block` and timed blocks |
| Admin | `/kick`, `/role`, `/link`, removing members at the warning limit |
| Owner | `/groupmenu`, and deleting admins' messages (for example the `/filter add` message itself) |

On top of that, you can only act on members whose role is **below yours** (owners can act on owners), and Rubi only on
members whose role isn't above its own. You can't give a role higher than your own with `/role`. People who run Rubi
(bot admins) pass the "your role" checks.

## Group basics

- **Rules:** `/rules` shows them to anyone. Admins: `/rules set 1. Be kind. 2. No spam.` and `/rules clear`.
- **Welcome message:** `/welcome set Welcome {name}! Please read /rules 🙂`. `{name}` becomes an @mention of the new
  member and `{group}` the group name. `/welcome test` previews it, `/welcome off` turns it off. New members are greeted
  once Rubi is connected to them. Members who were already there when Rubi joined aren't greeted.
- **Invite link:** `/link` shows the group's invite link (creating one if needed), `/link new` replaces it, and
  `/link delete` removes it. Rubi must be an admin.
- **Members:** `/members` lists members and their roles, with the `#id`s you can use in commands. `/groupinfo` shows
  counts per role and the settings.
- **Events and tasks:** members can create events (`/event`) and use a shared task list (`/todo`). See
  [Using Rubi](using-rubi.md#polls-games-and-events).

## Feeds

`/feed add <url>` makes Rubi post new entries of an RSS or Atom feed in the group. Rubi checks every 30 minutes and
posts at most five new entries at a time. The URL can be the feed itself or a page that links to it:

- blogs and news sites: the site's address is usually enough
- GitHub releases: `https://github.com/<owner>/<repo>/releases.atom`
- subreddits: `https://www.reddit.com/r/<name>/.rss`
- YouTube channels and Mastodon profiles: the channel or profile page

`/feed` lists the group's feeds with their ids (anyone can see it), and `/feed remove <id>` stops one. A group can
follow up to 10 feeds. When a feed can't be fetched, Rubi keeps trying and `/feed` shows the error.

## Moderation toolkit

| Task | Command | Notes |
|---|---|---|
| Delete one message | reply to it with `/delete` | Your `/delete` message is removed too. Works on Rubi's own messages as well. |
| Delete recent messages | `/purge 10`, `/purge 20 @spammer` | Up to 50, after you confirm. Skips messages from members whose role is equal to or higher than yours or Rubi's. |
| Hide someone's messages | `/block @troll`, `/block @troll 2h` | Blocked members stay in the group, but nobody sees their new messages. With a duration (1 minute to 30 days) Rubi unblocks them automatically and says so. |
| Undo a block | `/unblock @troll` | Also cancels a pending timed unblock. |
| Remove a member | `/kick @spammer advertising` | Asks for confirmation. Their earlier messages stay; `/purge 50 @member` removes recent ones first. |
| Change a role | `/role @alice moderator` | observer, author, member, moderator, admin or owner. Making someone an owner asks first. |
| Warn | `/warn @bob please keep it civil` | Counts per member. At the limit Rubi removes the member (if it's an admin). |
| Warning limit | `/warn limit 5` | Default 3; `0` never removes. Admins only. |
| See warnings | `/warnings`, `/warnings @bob` | Members see their own; moderators see anyone's. |
| Clear warnings | `/unwarn @bob` | |

Every one of these is also sent to the [moderation log](#the-moderation-log).

## Automatic moderation

All three below only affect members **below moderator**: moderators, admins and owners are never filtered or slowed
down. Rubi must be a moderator or higher. They check **edited messages** too, so a member can't post something harmless
and edit it later (SimpleX's "live" messages, which update as you type, arrive as edits and are checked the same way).

### Anti-spam for new members

`/antispam on` deletes links posted by members who joined less than 24 hours ago. "Joined" means after Rubi joined:
members who were there before Rubi are never treated as new. Rubi posts a short notice (at most once per member every
10 minutes). `/antispam off` turns it off.

### Banned words: `/filter`

Messages containing a banned word or phrase are deleted. Rubi posts a short notice in the group ("Removed a message from
@x: it contained a blocked word", at most once a minute per member) without repeating the word.

**Adding and removing words** (separate several with commas):

```
/filter add spam, buy now, crypto*
/filter remove buy now
/filter remove crypto*
/filter clear
```

- Entries are phrases too (`buy now`), and matching ignores case.
- `*` matches the rest of a word: `crypto*` also blocks "cryptocoin" and "cryptos".
- `remove` takes exact entries, or `*` patterns that remove every matching entry (`/filter remove crypto*` removes
  `crypto*`, `cryptocoin` and anything else starting with "crypto").
- Up to 500 entries, each up to 60 characters.
- Rubi tries to delete your `/filter add|remove` message so the words don't stay visible. That only works if Rubi's role
  is above yours (an owner, when you're an admin); otherwise delete it yourself.

**Seeing the list:** `/filter list` sends you the list **by DM**, never in the group. That needs your DMs linked with
`/modlog on` first. `/filter` alone shows how many words there are and the current action and level.

**What else happens** (`/filter action …`):

| Setting | What happens to the message's author |
|---|---|
| `/filter action delete` | Nothing else: the message is deleted (default). |
| `/filter action warn` | They get a warning ("used a banned word"), so the [warning limit](#moderation-toolkit) applies: at the limit they're removed (Rubi must be an admin for that). |
| `/filter action block 1h` | They're blocked for that long (1 minute to 30 days, default 10 minutes), then unblocked automatically. |

**How hard the filter looks** (`/filter level …`):

| Level | Catches | Watch out for |
|---|---|---|
| `normal` (default) | The word itself, in any case, as a whole word: `spam`, `SPAM`, `Spam!` | Nothing: "class" doesn't match "ass". |
| `strict` | Also look-alike and decorated letters (Cyrillic `ѕраm`, `𝓈𝓅𝒶𝓂`, accents), digits and symbols used as letters (`sp4m`, `$pam`, `@ss`), hidden zero-width characters and stretched letters (`spaaaam`) | A word written with digits on purpose can match a banned word (`b4` reads as "ba"). |
| `max` | Everything in strict, plus letters split by spaces or dots (`s p a m`, `s.p.a.m`), and words **inside** longer words | False positives: banning "ass" also blocks "class" and "passport". Ban specific words. |

Start with `normal`, and move up only if people get around the filter.

### Slow mode: `/slowmode`

`/slowmode 30s` lets each member send one message per interval (5 seconds to 6 hours). Faster messages are deleted, and
Rubi tells the member how long to wait (at most once a minute). Commands don't count, and edits don't either.
`/slowmode off` turns it off; `/slowmode` shows the current setting. Slow mode starts fresh when Rubi restarts.

## The moderation log

Rubi can send each moderation action in a group to its admins **by DM**: kicks, role changes, blocks, warnings, deleted
and purged messages (with their text), what the filter and anti-spam removed, what slow mode removed (the first message per member each minute, so a fast poster doesn't flood your DMs), and every settings change
(banned words, filter action and level, slow mode, warning limit, turned-off commands). None of it is posted in the
group.

**Turn it on:** send `/modlog on` in the group. Only admins (and owners) can, and Rubi checks that you're still an
admin each time it sends a line, so a demoted admin stops getting it. `/modlog off` stops it for you; `/modlog` shows
whether you get it and how many admins do.

**How Rubi reaches you.** SimpleX deliberately doesn't connect your group membership with any other chat, so Rubi needs a
way to DM the same person:

1. **You already have a chat with Rubi through this group** (for example, you accepted a contact request from Rubi in a
   group before). Rubi uses it and confirms there.
2. **Otherwise, Rubi sends you a contact request inside the group.** Accept it, and the log arrives in that new chat.
   This uses the profile you joined the group with, so if you joined **incognito**, the chat stays incognito too.
   This needs the group to allow direct messages between members.
3. **To use a different profile** (for example your main profile instead of the incognito one you joined with), or when
   the group doesn't allow direct messages: send `/modlog link` to Rubi in a DM **from the profile you want the log
   on**. Rubi answers with a one-time code. Then send `/modlog on <code>` in the group within 10 minutes. The code works
   once, and Rubi tries to delete your message with it.

Linking your DMs this way also lets Rubi send you private answers, like `/filter list`.

## Turning commands off

Some groups only want the moderation tools, or no games. `/toggle off <commands or categories>` turns commands off in
this group, for everyone, admins included:

```
/toggle off fun
/toggle off trivia, joke, 8ball
/toggle off web
/toggle on trivia
/toggle
```

- Name commands, aliases (`/r` for `/reddit`) or whole categories (`general`, `utility`, `web`, `fun`, `groups`,
  `moderation`), separated by commas or spaces.
- Turned-off commands don't run; the first time someone tries one, Rubi says it's turned off (then stays quiet for 10
  minutes for that person). They're hidden from `/help`, and if the group has Rubi's `/groupmenu`, from the group's `/`
  menu too.
- `/help` and `/toggle` itself can't be turned off. Buttons Rubi needs (confirm, cancel, voting, pages) keep working.
- `/toggle` alone lists what's off.

## What's public and what stays private

| Posted in the group | Only by DM, to admins |
|---|---|
| Moderation results: "@x was removed", "@x is blocked for 10m", "@x has been warned (2/3)" with the reason you gave | The [moderation log](#the-moderation-log), including the text of deleted, filtered and purged messages |
| Short notices: "Removed a message from @x: it contained a blocked word", slow-mode and anti-spam notices | The banned-word list (`/filter list`) and the words you add or remove |
| `/warnings` replies (a moderator asking about a member sees the reasons in the group) | |

Messages you write in the group, including commands like `/warn @bob <reason>`, are visible to everyone like any other
message.

## Group settings at a glance

All of these are stored per group in Rubi's SimpleX database, and `/groupinfo` summarizes them.

| Setting | Change with | Default |
|---|---|---|
| Rules | `/rules set …`, `/rules clear` | none |
| Welcome message | `/welcome set …`, `/welcome off` | off |
| Command menu (tappable commands) | `/groupmenu`, `/groupmenu off` (owners; stored in the group profile) | off |
| Anti-spam | `/antispam on/off` | off |
| Banned words | `/filter add/remove/clear` | none |
| Filter action | `/filter action delete/warn/block [time]` | delete |
| Filter level | `/filter level normal/strict/max` | normal |
| Slow mode | `/slowmode <interval>`, `/slowmode off` | off |
| Warning limit | `/warn limit <0–50>` | 3 |
| Turned-off commands | `/toggle on/off …` | none |
| Feeds | `/feed add/remove` | none |
| Moderation log recipients | `/modlog on/off` (each admin for themselves) | none |

## Troubleshooting

- **"I need to be a group moderator/admin to do that":** change Rubi's role in the group's member list, or ask an owner.
- **"Make me a moderator (or admin) first":** automatic moderation can't delete messages yet. It keeps your settings,
  but does nothing until Rubi's role is high enough.
- **"Their role isn't below yours" / "My role is below …":** you can only act on members below you, and Rubi only on
  members not above it.
- **Commands aren't tappable:** see `/groupmenu` (Rubi must be an owner). In DMs they always are.
- **The filter misses variations:** try `/filter level strict`, or add `*` patterns like `spam*`.
- **The filter blocks innocent words:** you're probably on `max`; go back to `strict`, or ban more specific words.
- **No moderation log arrives:** accept Rubi's contact request in the group, or use `/modlog link` from a DM. Check
  `/modlog` to see whether you're subscribed.
- **"/x is turned off in this group":** an admin used `/toggle`. `/toggle` lists what's off.
