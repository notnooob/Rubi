import {assertCanModerate, defineCommand, fmt, moderate, PermissionError, roleRank, T, modLog} from "../../../src/sdk"

const ROLES = ["observer", "author", "member", "moderator", "admin", "owner"] as const

export default defineCommand({
  name: "role",
  aliases: ["setrole", "promote"],
  description: "Change a member's role",
  details: "You can't give a role higher than your own. I need a role at least as high as both the old and the new one.",
  category: "Moderation",
  scope: "group",
  permission: "admin",
  botRole: T.GroupMemberRole.Admin,
  args: [
    {name: "member", type: "member", description: "Whose role to change", required: true},
    {name: "role", type: "string", description: "New role", required: true, choices: ROLES},
  ],
  examples: ["role @alice moderator", "role @bob observer"],
  async run(ctx) {
    const {member} = ctx.args
    const role = ctx.args.role as T.GroupMemberRole
    assertCanModerate(ctx, member, "change the role of")
    if (member.memberRole === role) return ctx.fail(`${member.memberProfile.displayName} is already ${role}.`)
    if (!ctx.isBotAdmin && roleRank(role) > roleRank(ctx.sender.role)) throw new PermissionError(`You can't give a role above your own (${ctx.sender.role}).`)
    if (roleRank(role) > roleRank(ctx.botRole)) throw new PermissionError(`I can't give ${role} — my role is ${ctx.botRole}.`)
    if (role === T.GroupMemberRole.Owner && !(await ctx.confirm(`👑 Make ${ctx.mention(member)} an *owner*? Owners have full control of the group.`))) return
    await moderate(() => ctx.chat.apiSetMembersRole(ctx.group!.groupId, [member.groupMemberId], role))
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} changed ${member.memberProfile.displayName}'s role: ${member.memberRole} → ${role}`)
    const up = roleRank(role) > roleRank(member.memberRole)
    return `${up ? "⬆️" : "⬇️"} ${ctx.mention(member)} is now ${fmt.bold(role)} ${fmt.italic(`(was ${member.memberRole})`)}`
  },
})
