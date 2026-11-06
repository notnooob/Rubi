import {defineCommand, fmt, qrDataUri} from "../../../src/sdk"

export default defineCommand({
  name: "qr",
  aliases: ["qrcode"],
  description: "Make a QR code: /qr https://simplex.chat",
  category: "Utility",
  args: [{name: "text", type: "text", description: "Text or link to encode", required: true}],
  examples: ["qr https://simplex.chat"],
  cooldown: 5,
  async run(ctx) {
    const text = ctx.args.text
    if (text.length > 1000) return ctx.usageError("That's too long for a scannable QR code (1000 characters max).")
    await ctx.replyImage(await qrDataUri(text), fmt.truncate(text, 300))
  },
})
