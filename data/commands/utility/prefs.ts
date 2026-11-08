import {defineCommand, findCountry, fmt} from "../../../src/sdk"

const KEYS = ["weather", "country", "currency"] as const
type Preference = (typeof KEYS)[number]

export default defineCommand({
  name: "prefs",
  description: "View or set your personal command defaults",
  details: "Defaults are used only in direct chats when a command omits a place, country or currency. Explicit arguments always win.",
  category: "Utility",
  scope: "direct",
  args: [
    {name: "action", type: "string", description: "set, reset or list"},
    {name: "value", type: "text", description: "Preference and value"},
  ],
  examples: ["prefs", "prefs set weather Oslo", "prefs reset currency"],
  async run(ctx) {
    const action = (ctx.args.action ?? "list").toLowerCase()
    const value = ctx.args.value?.trim() ?? ""
    const settings = await ctx.contactData.get()
    if (action === "list" && !value) {
      return fmt.lines(
        "⚙️ *Your defaults*",
        `🌦 Weather: ${settings.defaultWeather ? fmt.code(settings.defaultWeather) : fmt.italic("not set")}`,
        `🌍 Country: ${settings.defaultCountry ? fmt.code(settings.defaultCountry) : fmt.italic("not set")}`,
        `💱 Currency: ${settings.defaultCurrency ? fmt.code(settings.defaultCurrency.toUpperCase()) : fmt.italic("not set")}`,
        fmt.italic("Set one with /prefs set weather Oslo")
      )
    }
    if (action === "set") {
      const [key, ...rest] = value.split(/\s+/)
      const val = rest.join(" ").trim()
      if (!KEYS.includes(key as Preference) || !val) return ctx.usageError("Use /prefs set weather <place>, country <country> or currency <code>.")
      if (key === "country") {
        const country = findCountry(val)
        if (!country) return ctx.fail(`I don't know a country called "${val}".`)
        await ctx.contactData.update((s) => {
          s.defaultCountry = country.cca2
        })
        return `✅ Default country saved: ${country.flag} ${fmt.bold(country.name.common)}.`
      }
      if (key === "currency") {
        if (!/^[a-z]{3}$/i.test(val)) return ctx.usageError("Currency defaults must be a 3-letter code, such as EUR or USD.")
        await ctx.contactData.update((s) => {
          s.defaultCurrency = val.toUpperCase()
        })
        return `✅ Default currency saved: ${fmt.bold(val.toUpperCase())}.`
      }
      await ctx.contactData.update((s) => {
        s.defaultWeather = val
      })
      return `✅ Default weather place saved: ${fmt.bold(val)}.`
    }
    if (action === "reset") {
      const key = value.toLowerCase()
      if (key === "all") {
        await ctx.contactData.update((s) => {
          delete s.defaultWeather
          delete s.defaultCountry
          delete s.defaultCurrency
        })
        return "✅ All personal defaults reset."
      }
      if (!KEYS.includes(key as Preference)) return ctx.usageError("Reset weather, country, currency or all.")
      await ctx.contactData.update((s) => {
        if (key === "weather") delete s.defaultWeather
        if (key === "country") delete s.defaultCountry
        if (key === "currency") delete s.defaultCurrency
      })
      return `✅ Default ${key} reset.`
    }
    return ctx.usageError("Use /prefs, /prefs set <weather|country|currency> <value>, or /prefs reset <name|all>.")
  },
})
