import {chatUtil, defineCommand, fmt, parseWhen} from "../../../src/sdk"
import {MAX_MS, MAX_PER_USER, MIN_MS, snoozable, type ReminderPayload, type SnoozeRecord} from "./remind"

export default defineCommand({
  name: "snooze",
  description: "Snooze a reminder that just went off",
  details:
    "Tap a 💤 button under a reminder, or reply to the reminder with /snooze and when (10m, 1h, tomorrow 9:00; default 10m). " +
    "Reminders can be snoozed for a day after they go off, by the person who set them or the person they're for.",
  category: "Utility",
  menu: false,
  hidden: true, // shown under each reminder
  cooldown: 0,
  args: [{name: "when", type: "text", description: "When: 10m, 1h, tomorrow 9:00 (the buttons add an id first)"}],
  examples: ["snooze 30m", "snooze tomorrow 9:00"],
  run(ctx) {
    const col = snoozable(ctx.rt)
    let input = ctx.args.when?.trim() ?? ""
    const sameChat = (r: SnoozeRecord) => chatUtil.chatKey(r.ref) === chatUtil.chatKey(ctx.ref)

    // "/snooze <id> 10m" from a button, or "/snooze 10m" as a reply to the reminder
    let id: string | undefined
    const first = input.split(/\s+/)[0]?.toLowerCase() ?? ""
    if (first && col.get(first)) {
      id = first
      input = input.slice(first.length).trim()
    } else {
      const quoted = ctx.item.chatItem.quotedItem?.itemId
      if (quoted !== undefined) id = col.entries().find(([, r]) => r.itemId === quoted && sameChat(r))?.[0]
    }
    const rec = id ? col.get(id) : undefined
    if (!id || !rec || !sameChat(rec)) {
      return ctx.fail("No reminder to snooze. Reply to a reminder that went off in the last day, or tap its 💤 button.")
    }
    const target = rec.ref.chatType === "group" && rec.memberId !== undefined && rec.memberId === ctx.sender.member?.groupMemberId
    if (rec.userKey !== ctx.sender.key && !target) return ctx.fail("Only the person who set this reminder, or who it's for, can snooze it.")

    const parsed = parseWhen(`${input || "10m"} .`, Date.now(), rec.timeZone)
    if (!parsed || parsed.rest.trim() !== ".") return ctx.usageError("Say when: 10m, 1h, 18:30, tomorrow 9:00 …")
    const ms = parsed.at - Date.now()
    if (ms < MIN_MS) return ctx.fail("That's too soon — at least 10 seconds, please.")
    if (ms > MAX_MS) return ctx.fail("That's too far away — a year at most.")
    const theirs = ctx.rt.scheduler.list<ReminderPayload>((j) => j.kind === "reminder" && j.payload.userKey === rec.userKey)
    if (theirs.length >= MAX_PER_USER) return ctx.fail(`There are already ${MAX_PER_USER} reminders set by ${rec.by ?? rec.name} here.`)

    const {itemId, at: _at, ...rest} = rec
    const job = ctx.rt.scheduler.schedule<ReminderPayload>("reminder", parsed.at, {...rest, quote: itemId, tappable: ctx.ui.tappable, prefix: ctx.config.prefix})
    col.delete(id)
    const cancel = rec.userKey === ctx.sender.key ? ctx.ui.button("✖ Cancel", "unremind", job.id, {important: true}) : undefined
    const forSender = ctx.isDirect || rec.memberId === ctx.sender.member?.groupMemberId
    return fmt.lines(`💤 Snoozed — I'll remind ${forSender ? "you" : fmt.bold(rec.name)} again ${fmt.bold(fmt.relative(parsed.at))}.`, cancel)
  },
})
