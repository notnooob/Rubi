import {chatUtil, defineEvent, describeError, fmt, modLog, roleAtLeast, T, type Runtime} from "../../src/sdk"

/**
 * /antispam on: delete links posted by members who joined in the last 24 hours (below moderator).
 * "Joined" means after Rubi joined — members already there when Rubi arrived are never treated as new.
 * Edited messages are checked too, so a link can't be added afterwards (or typed into a live message).
 */
const NEW_MEMBER_MS = 24 * 3_600_000
const LINK_FORMATS = new Set(["uri", "hyperLink", "simplexLink"])
const LINK_RE = /(https?:\/\/|www\.|simplex:\/|\b[a-z0-9-]+\.(com|net|org|io|me|xyz|ru|cn|info|link|click|top|biz|app|gg)\b)/i

function hasLink(item: T.ChatItem): boolean {
  if (item.formattedText?.some((f) => f.format && LINK_FORMATS.has(f.format.type))) return true
  const c = item.content
  return c.type === "rcvMsgContent" && LINK_RE.test(c.msgContent.text)
}

export async function antispam(rt: Runtime, ci: T.AChatItem): Promise<void> {
  if (ci.chatInfo.type !== "group" || ci.chatItem.chatDir.type !== "groupRcv" || ci.chatItem.meta.itemDeleted) return
  const g = ci.chatInfo.groupInfo
  const m = ci.chatItem.chatDir.groupMember
  if (roleAtLeast(m.memberRole, T.GroupMemberRole.Moderator)) return
  const joined = Date.parse(m.createdAt)
  const botJoined = Date.parse(g.membership.createdAt)
  if (!(joined > botJoined + 60_000) || Date.now() - joined > NEW_MEMBER_MS) return
  if (!hasLink(ci.chatItem)) return
  if (!(await rt.data.group(g).get()).antispam) return
  if (!roleAtLeast(g.membership.memberRole, T.GroupMemberRole.Moderator)) return

  try {
    await rt.chat.apiDeleteMemberChatItem(g.groupId, [ci.chatItem.meta.itemId])
  } catch (e) {
    rt.log.warn(`antispam: could not delete in #${g.groupProfile.displayName}: ${describeError(e)}`)
    return
  }
  rt.log.info(`antispam: removed a link from @${m.memberProfile.displayName} in #${g.groupProfile.displayName}`)
  void modLog(rt, g, `anti-spam removed a link from new member ${m.memberProfile.displayName}: ${chatUtil.itemText(ci.chatItem) ?? ""}`)
  if (rt.limiter.throttle(`antispam:${g.groupId}:${m.groupMemberId}`, 10 * 60_000)) {
    const name = m.memberProfile.displayName
    await rt.messenger
      .send({chatType: T.ChatType.Group, chatId: g.groupId}, `🧹 Removed a link from ${fmt.mention(name)} — new members can't post links during their first 24 hours.`, {
        mentions: {[name]: m.groupMemberId},
      })
      .catch(() => undefined)
  }
}

export default [
  defineEvent(
    "newChatItems",
    ({chatItems}, rt) => {
      // don't hold up the event loop
      for (const ci of chatItems) void antispam(rt, ci).catch((e) => rt.log.warn(`antispam check failed: ${describeError(e)}`))
    },
    {name: "antispam"}
  ),
  defineEvent(
    "chatItemUpdated",
    ({chatItem}, rt) => void antispam(rt, chatItem).catch((e) => rt.log.warn(`antispam check failed: ${describeError(e)}`)),
    {name: "antispam:edits"}
  ),
]
