import {countryByCode, defineCommand, findCountry, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "country",
  description: "Facts about a country: /country Japan",
  details: "Name, ISO code (de, usa) or common alternative (UK) all work. Data is built in (world-countries, ODbL), so no web request is made.",
  category: "Web",
  args: [{name: "name", type: "text", description: "Country name or code", required: true}],
  examples: ["country Japan", "country de", "country UK"],
  cooldown: 2,
  run(ctx) {
    const c = findCountry(ctx.args.name)
    if (!c) return ctx.fail(`I don't know a country called "${ctx.args.name}".`)
    const currencies = Object.entries(c.currencies ?? {}).map(([code, v]) => `${v.name} (${code}${v.symbol ? `, ${v.symbol}` : ""})`)
    const languages = Object.values(c.languages ?? {})
    const borders = c.borders.map((b) => countryByCode(b)).filter((b): b is NonNullable<typeof b> => !!b)
    const demonym = c.demonyms?.eng?.m
    return fmt.lines(
      `${c.flag} ${fmt.bold(c.name.common)}${c.name.official !== c.name.common ? ` — ${fmt.italic(c.name.official)}` : ""}`,
      "",
      c.capital?.length ? `🏛 ${fmt.bold("Capital:")} ${c.capital.join(", ")}` : undefined,
      `🌍 ${fmt.bold("Region:")} ${c.subregion || c.region}`,
      `📐 ${fmt.bold("Area:")} ${fmt.num(c.area)} km²${c.landlocked ? " · landlocked" : ""}`,
      currencies.length ? `💰 ${fmt.bold("Currency:")} ${currencies.join(", ")}` : undefined,
      languages.length ? `🗣 ${fmt.bold("Languages:")} ${languages.join(", ")}` : undefined,
      demonym ? `🙋 ${fmt.bold("People:")} ${demonym}` : undefined,
      borders.length ? `🧭 ${fmt.bold("Borders:")} ${borders.map((b) => `${b.flag} ${b.name.common}`).join(", ")}` : undefined,
      `🔤 ${fmt.bold("Codes:")} ${c.cca2} / ${c.cca3}${c.tld?.length ? ` · ${c.tld.join(", ")}` : ""}${c.idd?.root ? ` · ☎️ ${c.idd.root}${c.idd.suffixes?.length === 1 ? c.idd.suffixes[0] : ""}` : ""}`,
      ctx.ui.button("\n🎉 Holidays", "holidays", c.cca2)
    )
  },
})
