import {defineCommand, fmt, modLog, T} from "../../../src/sdk"

export default defineCommand({
  name: "report",
  description: "Report a message to admins (reply)",
  details:
    "Reply to a message with /report and an optional reason. Admins who turned on the moderation log (/modlog on) get it " +
    "by DM, with the message text. If I'm a moderator, I remove your /report message so the report stays discreet, " +
    "and confirm by DM when I can.",
  category: "Moderation",
  scope: "group",
  args: [{name: "reason", type: "text", description: "Why (optional)"}],
  examples: ["report spam link", "report"],
  // only successful reports count against the once-a-minute limit (below), so a wrong reply costs nothing
  cooldown: 0,
  async run(ctx) {
    const g = ctx.group!
    const quoted = ctx.item.chatItem.quotedItem
    if (quoted?.chatDir?.type === "groupSnd") return ctx.fail("That's my own message. If I did something wrong, tell an admin.")
    if (!quoted || quoted.chatDir?.type !== "groupRcv") return ctx.usageError("Reply to the message you want to report.")
    const author = quoted.chatDir.groupMember
    if (author.groupMemberId === ctx.sender.member?.groupMemberId) return ctx.fail("You can't report your own message.")
    if (!Object.keys(ctx.groupData.peek().modlog ?? {}).length) {
      return ctx.fail(`No admins receive reports here yet. An admin can turn them on with ${ctx.ui.cmd("modlog", "on")}.`)
    }

    if (!ctx.isBotAdmin && !ctx.rt.limiter.throttle(`report:${g.groupId}:${ctx.sender.key}`, 60_000)) {
      return ctx.fail("You've just sent a report. You can send another in a minute.")
    }

    const reason = ctx.args.reason?.trim().slice(0, 300)
    const text = quoted.content.text?.trim() || `(${quoted.content.type})`
    void modLog(
      ctx.rt,
      g,
      `🚩 ${ctx.sender.displayName} reported a message from ${author.memberProfile.displayName}${reason ? ` (${reason})` : ""}: ${fmt.truncate(text, 500)}`
    )

    // keep it discreet: remove the /report message if I can, and confirm privately
    if (ctx.botHasRole(T.GroupMemberRole.Moderator)) {
      try {
        await ctx.chat.apiDeleteMemberChatItem(g.groupId, [ctx.itemId])
        const contactId = ctx.sender.member?.memberContactId
        if (contactId !== undefined) {
          await ctx.rt.messenger
            .send({chatType: T.ChatType.Direct, chatId: contactId}, `✅ Your report in ${fmt.bold(g.groupProfile.displayName)} was sent to the admins.`)
            .catch(() => undefined)
        }
        return
      } catch {
        // fall through to a reply in the group
      }
    }
    return "✅ Reported to the admins."
  },
})
