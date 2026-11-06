import {defineCommand, fmt} from "../../../src/sdk"

interface Item {
  id: number
  title: string
  url?: string
  score: number
  descendants?: number
  by: string
}

export default defineCommand({
  name: "hn",
  aliases: ["hackernews", "news"],
  description: "Top stories on Hacker News",
  category: "Web",
  args: [{name: "count", type: "integer", description: "How many (1–10, default 5)", min: 1, max: 10}],
  examples: ["hn", "hn 10"],
  live: "📰 Fetching top stories",
  cooldown: 10,
  async run(ctx) {
    const base = "https://hacker-news.firebaseio.com/v0"
    const ids = await ctx.http.json<number[]>(`${base}/topstories.json`, {service: "Hacker News"})
    const n = ctx.args.count ?? 5
    const items = (await Promise.all(ids.slice(0, n).map((id) => ctx.http.json<Item | null>(`${base}/item/${id}.json`, {service: "Hacker News"}).catch(() => null)))).filter(
      (i): i is Item => !!i
    )
    if (!items.length) return ctx.fail("Hacker News didn't return any stories.")
    const rows = items.map((it, i) => {
      const host = it.url ? new URL(it.url).hostname.replace(/^www\./, "") : "news.ycombinator.com"
      return fmt.lines(
        `${i + 1}. ${fmt.bold(it.title)} ${fmt.italic(`(${host})`)}`,
        `   ▲ ${it.score} · 💬 ${it.descendants ?? 0} · https://news.ycombinator.com/item?id=${it.id}`
      )
    })
    return fmt.lines(`📰 ${fmt.bold("Hacker News — top stories")}`, "", rows.join("\n\n"))
  },
})
