/**
 * Banned-word matching for /filter. Entries are lowercase words or phrases; `*` matches any letters/digits
 * ("crypto*" also blocks "cryptocoin"). Matching is case-insensitive.
 *
 * Levels (`/filter level …`):
 * - normal: whole words only, so "ass" doesn't block "class".
 * - strict: also sees through look-alike and decorated letters (Cyrillic "а", "𝓈𝓅𝒶𝓂", accents), digits and
 *   symbols used as letters (sp4m, $pam, @ss), invisible characters and stretched letters (spaaaam).
 *   Still whole words. A word written with digits on purpose ("b4") can now match an entry ("ba").
 * - max: strict, plus letters split by spaces or dots ("s p a m", "s.p.a.m"), and matches inside longer words
 *   too ("ass" then blocks "class"), so expect false positives.
 */
export type FilterLevel = "normal" | "strict" | "max"
export const FILTER_LEVELS: readonly FilterLevel[] = ["normal", "strict", "max"]
export const MAX_FILTER_WORDS = 500
export const MAX_FILTER_WORD_LENGTH = 60

const WORD = "[\\p{L}\\p{N}]"
const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")

/** "spam, buy now; crypto*" → ["spam", "buy now", "crypto*"]. Commas, semicolons and newlines separate entries. */
export function parseWordList(input: string): string[] {
  const words = input
    .split(/[,;\n]/)
    .map((w) => w.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((w) => w && w !== "*")
  return [...new Set(words)]
}

const LOOKALIKE: Record<string, string> = {
  // digits and symbols used as letters
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t",
  // Cyrillic and Greek letters that look Latin
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
}

/** Combining marks (accents), soft hyphen and zero-width characters. */
const INVISIBLE = /[\p{M}\u00AD\u200B-\u200D\u2060\uFEFF]/gu

/** Text as the strict levels see it: decorations and accents removed, look-alikes mapped, stretched letters shortened. */
function fold(s: string, joinSplitLetters: boolean): string {
  let t = s
    .normalize("NFKD")
    .replace(INVISIBLE, "")
    .toLowerCase()
  // "s p a m" / "s.p.a.m" → "spam" (3+ single letters in a row)
  if (joinSplitLetters) t = t.replace(/(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][\s._\-~·*]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu, (m) => m.replace(/[^\p{L}\p{N}]/gu, ""))
  return (
    t
      // symbols count as letters only before a letter or digit ("$pam", "@ss"), so "spam!" stays "spam"
      .replace(/[@$!|+](?=[\p{L}\p{N}])/gu, (c) => LOOKALIKE[c]!)
      .replace(/[\p{L}\p{N}]/gu, (c) => LOOKALIKE[c] ?? c)
      .replace(/(.)\1{2,}/gu, "$1")
  )
}

const cache = new Map<string, RegExp>()

function filterRegex(entries: readonly string[], level: FilterLevel): RegExp {
  const key = `${level}\n${entries.join("\n")}`
  let re = cache.get(key)
  if (!re) {
    const space = level === "max" ? "\\s*" : "\\s+"
    const body = entries.map((e) => escape(level === "normal" ? e : fold(e, false)).replace(/\*/g, `${WORD}*`).replace(/ /g, space)).join("|")
    re = level === "max" ? new RegExp(`(?:${body})`, "iu") : new RegExp(`(?<!${WORD})(?:${body})(?!${WORD})`, "iu")
    if (cache.size > 200) cache.clear()
    cache.set(key, re)
  }
  return re
}

/** The first blocked word or phrase found in `text`, if any (as it appears after the level's normalization). */
export function findBlocked(entries: readonly string[], text: string, level: FilterLevel = "normal"): string | undefined {
  if (!entries.length) return undefined
  const t = level === "normal" ? text : fold(text, level === "max")
  return t.match(filterRegex(entries, level))?.[0]
}

/** For "/filter remove": an entry is removed when it equals the pattern, or matches it as a `*` glob. */
export function matchesPattern(pattern: string, entry: string): boolean {
  if (pattern === entry) return true
  return new RegExp(`^${escape(pattern).replace(/\*/g, ".*")}$`, "iu").test(entry)
}
