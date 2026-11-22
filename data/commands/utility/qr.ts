import {defineCommand, fmt, qrDataUri} from "../../../src/sdk"

export default defineCommand({
  name: "qr",
  aliases: ["qrcode"],
  description: "Make a QR code: /qr https://simplex.chat",
  category: "Utility",
  details: "Reply to a message with /qr to encode that message's text.",
  args: [{name: "text", type: "text", description: "Text or link to encode (or reply to a message)"}],
  examples: ["qr https://simplex.chat"],
  cooldown: 5,
  async run(ctx) {
    const text = ctx.args.text ?? ctx.quotedText
    if (!text) return ctx.usageError("Give the text or link to encode, or reply to a message with /qr.")
    if (text.length > 1000) return ctx.usageError("That's too long for a scannable QR code (1000 characters max).")
    await ctx.replyImage(await qrDataUri(text), fmt.truncate(text, 300))
  },
})
