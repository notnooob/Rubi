import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "ping",
  aliases: ["pong"],
  description: "Check I'm online and how fast I reply",
  live: "🏓 Pinging",
  cooldown: 5,
  async run(ctx) {
    const t0 = performance.now()
    await ctx.chat.apiGetActiveUser()
    const core = performance.now() - t0
    const sentAt = Date.parse(ctx.item.chatItem.meta.itemTs)
    const delivery = Number.isFinite(sentAt) ? Math.max(0, ctx.startedAt - sentAt) : undefined
    const quality = delivery === undefined ? "" : delivery < 1500 ? "🟢" : delivery < 5000 ? "🟡" : "🔴"
    return fmt.lines(
      "🏓 *Pong!*",
      delivery !== undefined ? `${quality} Message reached me in ~${fmt.duration(delivery)}` : undefined,
      `⚙️ Chat core: ${core.toFixed(1)}ms`,
      `⏱ Up for ${fmt.duration(Date.now() - ctx.rt.startedAt.getTime())}`,
      ctx.ui.button("\n🔁", "ping")
    )
  },
})
