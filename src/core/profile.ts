import type {T} from "@simplex-chat/types"

/**
 * Profile size budget.
 *
 * SimpleX sends a profile to contacts (and a group profile to members) as one `x.info` / `x.grp.info` message,
 * and refuses profiles whose JSON encoding is longer than `maxEncodedInfoLength` = 14 694 bytes
 * (simplex-chat `src/Simplex/Chat/Protocol.hs`, checked by `checkInfoSize` in `Library/Commands.hs`):
 * "Profile is too large". The avatar (~11 KB) and the command menu share that space, so the menu is built to fit
 * whatever is left (`CommandRegistry.menuWithin`).
 */
export const MAX_INFO_BYTES = 14_694

/** Room for what we can't measure exactly: the envelope's version range and msgId, JSON details of the core. */
const SAFETY_BYTES = 300

/** `bot.run` adds the address link to the profile; before the first start we don't know it yet. */
export const ADDRESS_LINK_RESERVE = 500

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8")

/** Bytes left for the bot profile's command menu. */
export function botMenuBudget(profile: T.Profile, opts: {allowFiles: boolean; contactLink?: string}): number {
  const p: T.Profile = {
    ...profile,
    peerType: "bot" as T.ChatPeerType,
    contactLink: opts.contactLink ?? "x".repeat(ADDRESS_LINK_RESERVE),
    // what bot.run sets with useBotProfile; the menu itself is measured separately
    preferences: {
      ...(profile.preferences ?? {}),
      files: {allow: (opts.allowFiles ? "yes" : "no") as T.FeatureAllowed},
      calls: {allow: "no" as T.FeatureAllowed},
      voice: {allow: "no" as T.FeatureAllowed},
      commands: [],
    },
  }
  return MAX_INFO_BYTES - SAFETY_BYTES - bytes({v: "1-99", event: "x.info", params: {profile: p}}) + bytes([])
}

/** Bytes left for a group's command menu (/groupmenu): the group's own picture and description count too. */
export function groupMenuBudget(groupProfile: T.GroupProfile): number {
  const p = {...groupProfile, groupPreferences: {...(groupProfile.groupPreferences ?? {}), commands: []}}
  return MAX_INFO_BYTES - SAFETY_BYTES - bytes({v: "1-99", event: "x.grp.info", params: {groupProfile: p}}) + bytes([])
}
