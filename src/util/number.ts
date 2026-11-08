/** Numeric input accepted by commands: plain digits or conventional 3-digit comma groups. */
export const NUMERIC_PATTERN = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[+-]?\d+)?$/i

export function parseNumeric(input: string): number | undefined {
  const value = input.trim()
  if (!NUMERIC_PATTERN.test(value)) return undefined
  const n = Number(value.replace(/,/g, ""))
  return Number.isFinite(n) ? n : undefined
}

export function isIntegerNumeric(input: string): boolean {
  const n = parseNumeric(input)
  return n !== undefined && Number.isInteger(n)
}
