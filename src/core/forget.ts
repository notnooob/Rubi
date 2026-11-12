import type {T} from "@simplex-chat/types"
import type {Runtime} from "./runtime"

/**
 * Drop state for a chat Rubi can no longer talk to (left/removed from a group, contact deleted):
 * its interactions (polls, trivia…) and scheduled jobs. With `memberId`, only that member's reminders in the group
 * (they left or were removed). Returns how many jobs + interactions were removed.
 */
export function forgetChat(rt: Runtime, ref: T.ChatRef, memberId?: number): number {
  // any scope of the chat (member support chats included)
  const sameChat = (r: unknown): boolean => {
    const o = r as Partial<T.ChatRef> | undefined
    return !!o && typeof o === "object" && o.chatType === ref.chatType && o.chatId === ref.chatId
  }
  // /seen and /afk records (data/commands/groups/afk.ts), keyed "g<groupId>:<groupMemberId>"
  const records = ref.chatType === "group" ? [rt.store.collection("seen"), rt.store.collection("afk")] : []
  const prefix = `g${ref.chatId}:${memberId ?? ""}`
  for (const c of records) for (const k of c.keys()) if (memberId === undefined ? k.startsWith(prefix) : k === prefix) c.delete(k)

  if (memberId !== undefined) {
    return rt.scheduler.cancelWhere((j) => {
      const p = j.payload as {ref?: unknown; memberId?: number; byMemberId?: number}
      return j.kind === "reminder" && (p.memberId === memberId || p.byMemberId === memberId) && sameChat(p.ref)
    })
  }
  const ended = new Set(rt.interactions.endWhere((ix) => sameChat(ix.ref)))
  const jobs = rt.scheduler.cancelWhere((j) => {
    const p = j.payload as {ref?: unknown; id?: unknown} | undefined
    return sameChat(p?.ref) || (typeof p?.id === "string" && ended.has(p.id))
  })
  return jobs + ended.size
}
