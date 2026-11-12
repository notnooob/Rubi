import {defineCommand, defineJob, describeRepeat, fmt, formatDateTime, nextRepeat, parseRepeat, parseWhen, utcOffset, type Repeat, type T} from "../../../src/sdk"

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
}

const MIN_MS = 10_000
const MAX_MS = 366 * 86_400_000
const MAX_PER_USER = 25

defineJob<ReminderPayload>("reminder", async (job, rt) => {
  const r = job.payload
  const inGroup = r.ref.chatType === "group" && r.memberId !== undefined
  const who = inGroup ? fmt.mention(r.name) : ""
  const text = fmt.lines(`⏰ ${who ? `${who}, r` : "R"}eminder:`, r.text || fmt.italic("(no text)"))
  const opts = {quote: r.quote, mentions: inGroup ? {[r.name]: r.memberId!} : undefined}
  try {
    await rt.messenger.send(r.ref, text, opts)
  } catch {
    // the quoted message may be gone — send without the quote
    await rt.messenger.send(r.ref, text, {...opts, quote: undefined})
  }
  return r.repeat ? nextRepeat(r.repeat, job.at, Date.now(), r.timeZone) : undefined
})

export default defineCommand({
  name: "remind",
  aliases: ["remindme", "reminder"],
  description: "Set a reminder: /remind 10m stretch",
  details:
    "When: a duration (30s, 10m, 1h30m, 2d, 1w) or a clock time (18:30, 6pm, tomorrow 9:00). " +
    "Clock times use your time zone from /time set (DMs), otherwise the server's. " +
    "Repeat with every: every 2h (an hour at least), every day 9:00, every monday 18:00. Reminders survive restarts.",
  category: "Utility",
  args: [{name: "what", type: "text", description: "When, then what to remind you about", required: true}],
  examples: ["remind 10m stretch", "remind 1h30m check the oven", "remind tomorrow 9:00 call mom", "remind every day 9:00 standup"],
  async run(ctx) {
    const timeZone = ctx.isDirect ? (await ctx.contactData.get()).timezone : undefined
    const recurring = /^every\s/i.test(ctx.args.what)
    const parsed: {at: number; rest: string; repeat?: Repeat} | undefined = recurring
      ? parseRepeat(ctx.args.what, Date.now(), timeZone)
      : parseWhen(ctx.args.what, Date.now(), timeZone)
    if (!parsed) {
      return recurring
        ? ctx.usageError("Repeat with every 2h (an hour at least), every day 9:00 or every monday 18:00 …")
        : ctx.usageError("Start with when: 10m, 2h, 1h30m, 18:30, tomorrow 9:00 …")
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
      name: ctx.sender.displayName,
      memberId: ctx.sender.member?.groupMemberId,
      timeZone,
      repeat,
    })
    return fmt.lines(
      `⏰ Got it — I'll remind you ${fmt.bold(fmt.relative(parsed.at))}.`,
      fmt.italic(`${formatDateTime(parsed.at, timeZone)} (${utcOffset(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, parsed.at)})`),
      repeat && `🔁 ${describeRepeat(repeat)}`,
      "",
      ctx.ui.buttons([ctx.ui.button("✖ Cancel", "unremind", job.id, {important: true}), ctx.ui.button("📋", "reminders")])
    )
  },
})
