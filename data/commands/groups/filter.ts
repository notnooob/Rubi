import {defineCommand, fmt, matchesPattern, MAX_FILTER_WORD_LENGTH, MAX_FILTER_WORDS, parseWordList, T} from "../../../src/sdk"

export default defineCommand({
  name: "filter",
  aliases: ["bannedwords"],
  description: "Delete messages with banned words (admins)",
  details:
    "Separate several words or phrases with commas. Matching ignores case and only hits whole words; * matches the rest " +
    "of a word (crypto* also blocks cryptocoin). remove also takes * patterns (remove crypto* removes every entry " +
    "starting with crypto). Moderators and admins aren't filtered. I need to be a moderator or higher.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [
    {name: "action", type: "string", description: "list, add, remove or clear", choices: ["list", "add", "remove", "clear"]},
    {name: "words", type: "text", description: "Words or phrases, comma-separated"},
  ],
  examples: ["filter add spam, buy now, crypto*", "filter remove buy now", "filter remove crypto*", "filter list"],
  async run(ctx) {
    const {action = "list", words} = ctx.args
    const current = (await ctx.groupData.get()).filter ?? []

    if (action === "list") {
      if (!current.length) return `🚫 No banned words. Add some: ${ctx.ui.cmd("filter", "add spam, buy now")}`
      await ctx.paginate({title: `🚫 ${fmt.bold("Banned words")} (${current.length})`, items: current.map((w) => `• ${fmt.code(w)}`), perPage: 25})
      return
    }
    if (action === "clear") {
      if (!current.length) return ctx.fail("There are no banned words to clear.")
      if (!(await ctx.confirm(`🚫 Remove all ${fmt.plural(current.length, "banned word")}?`))) return
      await ctx.groupData.update((s) => {
        delete s.filter
      })
      return "🚫 Banned words cleared."
    }

    const list = parseWordList(words ?? "")
    if (!list.length) return ctx.usageError(`Give one or more words, separated by commas: ${fmt.code(`/filter ${action} spam, buy now`)}`)

    if (action === "add") {
      const tooLong = list.filter((w) => w.length > MAX_FILTER_WORD_LENGTH)
      const fresh = list.filter((w) => w.length <= MAX_FILTER_WORD_LENGTH && !current.includes(w))
      if (current.length + fresh.length > MAX_FILTER_WORDS) return ctx.fail(`That's too many: a group can have ${MAX_FILTER_WORDS} banned words.`)
      if (fresh.length) {
        await ctx.groupData.update((s) => {
          s.filter = [...new Set([...(s.filter ?? []), ...fresh])].sort()
        })
      }
      return fmt.lines(
        fresh.length ? `🚫 Added ${fmt.plural(fresh.length, "banned word")}: ${fresh.map(fmt.code).join(", ")}` : "🚫 Those are already banned.",
        tooLong.length > 0 && `Skipped ${tooLong.length} longer than ${MAX_FILTER_WORD_LENGTH} characters.`,
        !ctx.botHasRole(T.GroupMemberRole.Moderator) && "⚠️ Make me a moderator (or admin), or I can't delete messages."
      )
    }

    // remove
    const removed = current.filter((w) => list.some((p) => matchesPattern(p, w)))
    if (!removed.length) return ctx.fail("None of the banned words match that.")
    await ctx.groupData.update((s) => {
      s.filter = (s.filter ?? []).filter((w) => !removed.includes(w))
      if (!s.filter.length) delete s.filter
    })
    return `🚫 Removed ${fmt.plural(removed.length, "banned word")}: ${removed.map(fmt.code).join(", ")}`
  },
})
