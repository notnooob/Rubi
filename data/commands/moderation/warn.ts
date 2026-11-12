import {addWarning, assertCanModerate, defineCommand, fmt, modLog, parseNumeric} from "../../../src/sdk"

export default defineCommand({
  name: "warn",
  description: "Warn a member (auto-removed at the warning limit)",
  details: "Warnings are stored per group. At the limit (default 3, change with /warn limit <n>, 0 = never) I remove the member if I'm an admin.",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  args: [
    {name: "member", type: "string", description: "Who to warn (or: limit)", required: true},
    {name: "reason", type: "text", description: "Why (or the new limit)"},
  ],
  examples: ["warn @bob please keep it civil", "warn limit 5"],
  async run(ctx) {
    if (ctx.args.member.toLowerCase() === "limit") {
      if (!ctx.can("admin")) return ctx.fail("Only admins can change the warning limit.")
      const n = parseNumeric(ctx.args.reason ?? "")
      if (n === undefined || !Number.isInteger(n) || n < 0 || n > 50) return ctx.usageError("Give a number from 0 (never remove) to 50.")
      await ctx.groupData.update((s) => {
        s.warnLimit = n
      })
      void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} set the warning limit to ${n || "never"}`)
      return n ? `⚠️ Members are now removed at ${fmt.bold(n)} warnings.` : "⚠️ Warnings will never remove members."
    }

    const member = await ctx.resolveMember(ctx.args.member)
    assertCanModerate(ctx, member, "warn")
    const reason = ctx.args.reason?.slice(0, 300) ?? ""
    const {count, limit, removed, needsAdmin} = await addWarning(ctx.rt, ctx.group!, member, reason)
    const who = ctx.mention(member)
    const head = `⚠️ ${who} has been warned${limit ? ` (${count}/${limit})` : ` (${count})`}.${reason ? `
Reason: ${fmt.italic(reason)}` : ""}`
    const name = member.memberProfile.displayName
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} warned ${name} (${count}${limit ? `/${limit}` : ""})${reason ? `: ${reason}` : ""}${removed ? ", removed at the limit" : ""}`)
    if (needsAdmin) return `${head}
${fmt.italic("Warning limit reached — make me an admin to remove members automatically.")}`
    if (removed) return `${head}
👢 Limit reached — ${fmt.bold(name)} was removed.`
    return fmt.lines(head, ctx.ui.buttons([ctx.ui.button("📋", "warnings", `#${member.groupMemberId}`), ctx.ui.button("↩️ Clear", "unwarn", `#${member.groupMemberId}`)]))
  },
})
