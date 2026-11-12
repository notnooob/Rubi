import {assertCanModerate, defineCommand, defineJob, describeError, fmt, moderate, parseDuration, T, modLog} from "../../../src/sdk"

export interface UnblockPayload {
  ref: T.ChatRef
  groupId: number
  groupMemberId: number
  name: string
}

const MIN_MS = 60_000
const MAX_MS = 30 * 86_400_000

defineJob<UnblockPayload>("unblock", async ({payload: p}, rt) => {
  try {
    await rt.chat.apiBlockMembersForAll(p.groupId, [p.groupMemberId], false)
  } catch (e) {
    // the member left or Rubi lost its role: nothing to retry
    rt.log.warn(`timed unblock of ${p.name} in group #${p.groupId} failed: ${describeError(e)}`)
    return
  }
  await rt.messenger.send(p.ref, `🔓 ${fmt.bold(p.name)}'s block ended.`)
})

export default defineCommand({
  name: "block",
  aliases: ["mute"],
  description: "Block a member for everyone (their messages are hidden)",
  details:
    "Blocked members stay in the group but nobody sees their new messages. Add a duration (10m, 2h, 1d; up to 30 days) " +
    "to unblock them automatically. Undo with /unblock.",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  botRole: T.GroupMemberRole.Moderator,
  args: [
    {name: "member", type: "member", description: "Who to block", required: true},
    {name: "duration", type: "text", description: "How long (default: until /unblock)"},
  ],
  examples: ["block @troll", "block @troll 10m"],
  async run(ctx) {
    const {member, duration} = ctx.args
    const ms = duration === undefined ? undefined : parseDuration(duration)
    if (duration !== undefined && ms === undefined) return ctx.usageError(`"${duration}" isn't a duration — try 10m, 2h or 1d.`)
    if (ms !== undefined && (ms < MIN_MS || ms > MAX_MS)) return ctx.fail("Blocks can last from 1 minute to 30 days.")
    assertCanModerate(ctx, member, "block")
    if (member.blockedByAdmin) return ctx.fail(`${member.memberProfile.displayName} is already blocked.`)
    const groupId = ctx.group!.groupId
    await moderate(() => ctx.chat.apiBlockMembersForAll(groupId, [member.groupMemberId], true))
    const name = member.memberProfile.displayName
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} blocked ${name}${ms !== undefined ? ` for ${fmt.duration(ms)}` : ""}`)
    if (ms !== undefined) {
      ctx.rt.scheduler.schedule<UnblockPayload>("unblock", Date.now() + ms, {ref: ctx.ref, groupId, groupMemberId: member.groupMemberId, name})
    }
    return fmt.lines(
      `🚫 ${fmt.bold(name)} is blocked for ${ms !== undefined ? fmt.duration(ms) : "everyone"}.`,
      ctx.ui.button("Undo", "unblock", `#${member.groupMemberId}`)
    )
  },
})
