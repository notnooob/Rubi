import {chatUtil, defineEvent, describeError, findBlocked, fmt, roleAtLeast, T, type Runtime} from "../../src/sdk"

/**
 * /filter (banned words) and /slowmode. Members below moderator are affected; their message is deleted when it
 * contains a blocked word, or when it comes sooner than the slow-mode interval after their previous message.
 * Commands don't count for slow mode (they have their own cooldowns). Rubi needs to be a moderator or higher.
 */
const lastPost = new Map<string, number>()
const NOTICE_MS = 60_000

export async function automod(rt: Runtime, ci: T.AChatItem): Promise<void> {
  if (ci.chatInfo.type !== "group" || ci.chatItem.chatDir.type !== "groupRcv" || ci.chatItem.meta.itemDeleted) return
  const g = ci.chatInfo.groupInfo
  const m = ci.chatItem.chatDir.groupMember
  if (roleAtLeast(m.memberRole, T.GroupMemberRole.Moderator)) return
  const {filter, slowmodeMs} = await rt.data.group(g).get()
  if (!filter?.length && !slowmodeMs) return
  if (!roleAtLeast(g.membership.memberRole, T.GroupMemberRole.Moderator)) return

  const text = chatUtil.itemText(ci.chatItem) ?? ""
  const name = m.memberProfile.displayName
  let notice: string | undefined
  if (filter?.length && findBlocked(filter, text)) {
    notice = `🚫 Removed a message from ${fmt.mention(name)}: it contained a blocked word.`
  } else if (slowmodeMs && !text.trim().startsWith(rt.config.prefix)) {
    const key = `${g.groupId}:${m.groupMemberId}`
    const at = Date.parse(ci.chatItem.meta.itemTs)
    const last = lastPost.get(key)
    if (last !== undefined && at - last < slowmodeMs) {
      notice = `🐢 ${fmt.mention(name)}, slow mode is on: one message every ${fmt.duration(slowmodeMs)}. Wait ${fmt.duration(slowmodeMs - (at - last))}.`
    } else {
      if (lastPost.size > 20_000) lastPost.clear()
      lastPost.set(key, at)
    }
  }
  if (!notice) return

  try {
    await rt.chat.apiDeleteMemberChatItem(g.groupId, [ci.chatItem.meta.itemId])
  } catch (e) {
    rt.log.warn(`automod: could not delete in #${g.groupProfile.displayName}: ${describeError(e)}`)
    return
  }
  if (rt.limiter.throttle(`automod:${g.groupId}:${m.groupMemberId}`, NOTICE_MS)) {
    await rt.messenger.send({chatType: T.ChatType.Group, chatId: g.groupId}, notice, {mentions: {[name]: m.groupMemberId}}).catch(() => undefined)
  }
}

export default defineEvent(
  "newChatItems",
  ({chatItems}, rt) => {
    for (const ci of chatItems) void automod(rt, ci).catch((e) => rt.log.warn(`automod check failed: ${describeError(e)}`))
  },
  {name: "automod"}
)
