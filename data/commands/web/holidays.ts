import {defineCommand, findCountry, fmt, HttpError} from "../../../src/sdk"

interface Holiday {
  date: string
  localName: string
  name: string
  global: boolean
}

export default defineCommand({
  name: "holidays",
  aliases: ["holiday"],
  description: "Upcoming public holidays: /holidays Germany",
  details: "Data from Nager.Date — about 120 countries are covered.",
  category: "Web",
  args: [{name: "country", type: "text", description: "Country name or code", required: true}],
  examples: ["holidays Germany", "holidays us"],
  live: "🎉 Checking the calendar",
  cooldown: 3,
  async run(ctx) {
    const c = findCountry(ctx.args.country)
    if (!c) return ctx.fail(`I don't know a country called "${ctx.args.country}".`)
    let list: Holiday[]
    try {
      list = await ctx.http.json<Holiday[]>(`https://date.nager.at/api/v3/NextPublicHolidays/${c.cca2}`, {service: "Nager.Date"})
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return ctx.fail(`I don't have holiday data for ${c.name.common}.`)
      throw e
    }
    if (!list.length) return `${c.flag} No upcoming public holidays found for ${c.name.common}.`
    const rows = list.slice(0, 8).map((h) => {
      const d = new Date(`${h.date}T12:00:00Z`)
      const day = d.toLocaleDateString("en-GB", {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"})
      const name = h.localName !== h.name ? `${h.name} ${fmt.italic(`(${h.localName})`)}` : h.name
      return `• ${fmt.bold(day)} — ${name}${h.global ? "" : fmt.italic(" · regional")}`
    })
    return fmt.lines(`${c.flag} ${fmt.bold(`Upcoming holidays in ${c.name.common}`)}`, "", ...rows)
  },
})
