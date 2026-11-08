import {defineCommand, fmt, parseNumeric} from "../../../src/sdk"

export default defineCommand({
  name: "timestamp",
  aliases: ["ts", "epoch", "unix"],
  description: "Convert Unix timestamps and dates",
  details: "No argument: the current time. A number: Unix seconds (or milliseconds if it's 13+ digits). Anything else: parsed as a date (ISO 8601 works best).",
  category: "Utility",
  args: [{name: "value", type: "text", description: "Unix time or a date"}],
  examples: ["timestamp", "timestamp 1700000000", "timestamp 2030-01-01T00:00:00Z"],
  run(ctx) {
    const v = ctx.args.value?.trim()
    let ms: number
    if (!v) ms = Date.now()
    else if (/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(v)) {
      const n = parseNumeric(v)!
      ms = Math.abs(n).toString().replace(/^-/, "").split(".")[0]!.length >= 13 ? n : n * 1000
    } else ms = Date.parse(v)
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return ctx.usageError(`I can't read "${v}" as a time.`)
    const d = new Date(ms)
    return fmt.lines(
      `🕰 ${fmt.bold(d.toUTCString())}`,
      `Unix: ${fmt.code(Math.floor(ms / 1000))} · ms: ${fmt.code(ms)}`,
      `ISO: ${fmt.code(d.toISOString())}`,
      fmt.italic(fmt.relative(ms))
    )
  },
})
