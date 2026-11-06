import {defineCommand, fmt} from "../../../src/sdk"

interface Summary {
  type: string
  title: string
  description?: string
  extract: string
  content_urls?: {desktop?: {page?: string}}
}

export default defineCommand({
  name: "wiki",
  aliases: ["wikipedia"],
  description: "Wikipedia summary: /wiki SimpleX Chat",
  category: "Web",
  args: [{name: "query", type: "text", description: "What to look up", required: true}],
  examples: ["wiki Ada Lovelace", "wiki Double ratchet algorithm"],
  live: "📚 Searching Wikipedia",
  cooldown: 5,
  async run(ctx) {
    const service = "Wikipedia"
    const [, titles = []] = await ctx.http.json<[string, string[]]>("https://en.wikipedia.org/w/api.php", {
      service,
      query: {action: "opensearch", search: ctx.args.query, limit: 5, namespace: 0, format: "json"},
    })
    const title = titles[0]
    if (!title) return ctx.fail(`Wikipedia has nothing on "${ctx.args.query}".`)
    const s = await ctx.http.json<Summary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, {service})
    const url = s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`
    if (s.type === "disambiguation") {
      const others = titles.slice(1, 5).map((t) => `• ${ctx.ui.cmd("wiki", t)}`)
      return fmt.lines(`📚 ${fmt.bold(s.title)} can mean several things.`, others.length ? "Try:" : undefined, ...others, url)
    }
    return fmt.lines(
      `📚 ${fmt.bold(s.title)}${s.description ? ` — ${fmt.italic(s.description)}` : ""}`,
      "",
      fmt.truncate(s.extract, 900),
      "",
      url,
      titles.length > 1 ? `${fmt.italic("See also:")} ${titles.slice(1, 4).map((t) => ctx.ui.cmd("wiki", t)).join("  ")}` : undefined
    )
  },
})
