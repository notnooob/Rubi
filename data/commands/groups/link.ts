import {defineCommand, fmt, qrDataUri, T} from "../../../src/sdk"

export default defineCommand({
  name: "link",
  aliases: ["grouplink"],
  description: "Show or create this group's invite link (admins)",
  details: "/link shows the link (creating one if needed), /link new replaces it, /link delete removes it. I need to be a group admin.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  botRole: T.GroupMemberRole.Admin,
  args: [{name: "action", type: "string", description: "new or delete", choices: ["new", "delete"]}],
  cooldown: 10,
  async run(ctx) {
    const groupId = ctx.group!.groupId
    const name = ctx.group!.groupProfile.displayName
    const existing = await ctx.chat.apiGetGroupLinkStr(groupId).catch(() => undefined)

    if (ctx.args.action === "delete") {
      if (!existing) return ctx.fail("This group has no link.")
      if (!(await ctx.confirm(`🗑 Delete the invite link of ${fmt.bold(name)}? Nobody will be able to join with it.`))) return
      await ctx.chat.apiDeleteGroupLink(groupId)
      return "🗑 Group link deleted."
    }

    let link = existing
    if (ctx.args.action === "new" && existing) {
      if (!(await ctx.confirm("🔄 Replace the group link? The old one will stop working."))) return
      await ctx.chat.apiDeleteGroupLink(groupId)
      link = undefined
    }
    link ??= await ctx.chat.apiCreateGroupLink(groupId, T.GroupMemberRole.Member)
    await ctx.replyImage(await qrDataUri(link), `🔗 Join ${name}:\n${link}`)
  },
})
