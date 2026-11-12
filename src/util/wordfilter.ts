/**
 * Banned-word matching for /filter. Entries are lowercase words or phrases; `*` matches any letters/digits
 * ("crypto*" also blocks "cryptocoin"). Matching is case-insensitive and on whole words only, so "ass" doesn't
 * block "class".
 */
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

const cache = new Map<string, RegExp>()

function filterRegex(entries: readonly string[]): RegExp {
  const key = entries.join("\n")
  let re = cache.get(key)
  if (!re) {
    const body = entries.map((e) => escape(e).replace(/\*/g, `${WORD}*`).replace(/ /g, "\\s+")).join("|")
    re = new RegExp(`(?<!${WORD})(?:${body})(?!${WORD})`, "iu")
    if (cache.size > 200) cache.clear()
    cache.set(key, re)
  }
  return re
}

/** The first blocked word or phrase found in `text`, if any. */
export function findBlocked(entries: readonly string[], text: string): string | undefined {
  if (!entries.length) return undefined
  return text.match(filterRegex(entries))?.[0]
}

/** For "/filter remove": an entry is removed when it equals the pattern, or matches it as a `*` glob. */
export function matchesPattern(pattern: string, entry: string): boolean {
  if (pattern === entry) return true
  return new RegExp(`^${escape(pattern).replace(/\*/g, ".*")}$`, "iu").test(entry)
}
