import {randomInt} from "node:crypto"
import {defineCommand, fmt, HttpError} from "../../../src/sdk"

/** Used when the quote API is unreachable. */
const FALLBACK = [
  ["Privacy is not something that I'm merely entitled to, it's an absolute prerequisite.", "Marlon Brando"],
  ["Arguing that you don't care about the right to privacy because you have nothing to hide is no different than saying you don't care about free speech because you have nothing to say.", "Edward Snowden"],
  ["The best way to predict the future is to invent it.", "Alan Kay"],
  ["Simplicity is prerequisite for reliability.", "Edsger W. Dijkstra"],
  ["What I cannot create, I do not understand.", "Richard Feynman"],
] as const

export default defineCommand({
  name: "quote",
  aliases: ["inspire"],
  description: "A random quote",
  category: "Fun",
  live: "💭 Finding a quote",
  cooldown: 3,
  async run(ctx) {
    let text: string
    let author: string
    try {
      const q = await ctx.http.json<{quote: string; author: string}>("https://dummyjson.com/quotes/random", {service: "The quote service", timeoutMs: 6000})
      text = q.quote
      author = q.author
    } catch (e) {
      if (!(e instanceof HttpError)) throw e
      ;[text, author] = FALLBACK[randomInt(FALLBACK.length)]!
    }
    return fmt.lines(`💭 ${fmt.italic(`“${text}”`)}`, `— ${fmt.bold(author)}`, ctx.ui.button("🔁", "quote"))
  },
})
