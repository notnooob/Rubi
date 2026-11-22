import {assertCanModerate, chatErrorType, defineCommand, defineJob, describeError, fmt, moderate, parseDuration, T, modLog, type Runtime} from "../../../src/sdk"

export interface UnblockPayload {
  ref: T.ChatRef
  groupId: number
  groupMemberId: number
  name: string
  /** Failed attempts so far (the job retries every 10 minutes, then gives up and tells the admins). */
  tries?: number
}

const MIN_MS = 60_000
const MAX_MS = 30 * 86_400_000
export const UNBLOCK_TRIES = 6
const RETRY_MS = 10 * 60_000

defineJob<UnblockPayload>("unblock", async ({payload: p}, rt) => {
  try {
    await rt.chat.apiBlockMembersForAll(p.groupId, [p.groupMemberId], false)
  } catch (e) {
    if (await memberGone(rt, p, e)) {
      rt.log.info(`timed unblock of ${p.name} in group #${p.groupId} skipped: they're no longer in the group`)
      return
    }
    p.tries = (p.tries ?? 0) + 1
    rt.log.warn(`timed unblock of ${p.name} in group #${p.groupId} failed (${p.tries}/${UNBLOCK_TRIES}): ${describeError(e)}`)
    // returning a time reschedules the job with this same payload, so `tries` is kept
    if (p.tries < UNBLOCK_TRIES) return Date.now() + RETRY_MS
    const g = (await rt.chat.apiListGroups(rt.user.userId).catch(() => [])).find((x) => x.groupId === p.groupId)
    if (g) void modLog(rt, g, `couldn't lift the timed block of ${p.name} (${describeError(e)}) — use /unblock`)
    await rt.messenger.send(p.ref, `⚠️ I couldn't end ${fmt.bold(p.name)}'s block; an admin can use /unblock.`).catch(() => undefined)
    return
  }
  await rt.messenger.send(p.ref, `🔓 ${fmt.bold(p.name)}'s block ended.`)
})

/** The member left or was removed: nothing to unblock. */
async function memberGone(rt: Runtime, p: UnblockPayload, e: unknown): Promise<boolean> {
  if (/memberNot(Found|Active)/i.test(chatErrorType(e) ?? "")) return true
  try {
    const members = await rt.chat.apiListMembers(p.groupId)
    const m = members.find((x) => x.groupMemberId === p.groupMemberId)
    return !m || /removed|left|deleted|rejected/.test(m.memberStatus)
  } catch {
    return false
  }
}

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
