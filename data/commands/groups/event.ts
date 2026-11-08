import {defineCommand, defineInteraction, defineJob, fmt, makeUi, normalizeReaction, newId, parseWhen, type GroupEvent, type Interaction, type T} from "../../../src/sdk"

interface EventState {
  event: GroupEvent
  prefix: string
  tappable: boolean
}

const EMOJI = {yes: "👍", maybe: "😀", no: "👎"} as const

function render(ix: Interaction<EventState>): string {
  const e = ix.state.event
  const rows = (["yes", "maybe", "no"] as const).map((status) => {
    const names = Object.values(e.roster).filter((r) => r.status === status).map((r) => r.name)
    return `${EMOJI[status]} ${fmt.bold(status)}: ${names.length ? names.join(", ") : fmt.italic("none")}`
  })
  const ui = makeUi(ix.state.tappable, ix.state.prefix)
  const date = new Intl.DateTimeFormat("en-GB", {timeZone: e.timeZone, dateStyle: "full", timeStyle: "short"}).format(e.at)
  return fmt.lines(
    `${e.canceled ? "✖" : "📅"} ${fmt.bold(e.title)}`,
    `${date} ${fmt.italic(`(${e.timeZone})`)}`,
    "",
    ...rows,
    "",
    e.canceled ? fmt.italic("Event cancelled.") : fmt.italic("RSVP with a reaction or a button; you can change your answer."),
    !e.canceled && ix.state.tappable ? ui.buttons(((["yes", "maybe", "no"] as const).map((s) => ui.button(EMOJI[s], "vote", `${ix.id} ${s}`)))) : undefined,
    !e.canceled && ix.state.tappable ? ui.button("✖ Cancel event", "cancel", ix.id, {important: true}) : undefined
  )
}

function setRsvp(ix: Interaction<EventState>, key: string, name: string, status: "yes" | "maybe" | "no"): string {
  if (ix.state.event.canceled) return render(ix)
  ix.state.event.roster[key] = {name, status}
  return render(ix)
}

defineInteraction<EventState>("event", {
  onReaction(ix, r) {
    const emoji = normalizeReaction(r.emoji)
    const status = emoji === EMOJI.yes ? "yes" : emoji === EMOJI.maybe ? "maybe" : emoji === EMOJI.no ? "no" : undefined
    if (!status) return
    if (!r.added) {
      if (ix.state.event.roster[r.userKey]?.status === status) delete ix.state.event.roster[r.userKey]
      return render(ix)
    }
    return setRsvp(ix, r.userKey, r.displayName, status)
  },
  onButton(ix, args, ctx) {
    const status = args[0]?.toLowerCase()
    if (status !== "yes" && status !== "maybe" && status !== "no") return {reply: "Choose yes, maybe or no."}
    return {text: setRsvp(ix, ctx.sender.key, ctx.sender.displayName, status), ack: "👍"}
  },
  async onCancel(ix, ctx) {
    ix.state.event.canceled = true
    await ctx.groupData.update((s) => {
      const event = s.events?.find((e) => e.id === ix.state.event.id)
      if (event) event.canceled = true
    })
    ctx.rt.store.collection<GroupEvent>("events").update(`${ctx.group!.groupId}:${ix.state.event.id}`, (event) => event ? {...event, canceled: true} : event)
    return {text: render(ix), done: true, reply: "✅ Event cancelled."}
  },
})

defineJob<{ref: T.ChatRef; eventKey: string}>("event-reminder", async (job, rt) => {
  const event = rt.store.collection<GroupEvent>("events").get(job.payload.eventKey)
  if (!event || event.canceled) return
  await rt.messenger.send(job.payload.ref, `🔔 ${fmt.bold(event.title)} is starting now.`).catch(() => undefined)
  rt.store.collection<GroupEvent>("events").delete(job.payload.eventKey)
})

export default defineCommand({
  name: "event",
  description: "Create and RSVP to a group event",
  details: "Create one-off events with a timezone and visible yes/maybe/no RSVPs.",
  category: "Groups",
  scope: "group",
  args: [{name: "action", type: "string", description: "new, list, rsvp or cancel"}, {name: "value", type: "text", description: "Event details or id/status"}],
  examples: ["event new tomorrow 18:30 | Europe/London | Book club", "event list", "event rsvp abc123 yes"],
  async run(ctx) {
    const action = (ctx.args.action ?? "list").toLowerCase()
    const value = ctx.args.value?.trim() ?? ""
    const settings = await ctx.groupData.get()
    const events = [...(settings.events ?? [])]
    if (action === "list") {
      const active = events.filter((e) => !e.canceled && e.at > Date.now()).sort((a, b) => a.at - b.at)
      return active.length ? fmt.lines("📅 Upcoming events", ...active.map((e) => `${fmt.code(e.id)} · ${e.title} · ${new Date(e.at).toISOString()}`)) : "📅 No upcoming events."
    }
    if (action === "new") {
      const parts = value.split("|").map((s) => s.trim())
      if (parts.length !== 3) return ctx.usageError("Use /event new <when> | <IANA timezone> | <title>.")
      const [when, timeZone, title] = parts
      const parsed = parseWhen(when!, Date.now(), timeZone!)
      if (!parsed || !title) return ctx.usageError("I couldn't parse that event time or title.")
      const event: GroupEvent = {id: newId(), title: title!.slice(0, 200), at: parsed.at, timeZone: timeZone!, creatorKey: ctx.sender.key, creatorName: ctx.sender.displayName, roster: {}}
      const msg = await ctx.send(`📅 ${fmt.bold(event.title)}`)
      const ix = ctx.rt.interactions.create("event", msg, {event, prefix: ctx.config.prefix, tappable: ctx.ui.tappable}, {ownerKey: ctx.sender.key, ttlMs: 30 * 86_400_000})
      event.id = ix.id
      await ctx.groupData.update((s) => {
        s.events = [...(s.events ?? []), event].slice(-100)
      })
      await msg.edit(render(ix))
      // The job payload uses a chat-local event key; retain the event itself for restart-safe delivery.
      const eventKey = `${ctx.group!.groupId}:${event.id}`
      ctx.rt.store.collection<GroupEvent>("events").set(eventKey, event)
      ctx.rt.scheduler.schedule("event-reminder", event.at, {ref: ctx.ref, eventKey})
      return
    }
    if (action === "rsvp") {
      const [id, status] = value.split(/\s+/)
      if (!id || !["yes", "maybe", "no"].includes(status ?? "")) return ctx.usageError("Use /event rsvp <id> yes|maybe|no.")
      const ix = ctx.rt.interactions.get<EventState>(id.toLowerCase())
      if (!ix || ix.kind !== "event") return ctx.fail("No open event with that id.")
      return (await ctx.rt.interactions.button(id.toLowerCase(), [status!], ctx)) ?? undefined
    }
    if (action === "cancel") {
      if (!value) return ctx.usageError("Use /event cancel <id>.")
      await ctx.rt.interactions.cancel(value.toLowerCase(), ctx)
      await ctx.groupData.update((s) => {
        const event = s.events?.find((e) => e.id === value.toLowerCase())
        if (event) event.canceled = true
      })
      ctx.rt.store.collection<GroupEvent>("events").update(`${ctx.group!.groupId}:${value.toLowerCase()}`, (event) => event ? {...event, canceled: true} : event)
      return "✅ Event cancelled."
    }
    return ctx.usageError("Use /event new, list, rsvp or cancel.")
  },
})
