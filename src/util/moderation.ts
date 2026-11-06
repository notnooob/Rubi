import {T} from "@simplex-chat/types"
import type {CommandContext} from "../core/context"
import {chatErrorType, CommandError, PermissionError} from "../core/errors"
import {roleRank} from "../core/permissions"

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
