import {capitalize, duration} from "./format"

/**
 * Time parsing for commands like /remind.
 *
 *   parseDuration("1h30m") → 5_400_000      parseDuration("2 days") → 172_800_000
 *   parseWhen("10m") / parseWhen("in 2 hours") / parseWhen("18:30") / parseWhen("tomorrow 9:00")
 */

const UNITS: Record<string, number> = {
  s: 1_000, sec: 1_000, secs: 1_000, second: 1_000, seconds: 1_000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
}

/** "1h30m", "90s", "2 days 3h" → milliseconds, or undefined if it isn't a duration. */
export function parseDuration(input: string): number | undefined {
  const s = input.trim().toLowerCase()
  if (!s) return undefined
  // A comma after a duration unit separates parts ("1h,30m"); numeric commas
  // use the same conventional grouping rules as other command arguments.
  const normalized = s.replace(/([a-z]),/g, "$1 ")
  let total = 0
  let pos = 0
  while (pos < normalized.length) {
    const separator = normalized.slice(pos).match(/^(?:\s+|and\s+)/)
    if (separator) pos += separator[0].length
    const m = normalized.slice(pos).match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([a-z]+)/)
    if (!m) return undefined
    const unit = UNITS[m[2]!]
    if (unit === undefined) return undefined
    const number = m[1]!.replace(/,/g, "")
    total += Number(number) * unit
    pos += m[0].length
  }
  if (!total) return undefined
  return Math.round(total)
}

/**
 * Splits a "when" from the start of `input`, for "/remind 10m take a break".
 * Returns the due time (epoch ms) and the rest of the text, or undefined.
 * - durations: "10m", "in 2 hours", "1h 30m"
 * - clock times: "18:30", "6pm", "tomorrow 9:00"
 * - dates (time optional, default 9:00): "dec 24 18:00", "24 december", "2026-12-24 8am", "friday 9:00", "on fri".
 *   A date without a year that has already passed means next year; a weekday means its next occurrence.
 * Clock times and dates use `timeZone` (IANA; default: the server's).
 */
export function parseWhen(input: string, now = Date.now(), timeZone?: string): {at: number; rest: string} | undefined {
  const words = input.trim().split(/\s+/)
  let i = 0
  if (/^(in|on)$/i.test(words[0] ?? "")) i = 1

  const date = parseDate(words, i, now, timeZone)
  if (date) {
    const clock = parseClock(words[date.next] ?? "")
    if (clock === null) return undefined
    const [h, m] = clock ?? [9, 0]
    let at = zonedAt(date.y, date.mo, date.d, h, m, timeZone)
    if (at <= now) {
      if (date.weekday) at = zonedAt(date.y, date.mo, date.d + 7, h, m, timeZone)
      else if (date.explicitYear) return undefined
      else at = zonedAt(date.y + 1, date.mo, date.d, h, m, timeZone)
    }
    return {at, rest: words.slice(date.next + (clock ? 1 : 0)).join(" ")}
  }

  // clock time: [today|tomorrow] HH:MM[am|pm]
  let dayOffset = 0
  let j = i
  if (/^(today|tomorrow)$/i.test(words[j] ?? "")) {
    dayOffset = words[j]!.toLowerCase() === "tomorrow" ? 1 : 0
    j++
  }
  const clock = parseClock(words[j] ?? "")
  if (clock === null) return undefined
  if (clock) {
    const [h, min] = clock
    const today = todayIn(now, timeZone)
    let at = zonedAt(today.y, today.mo, today.d + dayOffset, h, min, timeZone)
    if (at <= now && dayOffset === 0) at = zonedAt(today.y, today.mo, today.d + 1, h, min, timeZone)
    return {at, rest: words.slice(j + 1).join(" ")}
  }

  // duration: take the longest prefix of words that parses ("1h 30m", "2 hours")
  for (let k = Math.min(words.length, i + 6); k > i; k--) {
    const ms = parseDuration(words.slice(i, k).join(" "))
    if (ms) return {at: now + ms, rest: words.slice(k).join(" ")}
  }
  return undefined
}

/** "18:30", "6:30pm", "6pm" → [h, m]; undefined if it isn't a clock time (a bare "6" isn't); null if invalid ("25:00"). */
function parseClock(word: string): [number, number] | undefined | null {
  const clock = word.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i)
  if (!clock || (clock[2] === undefined && clock[3] === undefined)) return undefined
  let h = Number(clock[1])
  const min = Number(clock[2] ?? 0)
  const ampm = clock[3]?.toLowerCase()
  if (ampm && (h < 1 || h > 12)) return null
  if (ampm === "pm" && h < 12) h += 12
  if (ampm === "am" && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return [h, min]
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
/** "dec", "december", "sept" → 1–12 */
function monthIndex(word: string): number | undefined {
  const w = word.toLowerCase().replace(/[.,]$/, "")
  if (w.length < 3) return undefined
  const i = MONTHS.findIndex((m) => m.startsWith(w))
  return i < 0 ? undefined : i + 1
}
const dayNumber = (word: string | undefined): number | undefined => {
  const m = word?.match(/^(\d{1,2})(st|nd|rd|th)?,?$/i)
  const d = m ? Number(m[1]) : NaN
  return d >= 1 && d <= 31 ? d : undefined
}

/** A date at words[i…]: ISO, "dec 24 [2026]", "24 dec [2026]" or a weekday. `next` is the index after it. */
function parseDate(words: string[], i: number, now: number, timeZone?: string): {y: number; mo: number; d: number; next: number; explicitYear?: boolean; weekday?: boolean} | undefined {
  const w = words[i] ?? ""
  const iso = w.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return valid(+iso[1]!, +iso[2]!, +iso[3]!) ? {y: +iso[1]!, mo: +iso[2]!, d: +iso[3]!, next: i + 1, explicitYear: true} : undefined

  const today = todayIn(now, timeZone)
  const year = (word: string | undefined) => (word && /^\d{4}$/.test(word) ? Number(word) : undefined)
  const withYear = (mo: number, d: number, next: number) => {
    const y = year(words[next])
    if (!valid(y ?? today.y, mo, d)) return undefined
    return y ? {y, mo, d, next: next + 1, explicitYear: true} : {y: today.y, mo, d, next}
  }
  const mo1 = monthIndex(w)
  const d1 = dayNumber(words[i + 1])
  if (mo1 && d1) return withYear(mo1, d1, i + 2)
  const d2 = dayNumber(w)
  const mo2 = monthIndex(words[i + 1] ?? "")
  if (d2 && mo2) return withYear(mo2, d2, i + 2)

  const wd = weekdayIndex(w)
  if (wd !== undefined) {
    const diff = (wd - weekdayIn(zonedAt(today.y, today.mo, today.d, 12, 0, timeZone), timeZone) + 7) % 7
    return {y: today.y, mo: today.mo, d: today.d + diff, next: i + 1, weekday: true}
  }
  return undefined
}

const valid = (y: number, mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()

/** "Tue 6 Nov, 18:30" in the given time zone (default: the server's). */
export function formatDateTime(at: number | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(at)
}

/** Wall-clock parts of `t` in `timeZone` (default: the server's). */
function partsIn(t: number, timeZone?: string): {y: number; mo: number; d: number; h: number; mi: number} {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"})
      .formatToParts(t)
      .map((x) => [x.type, x.value])
  )
  return {y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!}
}

/** Today's date in `timeZone`. */
function todayIn(now: number, timeZone?: string): {y: number; mo: number; d: number} {
  return partsIn(now, timeZone)
}

/** Epoch ms of y-mo-d HH:MM wall-clock time in `timeZone` (days may overflow: d + 7 is fine). */
function zonedAt(y: number, mo: number, d: number, h: number, m: number, timeZone?: string): number {
  if (!timeZone) return new Date(y, mo - 1, d, h, m).getTime()
  // find the UTC instant whose wall-clock time in `timeZone` is the target
  const guess = Date.UTC(y, mo - 1, d, h, m)
  const w = partsIn(guess, timeZone)
  return guess - (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - guess)
}

/** How a recurring reminder repeats: a fixed interval, or a wall-clock time daily / on one weekday (0 = Sunday). */
export type Repeat = {ms: number} | {clock: string; weekday?: number}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const MIN_REPEAT_MS = 3_600_000
const CLOCK = /^\d{1,2}(:\d{2})?(am|pm)?$/i

/** "mon" / "monday" → 1 */
function weekdayIndex(word: string): number | undefined {
  const w = word.toLowerCase()
  const i = WEEKDAYS.findIndex((d) => w === d || w === d.slice(0, 3))
  return i < 0 ? undefined : i
}

function weekdayIn(at: number, timeZone?: string): number {
  return WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", {timeZone, weekday: "long"}).format(at).toLowerCase())
}

/** Next occurrence of a clock time (on a weekday, if set) strictly after `after`. */
function nextClock(clock: string, weekday: number | undefined, after: number, timeZone?: string): number | undefined {
  let at = parseWhen(clock, after, timeZone)?.at
  for (let i = 0; at !== undefined && weekday !== undefined && weekdayIn(at, timeZone) !== weekday && i < 7; i++) {
    at = parseWhen(clock, at, timeZone)?.at
  }
  return at
}

/**
 * "every 2h drink water", "every day 9:00 standup", "every monday 18:00 gym" → first due time, rest, repeat.
 * Intervals must be at least an hour. Undefined if `input` isn't a valid "every …".
 */
export function parseRepeat(input: string, now = Date.now(), timeZone?: string): {at: number; rest: string; repeat: Repeat} | undefined {
  const words = input.trim().split(/\s+/)
  if (words[0]?.toLowerCase() !== "every" || words.length < 2) return undefined
  const day = words[1]!.toLowerCase()
  const weekday = weekdayIndex(day)
  if (day === "day" || day === "daily" || weekday !== undefined) {
    const clock = words[2]
    // a bare "9" is not a time (same rule as parseWhen)
    if (!clock || !CLOCK.test(clock) || !/[:apm]/i.test(clock)) return undefined
    const at = nextClock(clock, weekday, now, timeZone)
    if (at === undefined) return undefined
    return {at, rest: words.slice(3).join(" "), repeat: weekday === undefined ? {clock} : {clock, weekday}}
  }
  for (let k = Math.min(words.length, 7); k > 1; k--) {
    const ms = parseDuration(words.slice(1, k).join(" "))
    if (ms) return ms < MIN_REPEAT_MS ? undefined : {at: now + ms, rest: words.slice(k).join(" "), repeat: {ms}}
  }
  return undefined
}

/** When a repeating reminder that was due at `prevAt` runs next (after `now`; missed runs are skipped). */
export function nextRepeat(repeat: Repeat, prevAt: number, now = Date.now(), timeZone?: string): number | undefined {
  if ("ms" in repeat) {
    let at = prevAt + repeat.ms
    if (at <= now) at += Math.ceil((now - at + 1) / repeat.ms) * repeat.ms
    return at
  }
  return nextClock(repeat.clock, repeat.weekday, Math.max(prevAt, now), timeZone)
}

/** "every 2h", "every day at 9:00", "every Monday at 18:00". */
export function describeRepeat(repeat: Repeat): string {
  if ("ms" in repeat) return `every ${duration(repeat.ms)}`
  const day = repeat.weekday === undefined ? "day" : capitalize(WEEKDAYS[repeat.weekday]!)
  return `every ${day} at ${repeat.clock}`
}
