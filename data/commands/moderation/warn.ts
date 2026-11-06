import {assertCanModerate, defineCommand, fmt, moderate, roleAtLeast, T} from "../../../src/sdk"

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
      const n = Number(ctx.args.reason)
      if (!Number.isInteger(n) || n < 0 || n > 50) return ctx.usageError("Give a number from 0 (never remove) to 50.")
      await ctx.groupData.update((s) => {
        s.warnLimit = n
      })
      return n ? `⚠️ Members are now removed at ${fmt.bold(n)} warnings.` : "⚠️ Warnings will never remove members."
    }

    const member = await ctx.resolveMember(ctx.args.member)
    assertCanModerate(ctx, member, "warn")
    const reason = ctx.args.reason?.slice(0, 300) ?? ""
    const settings = await ctx.groupData.update((s) => {
      const w = (s.warnings ??= {})
      const cur = w[member.groupMemberId] ?? {name: member.memberProfile.displayName, count: 0, reasons: [], last: 0}
      cur.count++
      cur.name = member.memberProfile.displayName
      cur.last = Date.now()
      if (reason) cur.reasons = [...cur.reasons, reason].slice(-10)
      w[member.groupMemberId] = cur
    })
    const count = settings.warnings![member.groupMemberId]!.count
    const limit = settings.warnLimit ?? 3
    const who = ctx.mention(member)
    const head = `⚠️ ${who} has been warned${limit ? ` (${count}/${limit})` : ` (${count})`}.${reason ? `\nReason: ${fmt.italic(reason)}` : ""}`

    if (limit && count >= limit) {
      if (!roleAtLeast(ctx.botRole, T.GroupMemberRole.Admin)) return `${head}\n${fmt.italic("Warning limit reached — make me an admin to remove members automatically.")}`
      await moderate(() => ctx.chat.apiRemoveMembers(ctx.group!.groupId, [member.groupMemberId]))
      await ctx.groupData.update((s) => {
        delete s.warnings?.[member.groupMemberId]
      })
      return `${head}\n👢 Limit reached — ${fmt.bold(member.memberProfile.displayName)} was removed.`
    }
    return fmt.lines(head, ctx.ui.buttons([ctx.ui.button("📋", "warnings", `#${member.groupMemberId}`), ctx.ui.button("↩️ Clear", "unwarn", `#${member.groupMemberId}`)]))
  },
})
