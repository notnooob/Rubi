import {defineCommand, describeError, fmt, modLog, newId, T, type CommandContext} from "../../../src/sdk"

/**
 * The moderation log goes to admins by DM, never into the group. To DM an admin, Rubi needs a direct chat with
 * the same person who is the group member, and SimpleX deliberately doesn't link the two. Three ways, tried in order:
 * 1. The member already is Rubi's contact (`memberContactId`, e.g. they connected through the group before).
 * 2. Rubi asks for one: it creates a member contact and sends a contact request inside the group. It uses the
 *    profile they joined with (also an incognito one). Needs the group to allow direct messages.
 * 3. A one-time code: /modlog link in a DM with Rubi (from any profile, even an unrelated one), then
 *    /modlog on <code> in the group. Codes are single-use and expire after 10 minutes.
 */
const codes = new Map<string, {contactId: number; name: string; expires: number}>()
const CODE_MS = 10 * 60_000

export default defineCommand({
  name: "modlog",
  description: "Get the group's moderation log by DM (admins)",
  details:
    "In a group, /modlog on sends you every moderation action (kicks, blocks, warnings, deleted and filtered messages, " +
    "setting changes) by DM, and /modlog off stops it. Nothing sensitive is posted in the group. If I can't reach you " +
    "yet, I send you a contact request in the group. To use another profile (e.g. not the incognito one you joined " +
    "with), send /modlog link to me in a DM from that profile, then /modlog on <code> in the group.",
  category: "Moderation",
  args: [
    {name: "action", type: "string", description: "on, off or link", choices: ["on", "off", "link"]},
    {name: "code", type: "string", description: "Code from /modlog link"},
  ],
  examples: ["modlog on", "modlog off", "modlog link", "modlog on 4f7a2c"],
  cooldown: 5,
  async run(ctx) {
    const {action, code} = ctx.args
    if (!ctx.isGroup) {
      if (action !== "link") return `🛡 Send ${ctx.ui.cmd("modlog", "link")} here for a code, then ${fmt.code("/modlog on <code>")} in your group, and I'll DM you its moderation log here.`
      const id = newId(3)
      codes.set(id, {contactId: ctx.contact!.contactId, name: ctx.sender.displayName, expires: Date.now() + CODE_MS})
      for (const [k, v] of codes) if (v.expires < Date.now()) codes.delete(k)
      return fmt.lines(`🔗 Your code: ${fmt.code(id)}`, `Send ${fmt.code(`/modlog on ${id}`)} in the group as an admin (within 10 minutes). The code works once.`)
    }

    // group admins only (also for bot admins): the log is only ever sent to members who are admins right now
    if (!ctx.hasRole(T.GroupMemberRole.Admin)) return ctx.fail("The moderation log is for group admins.")
    const g = ctx.group!
    const me = ctx.sender.member!
    const key = String(me.groupMemberId)
    const subs = (await ctx.groupData.get()).modlog ?? {}

    if (action === undefined) {
      const mine = subs[key]
      return fmt.lines(
        mine ? "🛡 You get this group's moderation log by DM." : `🛡 You don't get the moderation log. Turn it on: ${ctx.ui.cmd("modlog", "on")}`,
        fmt.italic(`${fmt.plural(Object.keys(subs).length, "admin")} subscribed.`)
      )
    }
    if (action === "link") return ctx.fail(`Send /modlog link to me in a DM, not here.`)
    if (action === "off") {
      if (!subs[key]) return ctx.fail("You don't get the moderation log.")
      await ctx.groupData.update((s) => {
        delete s.modlog?.[key]
      })
      return "🛡 Moderation log off for you."
    }

    // on
    if (code) {
      const c = codes.get(code.toLowerCase())
      if (!c || c.expires < Date.now()) return ctx.fail(`That code is unknown or expired. Get a new one with /modlog link in a DM with me.`)
      codes.delete(code.toLowerCase())
      // the code was just posted in the group: delete it (best effort), so nobody reads it
      await ctx.chat.apiDeleteMemberChatItem(g.groupId, [ctx.itemId]).catch(() => undefined)
      return subscribe(ctx, c.contactId, `linked to your DM profile ${fmt.bold(c.name)}`)
    }
    if (subs[key]) return "🛡 You already get the moderation log by DM."

    // an existing direct chat with this member
    if (me.memberContactId !== undefined) {
      const ok = await ctx.rt.messenger.send({chatType: T.ChatType.Direct, chatId: me.memberContactId}, welcome(g)).then(
        () => true,
        () => false
      )
      if (ok) return subscribe(ctx, me.memberContactId, "check your DMs with me")
    }
    // ask for one through the group
    try {
      const contact = await ctx.chat.apiCreateMemberContact(g.groupId, me.groupMemberId)
      await ctx.chat.apiSendMemberContactInvitation(contact.contactId, welcome(g))
      return subscribe(ctx, contact.contactId, "I sent you a contact request: accept it to start getting it")
    } catch (e) {
      ctx.log.debug(`modlog: member contact for @${me.memberProfile.displayName} failed: ${describeError(e)}`)
      return fmt.lines(
        "🔒 I can't send you a contact request here (this group may not allow direct messages).",
        `Instead: send ${fmt.code("/modlog link")} to me in a DM, then ${fmt.code("/modlog on <code>")} here.`
      )
    }
  },
})

function welcome(g: T.GroupInfo): string {
  return `🛡 I'll send you ${g.groupProfile.displayName}'s moderation log here. Stop it with /modlog off in the group.`
}

async function subscribe(ctx: CommandContext<any>, contactId: number, how: string): Promise<string> {
  const me = ctx.sender.member!
  await ctx.groupData.update((s) => {
    ;(s.modlog ??= {})[String(me.groupMemberId)] = {contactId, name: me.memberProfile.displayName}
  })
  void modLog(ctx.rt, ctx.group!, `${me.memberProfile.displayName} turned on the moderation log`)
  return `🛡 Moderation log on: ${how}.`
}
