import {assertCanModerate, defineCommand, fmt, moderate, T} from "../../../src/sdk"
import type {UnblockPayload} from "./block"

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
    const groupId = ctx.group!.groupId
    await moderate(() => ctx.chat.apiBlockMembersForAll(groupId, [member.groupMemberId], false))
    ctx.rt.scheduler.cancelWhere((j) => {
      const p = j.payload as UnblockPayload
      return j.kind === "unblock" && p.groupId === groupId && p.groupMemberId === member.groupMemberId
    })
    return `✅ ${fmt.bold(member.memberProfile.displayName)} is unblocked.`
  },
})
