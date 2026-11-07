import {randomInt} from "node:crypto"
import {defineCommand, fmt, HttpError} from "../../../src/sdk"

interface Comic {
  num: number
  title: string
  alt: string
  img: string
  year: string
  month: string
  day: string
}

export default defineCommand({
  name: "xkcd",
  description: "An xkcd comic (latest, random or by number)",
  category: "Fun",
  args: [{name: "which", type: "string", description: "latest (default), random, or a number"}],
  examples: ["xkcd", "xkcd random", "xkcd 927"],
  live: "🖍 Fetching xkcd",
  cooldown: 3,
  async run(ctx) {
    const which = (ctx.args.which ?? "latest").toLowerCase()
    const get = (n?: number) => ctx.http.json<Comic>(`https://xkcd.com/${n ? `${n}/` : ""}info.0.json`, {service: "xkcd"})
    let c: Comic
    try {
      if (which === "latest") c = await get()
      else if (which === "random") {
        const latest = await get()
        let n = randomInt(1, latest.num + 1)
        if (n === 404) n = 405 // xkcd 404 is famously missing
        c = await get(n)
      } else if (/^[\d,]+$/.test(which)) c = await get(Number(which.replace(/,/g, "")))
      else return ctx.usageError("Use latest, random, or a comic number.")
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return ctx.fail("There's no xkcd with that number.")
      throw e
    }
    return fmt.lines(
      `🖍 ${fmt.bold(`xkcd #${c.num}: ${c.title}`)} ${fmt.italic(`(${c.year}-${c.month.padStart(2, "0")}-${c.day.padStart(2, "0")})`)}`,
      c.img,
      fmt.italic(c.alt),
      `https://xkcd.com/${c.num}`,
      ctx.ui.button("\n🎲", "xkcd", "random")
    )
  },
})
