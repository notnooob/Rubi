import {defineCommand, moderate, T} from "../../../src/sdk"

export default defineCommand({
  name: "delete",
  aliases: ["del", "rm"],
  description: "Reply to a message with /delete to remove it for everyone",
  details: "Works on members' messages (moderators) and on my own messages. The /delete message is removed too.",
  category: "Moderation",
  scope: "group",
  permission: "moderator",
  botRole: T.GroupMemberRole.Moderator,
  cooldown: 0,
  async run(ctx) {
    const quoted = ctx.item.chatItem.quotedItem
    if (!quoted) return ctx.usageError("Reply to (quote) the message you want to delete, with /delete as the text.")
    if (quoted.itemId === undefined) return ctx.fail("I can't find that message — it may be too old or already deleted.")
    const groupId = ctx.group!.groupId
    const ownMessage = quoted.chatDir?.type === "groupSnd"
    if (ownMessage) await ctx.rt.messenger.delete(ctx.ref, [quoted.itemId])
    else await moderate(() => ctx.chat.apiDeleteMemberChatItem(groupId, [quoted.itemId!]))
    // tidy up: remove the /delete command message too (best effort)
    try {
      await ctx.chat.apiDeleteMemberChatItem(groupId, [ctx.itemId])
    } catch {
      await ctx.react("✅")
    }
  },
})
