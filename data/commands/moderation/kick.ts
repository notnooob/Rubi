import {assertCanModerate, defineCommand, fmt, moderate, T, modLog} from "../../../src/sdk"

export default defineCommand({
  name: "kick",
  aliases: ["remove"],
  description: "Remove a member from the group",
  details: "Asks for confirmation first. Their earlier messages stay — remove single ones by replying to them with /delete.",
  category: "Moderation",
  scope: "group",
  permission: "admin",
  botRole: T.GroupMemberRole.Admin,
  args: [
    {name: "member", type: "member", description: "Who to remove", required: true},
    {name: "reason", type: "text", description: "Why (shown in the group)"},
  ],
  examples: ["kick @spammer advertising"],
  cooldown: 3,
  async run(ctx) {
    const {member, reason} = ctx.args
    assertCanModerate(ctx, member, "remove")
    const who = ctx.mention(member)
    if (!(await ctx.confirm(`👢 Remove ${who} from the group?${reason ? `\nReason: ${fmt.italic(reason)}` : ""}`))) return
    await moderate(() => ctx.chat.apiRemoveMembers(ctx.group!.groupId, [member.groupMemberId]))
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} removed ${member.memberProfile.displayName}${reason ? `: ${reason}` : ""}`)
    return fmt.lines(`👢 ${fmt.bold(member.memberProfile.displayName)} was removed by ${ctx.sender.displayName}.`, reason ? `Reason: ${fmt.italic(reason)}` : undefined)
  },
})
