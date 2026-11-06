import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "fact",
  aliases: ["funfact"],
  description: "A random (useless) fact",
  category: "Fun",
  live: "🧐 Digging up a fact",
  cooldown: 3,
  async run(ctx) {
    const f = await ctx.http.json<{text: string}>("https://uselessfacts.jsph.pl/api/v2/facts/random", {service: "The fact service", query: {language: "en"}})
    return fmt.lines(`🧐 ${f.text.trim()}`, ctx.ui.button("\n🔁", "fact"))
  },
})
