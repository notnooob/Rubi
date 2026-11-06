import {setTimeout as sleep} from "node:timers/promises"
import {defineCommand, describeError, fmt, T} from "../../../src/sdk"

export default defineCommand({
  name: "broadcast",
  aliases: ["announce"],
  description: "Send a message to all my contacts",
  details: "Asks for confirmation, then sends with live progress. Contacts that deleted me are skipped.",
  category: "Admin",
  permission: "botAdmin",
  scope: "direct",
  args: [{name: "message", type: "text", description: "What to send", required: true}],
  timeout: 3600,
  async run(ctx) {
    const contacts = (await ctx.chat.apiListContacts(ctx.rt.user.userId)).filter(
      (c) => c.contactStatus === T.ContactStatus.Active && c.activeConn && c.contactId !== ctx.contact?.contactId
    )
    if (!contacts.length) return ctx.fail("I have no other contacts to send to.")
    const text = `📢 ${ctx.args.message}`
    if (!(await ctx.confirm(fmt.lines(`📢 Send this to ${fmt.bold(fmt.plural(contacts.length, "contact"))}?`, "", text)))) return

    const live = await ctx.defer(`📢 Sending 0/${contacts.length}`)
    let sent = 0
    const failed: string[] = []
    for (const c of contacts) {
      if (ctx.signal.aborted) break
      try {
        await ctx.rt.messenger.send({chatType: T.ChatType.Direct, chatId: c.contactId}, text)
        sent++
      } catch (e) {
        failed.push(c.profile.displayName)
        ctx.log.warn(`broadcast to #${c.contactId} failed: ${describeError(e)}`)
      }
      live.update(`📢 Sending ${sent + failed.length}/${contacts.length}`)
      await sleep(150)
    }
    return fmt.lines(
      `📢 Broadcast done: ${fmt.bold(sent)}/${contacts.length} sent.`,
      failed.length ? fmt.italic(`Failed: ${fmt.truncate(failed.join(", "), 500)}`) : undefined
    )
  },
})
