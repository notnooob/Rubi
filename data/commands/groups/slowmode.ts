import {defineCommand, fmt, parseDuration, T} from "../../../src/sdk"

const MIN_MS = 5_000
const MAX_MS = 6 * 3_600_000

export default defineCommand({
  name: "slowmode",
  description: "Limit how often members can post (admins)",
  details:
    "Members below moderator can send one message per interval; faster messages are deleted. Commands don't count. " +
    "Interval: 5s to 6h. /slowmode off turns it off. I need to be a moderator or higher.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [{name: "interval", type: "text", description: "e.g. 30s, 2m, or off"}],
  examples: ["slowmode 30s", "slowmode off"],
  async run(ctx) {
    const {interval} = ctx.args
    if (interval === undefined) {
      const ms = (await ctx.groupData.get()).slowmodeMs
      return ms ? `🐢 Slow mode is on: one message every ${fmt.bold(fmt.duration(ms))}.` : `🐢 Slow mode is ${fmt.bold("off")}. Turn it on: ${ctx.ui.cmd("slowmode", "30s")}`
    }
    const off = /^(off|0|no|disable)$/i.test(interval)
    const ms = off ? undefined : parseDuration(interval)
    if (!off && ms === undefined) return ctx.usageError(`"${interval}" isn't a duration — try 30s, 2m or off.`)
    if (ms !== undefined && (ms < MIN_MS || ms > MAX_MS)) return ctx.fail("Slow mode can be from 5 seconds to 6 hours.")
    if (ms && !ctx.botHasRole(T.GroupMemberRole.Moderator)) return ctx.fail("Make me a moderator (or admin) first, so I can delete messages.")
    await ctx.groupData.update((s) => {
      s.slowmodeMs = ms
    })
    return ms ? `🐢 Slow mode on: members can send one message every ${fmt.bold(fmt.duration(ms))}.` : "🐢 Slow mode off."
  },
})
