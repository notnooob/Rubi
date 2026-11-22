import {defineCommand, defineJob, describeRepeat, fmt, formatDateTime, makeUi, newId, nextRepeat, parseRepeat, parseWhen, utcOffset, type Repeat, type Runtime, type T} from "../../../src/sdk"

export interface ReminderPayload {
  ref: T.ChatRef
  /** Item id of the /remind message (quoted when the reminder fires). */
  quote: number
  text: string
  userKey: string
  name: string
  /** For a real @mention in groups. */
  memberId?: number
  timeZone?: string
  /** Recurring reminders ("every day 9:00 …") run again at the next occurrence. */
  repeat?: Repeat
  /** Set by someone else for `name` (groups): their name and groupMemberId. */
  by?: string
  byMemberId?: number
  /** Commands were tappable in the chat when it was set (for the 💤 snooze buttons; older reminders have none). */
  tappable?: boolean
  prefix?: string
}

/** A reminder that just went off and can still be snoozed (/snooze), kept in the "snooze" store collection. */
export interface SnoozeRecord extends Omit<ReminderPayload, "quote" | "repeat"> {
  /** The "⏰ Reminder" message. */
  itemId: number
  /** When it went off. */
  at: number
}

export const MIN_MS = 10_000
export const MAX_MS = 366 * 86_400_000
export const MAX_PER_USER = 25
/** How long a reminder that went off can be snoozed. */
export const SNOOZE_KEEP_MS = 86_400_000
const SNOOZE_CHOICES = [
  ["10m", "10m"],
  ["1h", "1h"],
  ["tomorrow", "tomorrow 9:00"],
] as const

/** The snoozable reminders, without the ones older than a day. */
export function snoozable(rt: Runtime) {
  const col = rt.store.collection<SnoozeRecord>("snooze")
  const old = Date.now() - SNOOZE_KEEP_MS
  for (const [k, r] of col.entries()) if (r.at < old) col.delete(k)
  return col
}

defineJob<ReminderPayload>("reminder", async (job, rt) => {
  const r = job.payload
  const inGroup = r.ref.chatType === "group" && r.memberId !== undefined
  const who = inGroup ? fmt.mention(r.name) : ""
  const from = r.by ? ` from ${fmt.bold(r.by)}` : ""
  const text = fmt.lines(`⏰ ${who ? `${who}, r` : "R"}eminder${from}:`, r.text || fmt.italic("(no text)"))
  const opts = {quote: r.quote, mentions: inGroup ? {[r.name]: r.memberId!} : undefined}
  if (r.repeat) {
    await rt.messenger.send(r.ref, text, opts)
    return nextRepeat(r.repeat, job.at, Date.now(), r.timeZone)
  }
  // one-off reminders can be snoozed for a day: 💤 buttons where commands are tappable, or /snooze as a reply
  const id = newId()
  const ui = r.tappable !== undefined ? makeUi(r.tappable, r.prefix) : undefined
  const buttons = ui?.buttons(SNOOZE_CHOICES.map(([label, when]) => ui.button(`💤 ${label}`, "snooze", `${id} ${when}`)))
  const msg = await rt.messenger.send(r.ref, fmt.lines(text, buttons ? `
${buttons}` : undefined), opts)
  const {quote: _quote, repeat: _repeat, ...rest} = r
  snoozable(rt).set(id, {...rest, itemId: msg.itemId, at: Date.now()})
  return undefined
})

export default defineCommand({
  name: "remind",
  aliases: ["remindme", "reminder"],
  description: "Set a reminder: /remind 10m stretch",
  details:
    "When: a duration (30s, 10m, 1h30m, 2d, 1w), a clock time (18:30, 6pm, tomorrow 9:00) or a date " +
    "(dec 24 18:00, 24 december, 2026-12-24 8am, friday 9:00; without a time it's 9:00). " +
    "Clock times use your time zone from /time set (DMs), otherwise the server's. " +
    "Repeat with every: every 2h (an hour at least), every day 9:00, every monday 18:00. " +
    "In groups, start with @member to remind someone else (only you can cancel it). Reminders survive restarts. " +
    "When a one-off reminder goes off, tap 💤 or reply to it with /snooze 30m to get it again later (for a day).",
  category: "Utility",
  args: [{name: "what", type: "text", description: "When, then what to remind you about", required: true}],
  examples: ["remind 10m stretch", "remind 1h30m check the oven", "remind tomorrow 9:00 call mom", "remind dec 24 18:00 wrap presents", "remind every day 9:00 standup", "remind @bob 1h check the PR"],
  async run(ctx) {
    const timeZone = ctx.isDirect ? (await ctx.contactData.get()).timezone : undefined
    // "@bob 10m …" / "@'Jo Do' 10m …": remind another group member
    let what = ctx.args.what
    let target: T.GroupMember | undefined
    const forMember = ctx.isGroup ? what.match(/^@('[^']+'|\S+)\s+([\s\S]+)$/) : null
    if (forMember) {
      target = await ctx.resolveMember(forMember[1]!.replace(/^'(.*)'$/, "$1"))
      what = forMember[2]!
      if (target.groupMemberId === ctx.group!.membership.groupMemberId) return ctx.fail("I don't need reminders. 🙂")
      if (target.groupMemberId === ctx.sender.member?.groupMemberId) target = undefined
    }
    const recurring = /^every\s/i.test(what)
    const parsed: {at: number; rest: string; repeat?: Repeat} | undefined = recurring
      ? parseRepeat(what, Date.now(), timeZone)
      : parseWhen(what, Date.now(), timeZone)
    if (!parsed) {
      return recurring
        ? ctx.usageError("Repeat with every 2h (an hour at least), every day 9:00 or every monday 18:00 …")
        : ctx.usageError("Start with when: 10m, 2h, 18:30, tomorrow 9:00, dec 24 18:00, friday 9:00 …")
    }
    const {repeat} = parsed
    const ms = parsed.at - Date.now()
    if (ms < MIN_MS) return ctx.fail("That's too soon — at least 10 seconds, please.")
    if (ms > MAX_MS) return ctx.fail("That's too far away — a year at most.")

    const mine = ctx.rt.scheduler.list<ReminderPayload>((j) => j.kind === "reminder" && j.payload.userKey === ctx.sender.key)
    if (mine.length >= MAX_PER_USER) return ctx.fail(`You already have ${MAX_PER_USER} reminders here. Cancel some with ${ctx.ui.cmd("reminders")}.`)

    const job = ctx.rt.scheduler.schedule<ReminderPayload>("reminder", parsed.at, {
      ref: ctx.ref,
      quote: ctx.itemId,
      text: parsed.rest,
      userKey: ctx.sender.key,
      name: target?.memberProfile.displayName ?? ctx.sender.displayName,
      memberId: target?.groupMemberId ?? ctx.sender.member?.groupMemberId,
      by: target && ctx.sender.displayName,
      byMemberId: target && ctx.sender.member?.groupMemberId,
      timeZone,
      repeat,
      tappable: ctx.ui.tappable,
      prefix: ctx.config.prefix,
    })
    return fmt.lines(
      `⏰ Got it — I'll remind ${target ? ctx.mention(target) : "you"} ${fmt.bold(fmt.relative(parsed.at))}.`,
      fmt.italic(`${formatDateTime(parsed.at, timeZone)} (${utcOffset(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, parsed.at)})`),
      repeat && `🔁 ${describeRepeat(repeat)}`,
      "",
      ctx.ui.buttons([ctx.ui.button("✖ Cancel", "unremind", job.id, {important: true}), ctx.ui.button("📋", "reminders")])
    )
  },
})
