import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "whoami",
  aliases: ["me", "id"],
  description: "Show your ids and role (handy for setting up bot admins)",
  details: "In a DM it shows your contact id — put it in RUBI_BOT_ADMINS to make yourself a bot admin. In a group it shows your member id and role.",
  run(ctx) {
    const s = ctx.sender
    if (ctx.isGroup) {
      const g = ctx.group!
      return fmt.lines(
        `👤 ${fmt.bold(s.displayName)} in ${fmt.bold(g.groupProfile.displayName)}`,
        `Role: ${fmt.bold(s.role ?? "?")}`,
        `Member id: ${fmt.code(`#${s.member?.groupMemberId}`)}`,
        s.contactId !== undefined
          ? `Linked contact id: ${fmt.code(s.contactId)}`
          : `${fmt.italic("Not linked to a direct chat with me. DM me")} ${ctx.ui.cmd("whoami")} ${fmt.italic("to get your contact id.")}`,
        ctx.isBotAdmin ? "⭐ You're a bot admin." : undefined
      )
    }
    return fmt.lines(
      `👤 ${fmt.bold(s.displayName)}`,
      `Contact id: ${fmt.code(s.contactId ?? "?")}`,
      ctx.isBotAdmin
        ? "⭐ You're a bot admin."
        : fmt.italic(`Bot operator? Add ${fmt.code(`RUBI_BOT_ADMINS=${s.contactId}`)} to Rubi's .env and restart.`)
    )
  },
})
