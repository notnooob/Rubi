import {cleanTrackingUrl, firstHttpUrl} from "../../../src/util/links"
import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "cleanlink",
  aliases: ["cleanurl"],
  description: "Remove tracking from a link",
  details: "Works offline and never opens the URL. Signed or tokenized URLs are left unchanged rather than risking a broken link.",
  category: "Utility",
  args: [{name: "url", type: "text", description: "HTTP(S) URL"}],
  examples: ["cleanlink https://example.org/?utm_source=newsletter&id=7"],
  run(ctx) {
    const input = ctx.args.url?.trim() || firstHttpUrl(ctx.item.chatItem.quotedItem?.content.text ?? "")
    if (!input) return ctx.usageError("Give an HTTP(S) URL or reply to a message containing one.")
    try {
      const result = cleanTrackingUrl(input)
      if (result.skipped) return `🔒 ${fmt.code(result.url)}\n${fmt.italic("Left unchanged because it contains signing or token parameters.")}`
      return result.changed ? `🧹 ${fmt.code(result.url)}` : `✅ No common tracking parameters found: ${fmt.code(result.url)}`
    } catch {
      return ctx.usageError("That isn't a valid HTTP(S) URL.")
    }
  },
})
