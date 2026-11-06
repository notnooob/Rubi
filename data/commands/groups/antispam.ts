import {defineCommand, fmt, T} from "../../../src/sdk"

export default defineCommand({
  name: "antispam",
  description: "Delete links from brand-new members (admins)",
  details: "When on, links posted by members who joined less than 24 hours ago (and are below moderator) are deleted. I need to be a moderator or higher.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [{name: "state", type: "boolean", description: "on or off"}],
  examples: ["antispam on", "antispam off"],
  async run(ctx) {
    const {state} = ctx.args
    if (state === undefined) {
      const on = !!(await ctx.groupData.get()).antispam
      return fmt.lines(
        `🧹 Anti-spam is ${fmt.bold(on ? "on" : "off")}.`,
        ctx.ui.button(on ? "Turn off" : "Turn on", "antispam", on ? "off" : "on")
      )
    }
    if (state && !ctx.botHasRole(T.GroupMemberRole.Moderator)) return ctx.fail("Make me a moderator (or admin) first, so I can delete messages.")
    await ctx.groupData.update((s) => {
      s.antispam = state
    })
    return state ? "🧹 Anti-spam on: links from members who joined in the last 24h will be removed." : "🧹 Anti-spam off."
  },
})
