import {T} from "@simplex-chat/types"

/**
 * Who may run a command.
 *
 * - `everyone`  — anyone, in DMs and groups.
 * - `moderator` — group members with role moderator or higher.
 * - `admin`     — group members with role admin or higher.
 * - `owner`     — group owners.
 * - `botAdmin`  — bot operators only (contact IDs in RUBI_BOT_ADMINS).
 *
 * Group roles only exist in groups: in a DM, `moderator`/`admin`/`owner` commands
 * are denied unless the sender is a bot admin. Bot admins pass every permission check.
 */
export type Permission = "everyone" | "moderator" | "admin" | "owner" | "botAdmin"

/** SimpleX group roles, lowest to highest. `relay` is an infrastructure role (channel relays), not a person. */
export const ROLE_ORDER: readonly T.GroupMemberRole[] = [
  T.GroupMemberRole.Relay,
  T.GroupMemberRole.Observer,
  T.GroupMemberRole.Author,
  T.GroupMemberRole.Member,
  T.GroupMemberRole.Moderator,
  T.GroupMemberRole.Admin,
  T.GroupMemberRole.Owner,
]

export function roleRank(role: T.GroupMemberRole | undefined): number {
  return role === undefined ? -1 : ROLE_ORDER.indexOf(role)
}

export function roleAtLeast(role: T.GroupMemberRole | undefined, min: T.GroupMemberRole): boolean {
  return roleRank(role) >= roleRank(min)
}

/** Group role required by a permission level (undefined = not role-based). */
export function permissionRole(p: Permission): T.GroupMemberRole | undefined {
  switch (p) {
    case "moderator":
      return T.GroupMemberRole.Moderator
    case "admin":
      return T.GroupMemberRole.Admin
    case "owner":
      return T.GroupMemberRole.Owner
    default:
      return undefined
  }
}

export const PERMISSION_ORDER: readonly Permission[] = ["everyone", "moderator", "admin", "owner", "botAdmin"]

export const PERMISSION_LABEL: Record<Permission, string> = {
  everyone: "Everyone",
  moderator: "Group moderators",
  admin: "Group admins",
  owner: "Group owners",
  botAdmin: "Bot admins",
}

/** Member statuses in which a member is actually part of the group (can act in it). */
const ACTIVE_STATUSES = new Set<T.GroupMemberStatus>([
  T.GroupMemberStatus.Connected,
  T.GroupMemberStatus.Complete,
  T.GroupMemberStatus.Creator,
  T.GroupMemberStatus.Announced,
  T.GroupMemberStatus.Introduced,
  T.GroupMemberStatus.Intro_inv,
  T.GroupMemberStatus.Accepted,
])

export function isActiveMember(m: T.GroupMember): boolean {
  return ACTIVE_STATUSES.has(m.memberStatus)
}
