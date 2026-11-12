import {defineCommand, fmt} from "../../../src/sdk"
import {AFK, memberKey, SEEN, type AfkEntry, type SeenEntry} from "./afk"

export default defineCommand({
  name: "seen",
  aliases: ["lastseen"],
  description: "When a member last posted: /seen @bob",
  details: "Counts messages since I joined the group (to the minute). Also shows whether they're /afk.",
  category: "Groups",
  scope: "group",
  args: [{name: "member", type: "member", description: "Who", required: true}],
  examples: ["seen @bob"],
  async run(ctx) {
    const {member} = ctx.args
    const g = ctx.group!
    if (member.groupMemberId === g.membership.groupMemberId) return "🤖 I'm right here."
    const key = memberKey(g.groupId, member.groupMemberId)
    const seen = ctx.rt.store.collection<SeenEntry>(SEEN).get(key)
    const afk = ctx.rt.store.collection<AfkEntry>(AFK).get(key)
    const name = fmt.bold(member.memberProfile.displayName)
    return fmt.lines(
      seen ? `👀 ${name} last posted ${fmt.bold(fmt.relative(seen.at))}.` : `👀 I haven't seen ${name} post here yet.`,
      afk && `💤 Away${afk.reason ? `: ${afk.reason}` : ""} ${fmt.italic(`(${fmt.relative(afk.since)})`)}`
    )
  },
})
