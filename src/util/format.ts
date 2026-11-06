/**
 * SimpleX markdown helpers.
 *
 * SimpleX clients render: *bold*, _italic_, ~strike~, `code`, ```code block```,
 * #secret# (tap to reveal), !1 colored! (1 red, 2 green, 3 blue, 4 yellow, 5 cyan, 6 magenta),
 * links, @mentions and /commands (tappable in bot chats).
 *
 * Note: inline markers must hug the text (`*bold*`, not `* bold *`).
 */

export const bold = (s: string | number): string => wrap("*", s)
export const italic = (s: string | number): string => wrap("_", s)
export const strike = (s: string | number): string => wrap("~", s)
export const secret = (s: string | number): string => wrap("#", s)
export const code = (s: string | number): string => wrap("`", s)
export const codeBlock = (s: string): string => "```\n" + s + "\n```"

export type Color = "red" | "green" | "blue" | "yellow" | "cyan" | "magenta"
const COLOR_CODE: Record<Color, number> = {red: 1, green: 2, blue: 3, yellow: 4, cyan: 5, magenta: 6}
export const color = (c: Color, s: string | number): string => {
  const str = String(s)
  const t = str.trim()
  if (!t) return ""
  return `${str.match(/^\s*/)![0]}!${COLOR_CODE[c]} ${t}!${str.match(/\s*$/)![0]}`
}

/**
 * Markers must hug the text, and SimpleX only sees them after a space/punctuation, so surrounding
 * whitespace is kept *outside* the markers: italic(" (me)") → " _(me)_", not "_(me)_".
 */
function wrap(m: string, s: string | number): string {
  const str = String(s)
  const t = str.trim()
  if (!t) return ""
  const lead = str.match(/^\s*/)![0]
  const trail = str.match(/\s*$/)![0]
  return `${lead}${m}${t}${m}${trail}`
}

/**
 * A tappable command. Without params it renders `/name`; with params it uses the
 * SimpleX quoted form `/'name params'`, which is highlighted as a whole and sent as `/name params` when tapped.
 */
export function command(name: string, params?: string, prefix = "/"): string {
  const p = params?.trim()
  return p ? `${prefix}'${name} ${p}'` : `${prefix}${name}`
}

/**
 * A "button": a label followed by a tappable command. SimpleX has no inline keyboards, but commands in
 * bot messages are tappable and send instantly, e.g. `button("🎲", "roll", "2d6")` → `🎲 /'roll 2d6'`.
 */
export function button(label: string, name: string, params?: string, prefix = "/"): string {
  const cmd = command(name, params, prefix)
  return label ? `${label} ${cmd}` : cmd
}

/** A row of buttons separated by spacing dots. */
export function buttons(items: (string | false | undefined)[], sep = "  ·  "): string {
  return items.filter((s): s is string => !!s).join(sep)
}

/** Progress bar: bar(0.4) → "▰▰▰▰▱▱▱▱▱▱" */
export function bar(fraction: number, width = 10): string {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const full = Math.round(f * width)
  return "▰".repeat(full) + "▱".repeat(width - full)
}

/** "3m ago", "in 2h" */
export function relative(time: number | Date, now = Date.now()): string {
  const diff = +time - now
  const d = duration(Math.abs(Math.round(diff / 1000) * 1000)).split(" ").slice(0, 2).join(" ")
  return diff >= 0 ? `in ${d}` : `${d} ago`
}

/** "3h ago" during the first week, then a date: "Mar 12, 2024". */
export function when(time: number | Date, now = Date.now()): string {
  const ms = +time
  const ago = now - ms
  if (ago < 60_000) return "just now"
  if (ago < 3600_000) return `${Math.floor(ago / 60_000)}m ago`
  if (ago < 86400_000) return `${Math.floor(ago / 3600_000)}h ago`
  if (ago < 7 * 86400_000) return `${Math.floor(ago / 86400_000)}d ago`
  return new Date(ms).toLocaleDateString("en-US", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"})
}

/** Short counts: 1234 → "1,234", 92431 → "92.4K", 14386542 → "14.4M" */
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return num(n, 0)
  return new Intl.NumberFormat("en-US", {notation: "compact", maximumFractionDigits: 1}).format(n)
}

/** Thousands separators and sensible decimals: 1234567.891 → "1,234,567.89" */
export function num(n: number, maxDecimals = 2): string {
  return n.toLocaleString("en-US", {maximumFractionDigits: maxDecimals})
}

/** `@name`, quoted when the name contains spaces — the form SimpleX uses for mentions. */
export function mention(displayName: string): string {
  return /\s/.test(displayName) ? `@'${displayName}'` : `@${displayName}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** 3725000 → "1h 2m 5s" */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  let s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  s %= 86400
  const h = Math.floor(s / 3600)
  s %= 3600
  const m = Math.floor(s / 60)
  s %= 60
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, (s || (!d && !h && !m)) && `${s}s`].filter(Boolean).join(" ")
}

export function truncate(s: string, max: number, ellipsis = "…"): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - ellipsis.length)) + ellipsis
}

/** Joins non-empty lines/blocks with newlines — handy for building replies conditionally. */
export function lines(...parts: (string | false | null | undefined)[]): string {
  // drop blank lines left at the end (e.g. by buttons not shown in this chat) and collapse 3+ newlines
  return parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "")
}

/** Capitalize first letter. */
export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
