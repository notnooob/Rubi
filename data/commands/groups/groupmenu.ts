import {defineCommand, describeError, fmt, T, groupMenuBudget} from "../../../src/sdk"

/**
 * SimpleX apps make /commands in messages tappable — and show the "/" command menu — in a group only when the
 * group profile has bot commands (groupPreferences.commands). Only owners can change the group profile, so
 * Rubi must be an owner to set it. Menus are re-synced on start and /reload (see Rubi.syncGroupMenus).
 */
export default defineCommand({
  name: "groupmenu",
  aliases: ["menu"],
  description: "Make my commands tappable here and add them to the / menu",
  details:
    "SimpleX apps only make commands tappable in a group when the group profile has a command menu, and only owners can set it — so I need to be a group owner. /groupmenu off removes it.",
  category: "Groups",
  scope: "group",
  permission: "owner",
  botRole: T.GroupMemberRole.Owner,
  args: [{name: "state", type: "boolean", description: "on (default) or off"}],
  examples: ["groupmenu", "groupmenu off"],
  cooldown: 10,
  async run(ctx) {
    const g = ctx.group!
    const on = ctx.args.state ?? true
    const prefs = {...(g.groupProfile.groupPreferences ?? {})}
    if (on) prefs.commands = ctx.rt.commands.menu({forGroup: true, maxBytes: groupMenuBudget(g.groupProfile), exclude: (await ctx.groupData.get()).disabled})
    else delete prefs.commands
    try {
      await ctx.chat.apiUpdateGroupProfile(g.groupId, {...g.groupProfile, groupPreferences: prefs})
    } catch (e) {
      ctx.log.warn(`groupmenu failed: ${describeError(e)}`)
      return ctx.fail("SimpleX didn't accept the updated group profile — if the group has a large picture, the profile may be too big to also hold the menu.")
    }
    return on
      ? fmt.lines(
          "✅ Commands are now tappable in this group, and members get my commands in the / menu.",
          fmt.italic("Members may need to reopen the chat to see it. Turn off with /groupmenu off.")
        )
      : "✅ Group command menu removed — commands show as plain text again."
  },
})
