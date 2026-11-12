import {chatUtil, defineEvent, describeError, fmt, parseCommand, T, type Runtime} from "../../src/sdk"
import {AFK, memberKey, SEEN, type AfkEntry, type SeenEntry} from "../commands/groups/afk"

/**
 * Group activity for /seen and /afk:
 * - remembers when each member last posted (saved at most once a minute per member),
 * - tells people who @mention an AFK member that they're away,
 * - clears a member's AFK when they post again.
 * Messages sent while Rubi was offline update "seen", but never get AFK replies.
 */
const SEEN_RESOLUTION_MS = 60_000
const AFK_NOTICE_MS = 60_000

export async function trackActivity(rt: Runtime, ci: T.AChatItem): Promise<void> {
  if (ci.chatInfo.type !== "group" || ci.chatItem.chatDir.type !== "groupRcv" || ci.chatItem.meta.itemDeleted) return
  if (ci.chatItem.content.type !== "rcvMsgContent") return
  const g = ci.chatInfo.groupInfo
  const m = ci.chatItem.chatDir.groupMember
  const key = memberKey(g.groupId, m.groupMemberId)
  const name = m.memberProfile.displayName
  const at = Date.parse(ci.chatItem.meta.itemTs)

  const seen = rt.store.collection<SeenEntry>(SEEN)
  const prev = seen.get(key)
  if (!prev || at - prev.at >= SEEN_RESOLUTION_MS || prev.name !== name) seen.set(key, {at: Math.max(at, prev?.at ?? 0), name})

  const live = at >= rt.startedAt.getTime()
  const ref = {chatType: T.ChatType.Group, chatId: g.groupId}
  const afk = rt.store.collection<AfkEntry>(AFK)
  const text = chatUtil.itemText(ci.chatItem)?.trim() ?? ""

  // back from AFK (unless this message is the /afk command itself)
  const mine = afk.get(key)
  const keyword = parseCommand(text, rt.config.prefix)?.keyword
  if (mine && (!keyword || rt.commands.get(keyword)?.name !== "afk")) {
    afk.delete(key)
    if (live) {
      await rt.messenger.send(ref, `👋 Welcome back, ${fmt.mention(name)} (away ${fmt.relative(mine.since).replace(/ ago$/, "")}).`, {mentions: {[name]: m.groupMemberId}})
    }
  }
  if (!live) return

  // someone @mentioned an AFK member
  const away = Object.values(ci.chatItem.mentions ?? {})
    .map((mention) => mention.memberRef?.groupMemberId)
    .filter((id): id is number => id !== undefined && id !== m.groupMemberId)
    .map((id) => ({id, entry: afk.get(memberKey(g.groupId, id))}))
    .filter((x): x is {id: number; entry: AfkEntry} => !!x.entry && rt.limiter.throttle(`afk:${g.groupId}:${x.id}`, AFK_NOTICE_MS))
  if (!away.length) return
  const lines = away.map(({entry}) => `💤 ${fmt.bold(entry.name)} is AFK${entry.reason ? `: ${entry.reason}` : ""} ${fmt.italic(`(${fmt.relative(entry.since)})`)}`)
  await rt.messenger.send(ref, lines.join("\n"), {quote: ci.chatItem.meta.itemId})
}

export default defineEvent(
  "newChatItems",
  ({chatItems}, rt) => {
    for (const ci of chatItems) void trackActivity(rt, ci).catch((e) => rt.log.warn(`activity tracking failed: ${describeError(e)}`))
  },
  {name: "activity"}
)
