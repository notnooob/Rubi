import {defineCommand, fmt, modLog} from "../../../src/sdk"

export default defineCommand({
  name: "unwarn",
  aliases: ["clearwarns"],
  description: "Clear a member's warnings",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  args: [{name: "member", type: "member", description: "Whose warnings to clear", required: true}],
  async run(ctx) {
    const {member} = ctx.args
    let had = 0
    await ctx.groupData.update((s) => {
      had = s.warnings?.[member.groupMemberId]?.count ?? 0
      delete s.warnings?.[member.groupMemberId]
    })
    if (!had) return ctx.fail(`${member.memberProfile.displayName} has no warnings.`)
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} cleared ${fmt.plural(had, "warning")} for ${member.memberProfile.displayName}`)
    return `↩️ Cleared ${fmt.plural(had, "warning")} for ${fmt.bold(member.memberProfile.displayName)}.`
  },
})
