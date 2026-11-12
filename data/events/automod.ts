import {addWarning, chatUtil, defineEvent, describeError, findBlocked, fmt, modLog, roleAtLeast, T, type Runtime} from "../../src/sdk"
import type {UnblockPayload} from "../commands/moderation/block"

/**
 * /filter (banned words) and /slowmode. Members below moderator are affected; their message is deleted when it
 * contains a blocked word, or when it comes sooner than the slow-mode interval after their previous message.
 * Edited messages are checked too (also how a live "typing" message's final text arrives), but only against the
 * filter. Commands don't count for slow mode (they have their own cooldowns). Rubi needs to be a moderator or higher.
 * Every action goes to the moderation log (/modlog), which DMs it to admins.
 */
const lastPost = new Map<string, number>()
const NOTICE_MS = 60_000
const DEFAULT_BLOCK_MS = 10 * 60_000

export async function automod(rt: Runtime, ci: T.AChatItem, opts: {edited?: boolean} = {}): Promise<void> {
  if (ci.chatInfo.type !== "group" || ci.chatItem.chatDir.type !== "groupRcv" || ci.chatItem.meta.itemDeleted) return
  const g = ci.chatInfo.groupInfo
  const m = ci.chatItem.chatDir.groupMember
  if (roleAtLeast(m.memberRole, T.GroupMemberRole.Moderator)) return
  const s = await rt.data.group(g).get()
  if (!s.filter?.length && !s.slowmodeMs) return
  if (!roleAtLeast(g.membership.memberRole, T.GroupMemberRole.Moderator)) return

  const text = chatUtil.itemText(ci.chatItem) ?? ""
  const name = m.memberProfile.displayName
  const blocked = s.filter?.length ? findBlocked(s.filter, text, s.filterLevel) : undefined
  let notice: string | undefined
  let log: string | undefined
  if (blocked) {
    notice = `🚫 Removed a message from ${fmt.mention(name)}: it contained a blocked word.`
    log = `filter removed ${opts.edited ? "an edited" : "a"} message from ${name} ("${blocked}"): ${text}`
  } else if (s.slowmodeMs && !opts.edited && !text.trim().startsWith(rt.config.prefix)) {
    const key = `${g.groupId}:${m.groupMemberId}`
    const at = Date.parse(ci.chatItem.meta.itemTs)
    const last = lastPost.get(key)
    if (last !== undefined && at - last < s.slowmodeMs) {
      notice = `🐢 ${fmt.mention(name)}, slow mode is on: one message every ${fmt.duration(s.slowmodeMs)}. Wait ${fmt.duration(s.slowmodeMs - (at - last))}.`
      log = `slow mode removed a message from ${name}: ${text}`
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
  if (blocked) log += await filterAction(rt, g, m, s.filterAction, s.filterBlockMs)
  const fresh = rt.limiter.throttle(`automod:${g.groupId}:${m.groupMemberId}`, NOTICE_MS)
  // slow mode only logs the first deletion per minute, or a fast poster floods the admins' DMs
  if (blocked || fresh) void modLog(rt, g, log!)
  if (fresh) {
    await rt.messenger.send({chatType: T.ChatType.Group, chatId: g.groupId}, notice, {mentions: {[name]: m.groupMemberId}}).catch(() => undefined)
  }
}

/** The extra /filter action after the delete; returns a note for the log. */
async function filterAction(rt: Runtime, g: T.GroupInfo, m: T.GroupMember, action: string | undefined, blockMs = DEFAULT_BLOCK_MS): Promise<string> {
  const name = m.memberProfile.displayName
  const ref = {chatType: T.ChatType.Group, chatId: g.groupId}
  try {
    if (action === "warn") {
      const w = await addWarning(rt, g, m, "used a banned word")
      if (w.removed) await rt.messenger.send(ref, `👢 ${fmt.bold(name)} reached the warning limit and was removed.`)
      return ` · warned (${w.count}${w.limit ? `/${w.limit}` : ""})${w.removed ? ", removed at the limit" : w.needsAdmin ? ", at the limit but I'm not an admin" : ""}`
    }
    if (action === "block" && !m.blockedByAdmin) {
      await rt.chat.apiBlockMembersForAll(g.groupId, [m.groupMemberId], true)
      rt.scheduler.schedule<UnblockPayload>("unblock", Date.now() + blockMs, {ref, groupId: g.groupId, groupMemberId: m.groupMemberId, name})
      return ` · blocked for ${fmt.duration(blockMs)}`
    }
  } catch (e) {
    rt.log.warn(`automod: ${action} for @${name} in #${g.groupProfile.displayName} failed: ${describeError(e)}`)
    return ` · ${action} failed`
  }
  return ""
}

export default [
  defineEvent(
    "newChatItems",
    ({chatItems}, rt) => {
      for (const ci of chatItems) void automod(rt, ci).catch((e) => rt.log.warn(`automod check failed: ${describeError(e)}`))
    },
    {name: "automod"}
  ),
  defineEvent(
    "chatItemUpdated",
    ({chatItem}, rt) => void automod(rt, chatItem, {edited: true}).catch((e) => rt.log.warn(`automod check failed: ${describeError(e)}`)),
    {name: "automod:edits"}
  ),
]
