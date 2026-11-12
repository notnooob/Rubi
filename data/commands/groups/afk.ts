import {defineCommand, fmt} from "../../../src/sdk"

/** Per-member activity records in the store, keyed by memberKey (written by data/events/activity.ts). */
export interface SeenEntry {
  at: number
  name: string
}
export interface AfkEntry {
  since: number
  name: string
  reason?: string
}
export const SEEN = "seen"
export const AFK = "afk"
export const memberKey = (groupId: number, groupMemberId: number) => `g${groupId}:${groupMemberId}`

const MAX_REASON = 200

export default defineCommand({
  name: "afk",
  aliases: ["away", "brb"],
  description: "Mark yourself as away: /afk lunch",
  details: "While you're away, I tell people who @mention you. It ends as soon as you post again.",
  category: "Groups",
  scope: "group",
  args: [{name: "reason", type: "text", description: "Why you're away"}],
  examples: ["afk", "afk lunch, back at 2"],
  async run(ctx) {
    const reason = ctx.args.reason?.trim()
    if (reason && reason.length > MAX_REASON) return ctx.fail(`Keep the reason under ${MAX_REASON} characters.`)
    const member = ctx.sender.member!
    ctx.rt.store.collection<AfkEntry>(AFK).set(memberKey(ctx.group!.groupId, member.groupMemberId), {since: Date.now(), name: ctx.sender.displayName, reason})
    return `💤 ${fmt.bold(ctx.sender.displayName)} is away${reason ? `: ${reason}` : ""}. I'll tell people who mention you.`
  },
})
