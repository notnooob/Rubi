import {defineCommand, fmt, HttpError, parseNumeric} from "../../../src/sdk"

interface Rates {
  amount: number
  base: string
  date: string
  rates: Record<string, number>
}

export default defineCommand({
  name: "currency",
  aliases: ["fx"],
  description: "Convert money: /currency 20 usd eur",
  details: "European Central Bank reference rates via frankfurter.dev (updated on working days). Leave out the target for a few common ones.",
  category: "Web",
  args: [{name: "query", type: "text", description: "[amount] <from> [to] — e.g. 20 usd eur, 100 gbp to jpy", required: true}],
  examples: ["currency 20 usd eur", "currency 100 gbp to jpy", "currency eur"],
  live: "💱 Fetching rates",
  cooldown: 3,
  async run(ctx) {
    const words = ctx.args.query.toUpperCase().replace(/\bTO\b|\bIN\b/g, " ").split(/\s+/).filter(Boolean)
    const amount = words[0] ? parseNumeric(words.shift()!) ?? NaN : 1
    const [from, to] = words
    if (!from || !/^[A-Z]{3}$/.test(from) || (to && !/^[A-Z]{3}$/.test(to)) || !Number.isFinite(amount) || amount <= 0) {
      return ctx.usageError("Use 3-letter currency codes, e.g. 20 usd eur.")
    }
    const targets = to ? [to] : ["USD", "EUR", "GBP", "JPY", "CHF"].filter((c) => c !== from)
    let r: Rates
    try {
      r = await ctx.http.json<Rates>("https://api.frankfurter.dev/v1/latest", {
        service: "The exchange-rate service",
        query: {base: from, symbols: targets.join(","), amount},
      })
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 422)) return ctx.fail(`I don't know that currency (${[from, to].filter(Boolean).join(" or ")}).`)
      throw e
    }
    const rows = Object.entries(r.rates).map(([cur, v]) => `${fmt.bold(fmt.num(v, 2))} ${cur}`)
    return fmt.lines(`💱 ${fmt.bold(fmt.num(amount, 2))} ${from} =`, ...rows.map((x) => `   ${x}`), fmt.italic(`ECB rate of ${r.date}`))
  },
})
