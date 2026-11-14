import {defineCommand, fmt, geocode, isTimeZone, placeLabel, utcOffset} from "../../../src/sdk"

function clock(timeZone: string): string {
  const now = new Date()
  const time = new Intl.DateTimeFormat("en-GB", {timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(now)
  const date = new Intl.DateTimeFormat("en-GB", {timeZone, weekday: "long", day: "numeric", month: "long"}).format(now)
  return `${fmt.bold(time)} · ${date} ${fmt.italic(`(${utcOffset(timeZone)})`)}`
}

function futureAt(input: string): string | undefined {
  const parts = input.split("|").map((s) => s.trim()).filter(Boolean)
  const instant = parts.shift()
  if (!instant || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(instant)) return undefined
  const at = Date.parse(instant)
  if (!Number.isFinite(at)) return undefined
  const zones = parts.length ? parts : ["UTC"]
  if (zones.some((z) => !isTimeZone(z))) return undefined
  return fmt.lines(
    `🕐 ${fmt.bold(new Date(at).toISOString())} · ${fmt.relative(at)}`,
    ...zones.map((zone) => {
      const local = new Intl.DateTimeFormat("en-GB", {timeZone: zone, dateStyle: "full", timeStyle: "short"}).format(at)
      return `🌍 ${fmt.bold(zone)}: ${local} ${fmt.italic(`(${utcOffset(zone, at)})`)}`
    })
  )
}

export default defineCommand({
  name: "time",
  aliases: ["clock", "tz"],
  description: "Current time anywhere: /time Tokyo",
  details:
    "Give a city or an IANA zone (Europe/Berlin). In a DM, /time set <place> saves your zone — then /time shows it and /remind uses it for clock times.",
  category: "Utility",
  args: [{name: "place", type: "text", description: "City, country or time zone — or: set <place>"}],
  examples: ["time Tokyo", "time Europe/Berlin", "time set London"],
  async run(ctx) {
    let q = ctx.args.place?.trim()
    if (/^at\s+/i.test(q ?? "")) {
      const result = futureAt(q!.replace(/^at\s+/i, ""))
      if (!result) return ctx.usageError("Use /time at <ISO instant with Z/offset> | <IANA zone> | <IANA zone>.")
      return result
    }
    const saving = /^set\s+/i.test(q ?? "")
    if (saving) {
      if (!ctx.isDirect) return ctx.fail("Save your time zone in a DM with me.")
      q = q!.replace(/^set\s+/i, "")
    }

    if (!q) {
      const tz = ctx.isDirect ? (await ctx.contactData.get()).timezone : undefined
      return fmt.lines(
        tz ? `🕐 ${fmt.bold("Your time")} (${tz})\n${clock(tz)}` : undefined,
        `🌍 ${fmt.bold("UTC")}: ${clock("UTC")}`,
        tz || !ctx.isDirect ? undefined : `${fmt.italic("Tip:")} ${ctx.ui.cmd("time", "set <your city>")} ${fmt.italic("saves your time zone.")}`
      )
    }

    let label: string
    let tz: string
    if (isTimeZone(q)) {
      tz = new Intl.DateTimeFormat("en-US", {timeZone: q}).resolvedOptions().timeZone
      label = tz
    } else {
      const place = await geocode(ctx.http, q)
      tz = place.timezone
      label = placeLabel(place)
    }

    if (saving) {
      await ctx.contactData.update((s) => {
        s.timezone = tz
      })
      return `✅ Saved your time zone: ${fmt.bold(tz)} — ${clock(tz)}`
    }
    return `🕐 ${fmt.bold(label)}\n${clock(tz)}`
  },
})
