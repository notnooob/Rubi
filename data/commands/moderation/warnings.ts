import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "warnings",
  aliases: ["warns"],
  description: "See warnings (yours, a member's, or everyone's for moderators)",
  category: "Moderation",
  scope: "group",
  args: [{name: "member", type: "member", description: "Whose warnings (moderators can see anyone's)"}],
  async run(ctx) {
    const s = await ctx.groupData.get()
    const all = s.warnings ?? {}
    const limit = s.warnLimit ?? 3
    const mod = ctx.can("moderator")

    if (!ctx.args.member && mod) {
      const entries = Object.entries(all).sort((a, b) => b[1].count - a[1].count)
      if (!entries.length) return "✨ Nobody has warnings here."
      await ctx.paginate({
        title: `⚠️ ${fmt.bold("Warnings")} ${fmt.italic(limit ? `(limit ${limit})` : "(no limit)")}`,
        items: entries.map(([id, w]) => `• ${fmt.bold(w.name)} — ${w.count}${w.reasons.length ? ` · ${fmt.italic(fmt.truncate(w.reasons[w.reasons.length - 1]!, 60))}` : ""}  ${ctx.ui.button("↩️", "unwarn", `#${id}`)}`),
        perPage: 15,
      })
      return
    }

    const target = ctx.args.member ?? ctx.sender.member!
    if (target.groupMemberId !== ctx.sender.member?.groupMemberId && !mod) return ctx.fail("You can only see your own warnings.")
    const w = all[target.groupMemberId]
    if (!w) return `✨ ${target.memberProfile.displayName} has no warnings.`
    return fmt.lines(
      `⚠️ ${fmt.bold(target.memberProfile.displayName)} — ${w.count}${limit ? `/${limit}` : ""} warning${w.count === 1 ? "" : "s"}`,
      ...w.reasons.map((r, i) => `${i + 1}. ${fmt.italic(r)}`),
      fmt.italic(`last ${fmt.relative(w.last)}`)
    )
  },
})
