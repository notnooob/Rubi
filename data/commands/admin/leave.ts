import {defineCommand, fmt, forgetChat, T} from "../../../src/sdk"

export default defineCommand({
  name: "leave",
  description: "Make me leave a group",
  details: "In a group: /leave leaves that group. Anywhere: /leave <groupId> (ids are in /groups).",
  category: "Admin",
  permission: "botAdmin",
  args: [{name: "groupId", type: "integer", description: "Group id (default: this group)"}],
  async run(ctx) {
    const id = ctx.args.groupId ?? ctx.group?.groupId
    if (id === undefined) return ctx.usageError("Give a group id (see /groups), or use /leave inside the group.")
    const g = ctx.group?.groupId === id ? ctx.group : (await ctx.chat.apiListGroups(ctx.rt.user.userId)).find((x) => x.groupId === id)
    if (!g) return ctx.fail(`I'm not in a group with id ${id}.`)
    if (!(await ctx.confirm(`🚪 Leave ${fmt.bold(g.groupProfile.displayName)}?`))) return
    if (ctx.group?.groupId === id) await ctx.send("👋 Bye everyone!").catch(() => undefined)
    await ctx.chat.apiLeaveGroup(id)
    forgetChat(ctx.rt, {chatType: T.ChatType.Group, chatId: id})
    // can't reply in a group we just left
    if (ctx.group?.groupId !== id) return `🚪 Left ${fmt.bold(g.groupProfile.displayName)}.`
  },
})
