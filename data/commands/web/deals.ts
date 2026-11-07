import {attachmentsBlocked, defineCommand, thumbnail, type CommandContext} from "../../../src/sdk"
import {fetchGameDeals, renderGameDeals} from "../../../src/services/cheapshark"

export default defineCommand({
  name: "deals",
  description: "Current PC game deals: /deals <game title>",
  details: "Finds a game by title and shows its Steam app id, historical low and every current store deal from CheapShark, with prices in USD and links through CheapShark.",
  category: "Web",
  args: [{name: "title", type: "text", description: "Game title", required: true}],
  examples: ["deals LEGO Batman", "deals Baldur's Gate 3"],
  live: "💰 Finding game deals",
  cooldown: 5,
  timeout: 60,
  async run(ctx) {
    const result = await fetchGameDeals(ctx.http, ctx.args.title)
    if (!result) return ctx.fail(`I couldn't find a game called "${ctx.args.title.trim()}" on CheapShark.`)

    const caption = renderGameDeals(result.game, result.stores)
    const image = await gameThumbnail(ctx, result.game.info.thumb)
    // replyImage deletes the text-only live placeholder and sends one image message with this full caption.
    if (image) await ctx.replyImage(image, caption)
    else return caption
  },
})

/** Best effort: any artwork problem simply leaves the command with its complete text reply. */
async function gameThumbnail(ctx: CommandContext, url?: string): Promise<string | undefined> {
  if (!url || attachmentsBlocked(ctx)) return undefined
  ctx.progress("🖼 Preparing the game artwork")
  try {
    const res = await ctx.http.request(url, {service: "CheapShark artwork", publicOnly: true, maxBytes: 5 * 1024 * 1024})
    const type = res.headers.get("content-type") ?? ""
    if (!type.toLowerCase().startsWith("image/")) return undefined
    return await thumbnail(res.body)
  } catch (e) {
    if (ctx.signal.aborted) throw e
    ctx.log.debug("CheapShark artwork failed:", (e as Error).message)
    return undefined
  }
}
