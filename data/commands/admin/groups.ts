import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "groups",
  aliases: ["mygroups"],
  description: "List the groups I'm in",
  category: "Admin",
  permission: "botAdmin",
  async run(ctx) {
    const groups = await ctx.chat.apiListGroups(ctx.rt.user.userId)
    if (!groups.length) return "📭 I'm not in any groups."
    const active = (status: string) => !/left|removed|deleted|rejected/.test(status)
    await ctx.paginate({
      title: `👥 ${fmt.bold("My groups")} (${groups.length})`,
      items: groups
        .sort((a, b) => a.groupProfile.displayName.localeCompare(b.groupProfile.displayName))
        .map((g) => {
          const status = g.membership.memberStatus
          return `• ${fmt.bold(g.groupProfile.displayName)} ${fmt.italic(`#${g.groupId} · ${g.groupSummary.currentMembers} members · I'm ${g.membership.memberRole}${active(status) ? "" : ` · ${status}`}`)}${
            active(status) ? `  ${ctx.ui.button("🚪", "leave", String(g.groupId))}` : ""
          }`
        }),
      perPage: 12,
    })
  },
})
