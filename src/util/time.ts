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
 * Clock times ("18:30", "tomorrow 9:00") use `timeZone` (IANA; default: the server's).
 */
export function parseWhen(input: string, now = Date.now(), timeZone?: string): {at: number; rest: string} | undefined {
  const words = input.trim().split(/\s+/)
  let i = 0
  if (words[0]?.toLowerCase() === "in") i = 1

  // clock time: [today|tomorrow] HH:MM[am|pm]
  let dayOffset = 0
  let j = i
  if (/^(today|tomorrow)$/i.test(words[j] ?? "")) {
    dayOffset = words[j]!.toLowerCase() === "tomorrow" ? 1 : 0
    j++
  }
  // "18:30", "6:30pm", "6pm" (a bare "6" is not a time)
  const clock = (words[j] ?? "").match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i)
  if (clock && (clock[2] !== undefined || clock[3] !== undefined)) {
    let h = Number(clock[1])
    const min = Number(clock[2] ?? 0)
    const ampm = clock[3]?.toLowerCase()
    if (ampm && (h < 1 || h > 12)) return undefined
    if (ampm === "pm" && h < 12) h += 12
    if (ampm === "am" && h === 12) h = 0
    if (h > 23 || min > 59) return undefined
    let at = zonedTime(now, h, min, dayOffset, timeZone)
    if (at <= now && dayOffset === 0) at = zonedTime(now, h, min, 1, timeZone)
    return {at, rest: words.slice(j + 1).join(" ")}
  }

  // duration: take the longest prefix of words that parses ("1h 30m", "2 hours")
  for (let k = Math.min(words.length, i + 6); k > i; k--) {
    const ms = parseDuration(words.slice(i, k).join(" "))
    if (ms) return {at: now + ms, rest: words.slice(k).join(" ")}
  }
  return undefined
}

/** "Tue 6 Nov, 18:30" in the given time zone (default: the server's). */
export function formatDateTime(at: number | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(at)
}

/** Epoch ms of HH:MM on (today + dayOffset) in `timeZone`. */
function zonedTime(now: number, h: number, m: number, dayOffset: number, timeZone?: string): number {
  if (!timeZone) {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }
  // find the UTC instant whose wall-clock time in `timeZone` is the target
  const parts = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"})
        .formatToParts(t)
        .map((x) => [x.type, x.value])
    )
    return {y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!}
  }
  const today = parts(now)
  const guess = Date.UTC(today.y, today.mo - 1, today.d + dayOffset, h, m)
  const offset = (() => {
    const w = parts(guess)
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - guess
  })()
  return guess - offset
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
