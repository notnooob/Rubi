import {
  adminContact,
  defineCommand,
  FILTER_LEVELS,
  fmt,
  matchesPattern,
  MAX_FILTER_WORD_LENGTH,
  MAX_FILTER_WORDS,
  modLog,
  parseDuration,
  parseWordList,
  T,
  type CommandContext,
  type FilterLevel,
} from "../../../src/sdk"

const ACTIONS = ["delete", "warn", "block"] as const
const LEVEL_INFO: Record<FilterLevel, string> = {
  normal: "whole words, ignoring case",
  strict: "also look-alike letters, sp4m-style digits and symbols, accents and stretched letters (spaaam)",
  max: "strict, plus s p a m-style spacing and matches inside longer words (expect false positives)",
}

export default defineCommand({
  name: "filter",
  aliases: ["bannedwords"],
  description: "Delete messages with banned words (admins)",
  details:
    "add/remove take words or phrases separated by commas; * matches the rest of a word (crypto* also blocks " +
    "cryptocoin), and remove also takes * patterns. action: what else happens to the author (delete only, warn = a " +
    "/warn, block = a timed /block, default 10m). level: normal, strict or max (send /filter level to compare them). " +
    "The word list is only ever sent to you by DM (link your DMs with /modlog on). Moderators and admins aren't " +
    "filtered, edits are checked too, and I need to be a moderator or higher.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [
    {name: "action", type: "string", description: "add, remove, list, clear, action or level", choices: ["add", "remove", "list", "clear", "action", "level"]},
    {name: "words", type: "text", description: "Words or phrases (comma-separated), or the setting"},
  ],
  examples: ["filter add spam, buy now, crypto*", "filter remove crypto*", "filter action block 1h", "filter level strict", "filter list"],
  async run(ctx) {
    const {action, words} = ctx.args
    const s = await ctx.groupData.get()
    const current = s.filter ?? []
    const who = ctx.sender.displayName

    if (action === undefined) {
      return fmt.lines(
        `🚫 ${fmt.bold(fmt.plural(current.length, "banned word"))} in this group.`,
        `Action: ${fmt.bold(describeAction(s.filterAction, s.filterBlockMs))} · Level: ${fmt.bold(s.filterLevel ?? "normal")}`,
        !ctx.botHasRole(T.GroupMemberRole.Moderator) && "⚠️ Make me a moderator (or admin), or I can't delete messages.",
        "",
        ctx.ui.buttons([ctx.ui.button("📋 List", "filter", "list"), ctx.ui.button("Help", "help", "filter")])
      )
    }

    if (action === "list") {
      if (!current.length) return `🚫 No banned words. Add some: ${ctx.ui.cmd("filter", "add spam, buy now")}`
      const text = fmt.lines(`🚫 ${fmt.bold(`Banned words in ${ctx.group!.groupProfile.displayName}`)} (${current.length})`, "", current.map((w) => `• ${fmt.code(w)}`).join("\n"))
      return (await sendPrivately(ctx, text)) ? "📬 I sent you the list by DM, so it isn't shown to everyone here." : noDmLink(ctx)
    }

    if (action === "clear") {
      if (!current.length) return ctx.fail("There are no banned words to clear.")
      if (!(await ctx.confirm(`🚫 Remove all ${fmt.plural(current.length, "banned word")}?`))) return
      await ctx.groupData.update((d) => {
        delete d.filter
      })
      void modLog(ctx.rt, ctx.group!, `${who} cleared the banned words (${current.length})`)
      return "🚫 Banned words cleared."
    }

    if (action === "level") {
      const level = words?.trim().toLowerCase() as FilterLevel | undefined
      if (!level || !FILTER_LEVELS.includes(level)) {
        return ctx.usageError(fmt.lines("Choose a level:", ...FILTER_LEVELS.map((l) => `• ${fmt.bold(l)}: ${LEVEL_INFO[l]}`)))
      }
      await ctx.groupData.update((d) => {
        if (level === "normal") delete d.filterLevel
        else d.filterLevel = level
      })
      void modLog(ctx.rt, ctx.group!, `${who} set the filter level to ${level}`)
      return `🚫 Filter level: ${fmt.bold(level)} (${LEVEL_INFO[level]}).`
    }

    if (action === "action") {
      const [kind, ...rest] = (words ?? "").trim().toLowerCase().split(/\s+/)
      if (!ACTIONS.includes(kind as (typeof ACTIONS)[number])) return ctx.usageError("Choose delete (only delete), warn (delete + /warn) or block (delete + a timed block, e.g. block 1h).")
      const ms = kind === "block" && rest.length ? parseDuration(rest.join(" ")) : undefined
      if (kind === "block" && rest.length && (ms === undefined || ms < 60_000 || ms > 30 * 86_400_000)) return ctx.fail("A block can last from 1 minute to 30 days.")
      await ctx.groupData.update((d) => {
        if (kind === "delete") delete d.filterAction
        else d.filterAction = kind as "warn" | "block"
        if (ms) d.filterBlockMs = ms
        else delete d.filterBlockMs
      })
      const label = describeAction(kind === "delete" ? undefined : (kind as "warn" | "block"), ms)
      void modLog(ctx.rt, ctx.group!, `${who} set the filter action to ${label}`)
      return fmt.lines(
        `🚫 Filter action: ${fmt.bold(label)}.`,
        kind === "warn" && !ctx.botHasRole(T.GroupMemberRole.Admin) && "⚠️ I'm not an admin, so members who reach the warning limit won't be removed.",
        kind === "block" && !ctx.botHasRole(T.GroupMemberRole.Moderator) && "⚠️ Make me a moderator (or admin), or I can't block anyone."
      )
    }

    const list = parseWordList(words ?? "")
    if (!list.length) return ctx.usageError(`Give one or more words, separated by commas: ${fmt.code(`/filter ${action} spam, buy now`)}`)
    // the words shouldn't stay visible in the group (best effort: needs a role above the admin who sent them)
    await ctx.chat.apiDeleteMemberChatItem(ctx.group!.groupId, [ctx.itemId]).catch(() => undefined)

    if (action === "add") {
      const tooLong = list.filter((w) => w.length > MAX_FILTER_WORD_LENGTH)
      const fresh = list.filter((w) => w.length <= MAX_FILTER_WORD_LENGTH && !current.includes(w))
      if (current.length + fresh.length > MAX_FILTER_WORDS) return ctx.fail(`That's too many: a group can have ${MAX_FILTER_WORDS} banned words.`)
      if (fresh.length) {
        await ctx.groupData.update((d) => {
          d.filter = [...new Set([...(d.filter ?? []), ...fresh])].sort()
        })
        void modLog(ctx.rt, ctx.group!, `${who} added banned words: ${fresh.join(", ")}`)
      }
      return fmt.lines(
        fresh.length ? `🚫 Added ${fmt.plural(fresh.length, "banned word")} (${current.length + fresh.length} in total).` : "🚫 Those are already banned.",
        tooLong.length > 0 && `Skipped ${tooLong.length} longer than ${MAX_FILTER_WORD_LENGTH} characters.`,
        !ctx.botHasRole(T.GroupMemberRole.Moderator) && "⚠️ Make me a moderator (or admin), or I can't delete messages."
      )
    }

    // remove
    const removed = current.filter((w) => list.some((p) => matchesPattern(p, w)))
    if (!removed.length) return ctx.fail("None of the banned words match that.")
    await ctx.groupData.update((d) => {
      d.filter = (d.filter ?? []).filter((w) => !removed.includes(w))
      if (!d.filter.length) delete d.filter
    })
    void modLog(ctx.rt, ctx.group!, `${who} removed banned words: ${removed.join(", ")}`)
    return `🚫 Removed ${fmt.plural(removed.length, "banned word")} (${current.length - removed.length} left).`
  },
})

function describeAction(action: "delete" | "warn" | "block" | undefined, blockMs?: number): string {
  if (action === "warn") return "delete + warn"
  if (action === "block") return `delete + block for ${fmt.duration(blockMs ?? 10 * 60_000)}`
  return "delete"
}

/** DM the invoker through the contact linked by /modlog on (or their existing contact). */
async function sendPrivately(ctx: CommandContext<any>, text: string): Promise<boolean> {
  const contactId = await adminContact(ctx.rt, ctx.group!, ctx.sender.member!)
  if (contactId === undefined) return false
  return ctx.rt.messenger.send({chatType: T.ChatType.Direct, chatId: contactId}, text).then(
    () => true,
    () => false
  )
}

function noDmLink(ctx: CommandContext<any>): string {
  return `🔒 I can't DM you yet, and the list shouldn't be posted here. Send ${ctx.ui.cmd("modlog", "on")} first: it links your DMs with me (and sends you the moderation log).`
}
