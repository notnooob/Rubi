import {defineCommand, fmt} from "../../../src/sdk"
import {convertUnits, findUnit, formatUnitNumber, UnitError, unitReference} from "../../../src/util/units"
import {parseNumeric} from "../../../src/util/number"

/** Split "<amount> <from> [to] <to>", including multi-word unit names and "32°F". */
export function parseConversion(query: string): {amount: number; from: string; to: string} | undefined {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const match = words[0]?.match(/^([+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([\s\S]*)$/i)
  if (!match) return undefined
  const amount = parseNumeric(match[1]!)
  if (amount === undefined) return undefined

  // Convenient compact forms: 32°F, 10km→mi, 10km in mi.
  let rest = [match[2], ...words.slice(1)].filter(Boolean).join(" ").trim()
  if (!rest) return undefined
  rest = rest.replace(/^(?:to)\s+/i, "").replace(/(?:\s*→\s*|\s*->\s*)/, " ")
  const parts = rest.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return undefined

  // Prefer a known complete source name; otherwise consume words until the target resolves.
  for (let split = parts.length - 1; split >= 1; split--) {
    const from = parts.slice(0, split).join(" ")
    const right = parts.slice(split)
    // "to" is always a connector here; "in" is a connector only when followed by another token,
    // preserving the valid inch unit in `12 in cm`.
    const to = /^(?:to|in)$/i.test(right[0] ?? "") && right.length > 1 ? right.slice(1).join(" ") : right.join(" ")
    if (findUnit(from) && findUnit(to)) return {amount, from, to}
  }
  // Return a useful split even for unknown names, so the caller can report which one failed.
  const from = parts.slice(0, -1).join(" ")
  return {amount, from, to: parts[parts.length - 1]!}
}

export default defineCommand({
  name: "convert",
  description: "Convert units offline: /convert 1,000 m ft",
  details: "Length, mass, temperature, area, volume, speed, time, data, energy, power, pressure and angle. Use symbols or full names; add 'to' if you like. /convert units shows the categories and common units.",
  category: "Utility",
  args: [{name: "query", type: "text", description: "<amount> <from> [to] <to>, or units", required: true}],
  examples: ["convert 1,000 m ft", "convert 32 F to C", "convert 2 cups mL", "convert units"],
  run(ctx) {
    const query = ctx.args.query.trim()
    if (/^units?$/i.test(query)) {
      return fmt.lines(
        `📐 ${fmt.bold("Unit conversion (offline)")}`,
        fmt.code("convert <amount> <from> [to] <to>"),
        unitReference(),
        fmt.italic("Examples: 1,000 m ft · 32 F to C · 2 cups mL")
      )
    }
    const parsed = parseConversion(query)
    if (!parsed) return ctx.usageError("Use <amount> <from> [to] <to>, for example 10 km to miles. Send /convert units for supported categories.")
    try {
      const result = convertUnits(parsed.amount, parsed.from, parsed.to)
      return `📐 ${fmt.bold(`${formatUnitNumber(parsed.amount)} ${result.from.symbol}`)} = ${fmt.bold(`${formatUnitNumber(result.value)} ${result.to.symbol}`)}`
    } catch (e) {
      if (e instanceof UnitError) return ctx.fail(e.message)
      throw e
    }
  },
})
