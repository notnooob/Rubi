import {defineCommand, fmt} from "../../../src/sdk"

interface Search {
  coins: {id: string; name: string; symbol: string; market_cap_rank: number | null}[]
}

export default defineCommand({
  name: "crypto",
  aliases: ["coin", "price"],
  description: "Crypto price: /crypto btc",
  details: "Prices from CoinGecko. Optionally add a currency: /crypto eth eur",
  category: "Web",
  args: [
    {name: "coin", type: "string", description: "Coin name or symbol", required: true},
    {name: "currency", type: "string", description: "Fiat currency (default usd)"},
  ],
  examples: ["crypto btc", "crypto monero eur"],
  live: "🪙 Checking prices",
  cooldown: 5,
  async run(ctx) {
    const service = "CoinGecko"
    const q = ctx.args.coin.toLowerCase()
    const vs = (ctx.args.currency ?? "usd").toLowerCase()
    const found = await ctx.http.json<Search>("https://api.coingecko.com/api/v3/search", {service, query: {query: q}})
    // prefer an exact symbol/name match with the best market-cap rank
    const exact = found.coins.filter((c) => c.symbol.toLowerCase() === q || c.id === q || c.name.toLowerCase() === q)
    const coin = (exact.length ? exact : found.coins).sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0]
    if (!coin) return ctx.fail(`I couldn't find a coin called "${ctx.args.coin}".`)

    const prices = await ctx.http.json<Record<string, Record<string, number>>>("https://api.coingecko.com/api/v3/simple/price", {
      service,
      query: {ids: coin.id, vs_currencies: vs, include_24hr_change: true, include_market_cap: true},
    })
    const p = prices[coin.id]
    const price = p?.[vs]
    if (price === undefined) return ctx.fail(`No ${vs.toUpperCase()} price for ${coin.name}.`)
    const change = p?.[`${vs}_24h_change`]
    const cap = p?.[`${vs}_market_cap`]
    const changeText = change === undefined ? "" : fmt.color(change >= 0 ? "green" : "red", `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}% (24h)`)
    return fmt.lines(
      `🪙 ${fmt.bold(coin.name)} ${fmt.italic(coin.symbol.toUpperCase())}${coin.market_cap_rank ? ` · #${coin.market_cap_rank}` : ""}`,
      `${fmt.bold(`${fmt.num(price, price < 1 ? 6 : 2)} ${vs.toUpperCase()}`)}  ${changeText}`,
      cap ? fmt.italic(`Market cap ${fmt.num(cap, 0)} ${vs.toUpperCase()}`) : undefined,
      ctx.ui.button("🔁", "crypto", `${q}${ctx.args.currency ? ` ${vs}` : ""}`)
    )
  },
})
