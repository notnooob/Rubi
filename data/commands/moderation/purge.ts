import {defineCommand, fmt, moderate, roleRank, T} from "../../../src/sdk"

export default defineCommand({
  name: "purge",
  description: "Delete the last messages: /purge 10",
  details:
    "Removes the newest messages for everyone (up to 50), after you confirm. Add a member to only remove theirs. " +
    "Messages from members whose role is equal to or higher than yours or mine are left alone.",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  botRole: T.GroupMemberRole.Moderator,
  cooldown: 10,
  args: [
    {name: "count", type: "integer", description: "How many messages (1–50)", required: true, min: 1, max: 50},
    {name: "member", type: "member", description: "Only this member's messages"},
  ],
  examples: ["purge 10", "purge 20 @spammer"],
  async run(ctx) {
    const {count, member} = ctx.args
    const groupId = ctx.group!.groupId
    // bot admins act with owner rights; a message must rank below both the invoker and Rubi
    const limit = Math.min(ctx.isBotAdmin ? roleRank(T.GroupMemberRole.Owner) : roleRank(ctx.sender.role), roleRank(ctx.botRole))
    const chat = (await ctx.chat.apiGetChat(T.ChatType.Group, groupId, member ? 200 : count + 1)) as T.AChat
    const picked = chat.chatItems.filter((ci) => {
      if (ci.meta.itemDeleted || ci.meta.itemId === ctx.itemId) return false
      const dir = ci.chatDir
      if (dir.type === "groupSnd") return !member
      if (dir.type !== "groupRcv") return false
      if (member && dir.groupMember.groupMemberId !== member.groupMemberId) return false
      return roleRank(dir.groupMember.memberRole) < limit
    })
    const items = picked.slice(-count)
    if (!items.length) return ctx.fail(member ? `I found no messages from ${member.memberProfile.displayName} that I can delete.` : "I found no messages I can delete.")

    const n = fmt.plural(items.length, "message")
    if (!(await ctx.confirm(`🧹 Delete the last ${n}${member ? ` from ${fmt.bold(member.memberProfile.displayName)}` : ""}?`))) return
    const own = items.filter((ci) => ci.chatDir.type === "groupSnd").map((ci) => ci.meta.itemId)
    const others = items.filter((ci) => ci.chatDir.type === "groupRcv").map((ci) => ci.meta.itemId)
    if (others.length) await moderate(() => ctx.chat.apiDeleteMemberChatItem(groupId, others))
    if (own.length) await ctx.rt.messenger.delete(ctx.ref, own)
    // tidy up: remove the /purge command message too (best effort)
    await ctx.chat.apiDeleteMemberChatItem(groupId, [ctx.itemId]).catch(() => undefined)
    return `🧹 Deleted ${n}.`
  },
})
