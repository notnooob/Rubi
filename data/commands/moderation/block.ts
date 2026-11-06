import {assertCanModerate, defineCommand, fmt, moderate, T} from "../../../src/sdk"

export default defineCommand({
  name: "block",
  aliases: ["mute"],
  description: "Block a member for everyone (their messages are hidden)",
  details: "Blocked members stay in the group but nobody sees their new messages. Undo with /unblock.",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  botRole: T.GroupMemberRole.Moderator,
  args: [{name: "member", type: "member", description: "Who to block", required: true}],
  examples: ["block @troll"],
  async run(ctx) {
    const {member} = ctx.args
    assertCanModerate(ctx, member, "block")
    if (member.blockedByAdmin) return ctx.fail(`${member.memberProfile.displayName} is already blocked.`)
    await moderate(() => ctx.chat.apiBlockMembersForAll(ctx.group!.groupId, [member.groupMemberId], true))
    return fmt.lines(
      `🚫 ${fmt.bold(member.memberProfile.displayName)} is blocked for everyone.`,
      ctx.ui.button("Undo", "unblock", `#${member.groupMemberId}`)
    )
  },
})
