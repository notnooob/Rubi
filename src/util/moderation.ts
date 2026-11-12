import {T} from "@simplex-chat/types"
import type {CommandContext} from "../core/context"
import {chatErrorType, CommandError, PermissionError} from "../core/errors"
import {roleRank} from "../core/permissions"
import type {Runtime} from "../core/runtime"

/**
 * Checks shared by moderation commands, before acting on `target`:
 * not yourself, not the bot, your role must outrank theirs (owners may act on owners),
 * and the bot's role must be at least theirs. Bot admins skip the "your role" check.
 */
export function assertCanModerate(ctx: CommandContext<any>, target: T.GroupMember, verb: string): void {
  const g = ctx.group
  if (!g) throw new CommandError("This only works in groups.")
  if (target.groupMemberId === g.membership.groupMemberId) throw new CommandError(`I can't ${verb} myself.`)
  if (target.groupMemberId === ctx.sender.member?.groupMemberId) throw new CommandError(`You can't ${verb} yourself.`)
  const mine = roleRank(ctx.sender.role)
  const theirs = roleRank(target.memberRole)
  const ownerOnOwner = ctx.sender.role === T.GroupMemberRole.Owner && target.memberRole === T.GroupMemberRole.Owner
  if (!ctx.isBotAdmin && mine <= theirs && !ownerOnOwner) {
    throw new PermissionError(`You can't ${verb} ${target.memberProfile.displayName} — their role (${target.memberRole}) isn't below yours.`)
  }
  if (roleRank(ctx.botRole) < theirs) {
    throw new PermissionError(`My role (${ctx.botRole}) is below ${target.memberProfile.displayName}'s (${target.memberRole}), so I can't ${verb} them.`)
  }
}

/** Run a chat-core moderation call, turning role/permission errors into friendly messages. */
export async function moderate<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn()
  } catch (e) {
    switch (chatErrorType(e)) {
      case "groupUserRole":
      case "groupContactRole":
        throw new PermissionError("My role in this group isn't high enough for that.")
      case "groupMemberNotActive":
      case "groupMemberNotFound":
        throw new CommandError("That member isn't in the group anymore.")
      case "groupNotJoined":
        throw new CommandError("I haven't fully joined this group yet — try again in a moment.")
      default:
        throw e
    }
  }
}

/**
 * Add a warning to a member (shared by /warn and the /filter "warn" action). At the group's limit (default 3,
 * 0 = never) the member is removed if Rubi is an admin. Returns the new count, the limit and what happened.
 */
export async function addWarning(
  rt: Runtime,
  g: T.GroupInfo,
  member: T.GroupMember,
  reason: string
): Promise<{count: number; limit: number; removed: boolean; needsAdmin: boolean}> {
  const settings = await rt.data.group(g).update((s) => {
    const w = (s.warnings ??= {})
    const cur = w[member.groupMemberId] ?? {name: member.memberProfile.displayName, count: 0, reasons: [], last: 0}
    cur.count++
    cur.name = member.memberProfile.displayName
    cur.last = Date.now()
    if (reason) cur.reasons = [...cur.reasons, reason.slice(0, 300)].slice(-10)
    w[member.groupMemberId] = cur
  })
  const count = settings.warnings![member.groupMemberId]!.count
  const limit = settings.warnLimit ?? 3
  if (!limit || count < limit) return {count, limit, removed: false, needsAdmin: false}
  if (roleRank(g.membership.memberRole) < roleRank(T.GroupMemberRole.Admin)) return {count, limit, removed: false, needsAdmin: true}
  await moderate(() => rt.chat.apiRemoveMembers(g.groupId, [member.groupMemberId]))
  await rt.data.group(g).update((s) => {
    delete s.warnings?.[member.groupMemberId]
  })
  return {count, limit, removed: true, needsAdmin: false}
}
