import {defineCommand, qrDataUri} from "../../../src/sdk"

export default defineCommand({
  name: "invite",
  aliases: ["address"],
  description: "Get my SimpleX address (link + QR code)",
  cooldown: 10,
  async run(ctx) {
    const link = ctx.rt.addressLink
    if (!link) return ctx.fail("I don't have a public address right now.")
    const name = ctx.config.profile.displayName
    await ctx.replyImage(await qrDataUri(link), `🔗 Chat with ${name} on SimpleX — scan the code or open:\n${link}`)
  },
})
