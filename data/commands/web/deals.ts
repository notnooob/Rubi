import {attachmentsBlocked, defineCommand, fmt, thumbnail, type CommandContext} from "../../../src/sdk"
import {fetchGameDeals, renderGameDealsChunks} from "../../../src/services/cheapshark"

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
    if ("candidates" in result) {
      return fmt.lines(
        `🎮 ${fmt.bold("Several games match")}`,
        ...result.candidates.map((g) => `• ${g.external} — ${ctx.ui.cmd("deals", `id ${g.gameID}`)}`),
        fmt.italic("Choose one of the titles above.")
      )
    }

    const chunks = renderGameDealsChunks(result.game, result.stores)
    const caption = chunks[0]!
    const image = await gameThumbnail(ctx, result.game.info.thumb)
    // replyImage deletes the text-only live placeholder and sends one image message with this full caption.
    if (image) await ctx.replyImage(image, caption)
    else await ctx.reply(caption)
    for (const chunk of chunks.slice(1)) await ctx.send(chunk)
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
