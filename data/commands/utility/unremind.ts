import {defineCommand, fmt} from "../../../src/sdk"
import type {ReminderPayload} from "./remind"

export default defineCommand({
  name: "unremind",
  description: "Cancel a reminder",
  category: "Utility",
  menu: false,
  hidden: true, // shown next to each reminder
  cooldown: 0,
  args: [{name: "id", type: "string", description: "Reminder id (see /reminders)", required: true}],
  run(ctx) {
    const job = ctx.rt.scheduler.get(ctx.args.id.toLowerCase())
    const payload = job?.payload as ReminderPayload | undefined
    if (!job || job.kind !== "reminder" || payload?.userKey !== ctx.sender.key) return ctx.fail("No reminder of yours with that id.")
    ctx.rt.scheduler.cancel(job.id)
    return `🗑 Cancelled: ${fmt.italic(payload.text || "(no text)")}`
  },
})
