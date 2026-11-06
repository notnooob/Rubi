import {chatErrorType, defineCommand, describeError, fmt, type T} from "../../../src/sdk"

/** The plan's status tag ("ok", "known", "ownLink", …). */
function planStatus(plan: T.ConnectionPlan): string {
  switch (plan.type) {
    case "invitationLink":
      return plan.invitationLinkPlan.type
    case "contactAddress":
      return plan.contactAddressPlan.type
    case "groupLink":
      return plan.groupLinkPlan.type
    case "error":
      return "error"
  }
}

const KIND_LABEL: Record<T.ConnectionPlan["type"], string> = {
  invitationLink: "one-time invitation",
  contactAddress: "contact address",
  groupLink: "group link",
  error: "link",
}

export default defineCommand({
  name: "join",
  aliases: ["connect"],
  description: "Make me join a group link or connect to an address",
  details: "Works with SimpleX group links, contact addresses and one-time invitation links.",
  category: "Admin",
  permission: "botAdmin",
  args: [{name: "link", type: "string", description: "SimpleX link", required: true}],
  live: "🔗 Checking the link",
  timeout: 90,
  async run(ctx) {
    const link = ctx.args.link.trim()
    const userId = ctx.rt.user.userId
    let plan: T.ConnectionPlan
    let prepared: T.CreatedConnLink
    try {
      ;[plan, prepared] = await ctx.chat.apiConnectPlan(userId, link)
    } catch (e) {
      const t = chatErrorType(e)
      if (t === "invalidConnReq" || t === "unsupportedConnReq") return ctx.fail("That isn't a valid SimpleX link.")
      throw e
    }
    const kind = KIND_LABEL[plan.type]
    const status = planStatus(plan)
    switch (status) {
      case "error":
        return ctx.fail("SimpleX couldn't read that link.")
      case "ownLink":
        return ctx.fail(`That's my own ${kind}.`)
      case "known":
      case "contactViaAddress":
        return `ℹ️ I'm already connected via that ${kind}.`
      case "connecting":
      case "connectingProhibit":
        return `ℹ️ I'm already connecting via that ${kind} — waiting for the other side.`
      case "noRelays":
      case "updateRequired":
        return ctx.fail(`I can't join that ${kind} (${status}).`)
    }
    ctx.progress(`🔗 Connecting via ${kind}`)
    try {
      await ctx.chat.apiConnect(userId, false, prepared)
    } catch (e) {
      return ctx.fail(`Couldn't connect: ${describeError(e)}`)
    }
    return fmt.lines(
      `✅ Request sent via ${kind}.`,
      plan.type === "groupLink" ? fmt.italic("I'll be in once the group lets me in — I'll say hi then.") : undefined
    )
  },
})
