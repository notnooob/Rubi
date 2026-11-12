import {defineCommand, describeRepeat, fmt, formatDateTime} from "../../../src/sdk"
import type {ReminderPayload} from "./remind"

export default defineCommand({
  name: "reminders",
  description: "List your reminders in this chat",
  category: "Utility",
  async run(ctx) {
    const mine = ctx.rt.scheduler.list<ReminderPayload>(
      (j) => j.kind === "reminder" && j.payload.userKey === ctx.sender.key
    )
    if (!mine.length) return `📭 You have no reminders here. Set one: ${ctx.ui.cmd("remind", "10m stretch")}`
    await ctx.paginate({
      title: `⏰ ${fmt.bold("Your reminders")} (${mine.length})`,
      items: mine.map(
        (j) =>
          `• ${fmt.bold(fmt.relative(j.at))} ${fmt.italic(formatDateTime(j.at, j.payload.timeZone))}${j.payload.repeat ? ` 🔁 ${describeRepeat(j.payload.repeat)}` : ""}\n` +
          `  ${fmt.truncate(j.payload.text || "(no text)", 80)}  ${ctx.ui.button("✖", "unremind", j.id, {important: true})}`
      ),
      perPage: 8,
    })
  },
})
