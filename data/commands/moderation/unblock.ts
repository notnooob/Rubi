import {assertCanModerate, defineCommand, fmt, moderate, T} from "../../../src/sdk"

export default defineCommand({
  name: "unblock",
  aliases: ["unmute"],
  description: "Unblock a member",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  botRole: T.GroupMemberRole.Moderator,
  args: [{name: "member", type: "member", description: "Who to unblock", required: true}],
  async run(ctx) {
    const {member} = ctx.args
    assertCanModerate(ctx, member, "unblock")
    if (!member.blockedByAdmin) return ctx.fail(`${member.memberProfile.displayName} isn't blocked.`)
    await moderate(() => ctx.chat.apiBlockMembersForAll(ctx.group!.groupId, [member.groupMemberId], false))
    return `✅ ${fmt.bold(member.memberProfile.displayName)} is unblocked.`
  },
})
