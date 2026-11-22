import {defineCommand, defineInteraction, defineJob, describeError, fmt, formatDateTime, makeUi, normalizeReaction, parseDuration, type Interaction, type T} from "../../../src/sdk"

/** Reactions SimpleX allows, in the order options get them. */
const EMOJI = ["👍", "❤", "🚀", "😀", "😂", "✅", "😢", "👎"] as const
const YES_NO = ["👍", "👎"] as const
/** SimpleX lets one participant (Rubi included) add at most 3 reactions to a message. */
const MAX_SEED = 3
const MIN_DURATION = 60_000
const MAX_DURATION = 30 * 86_400_000

export interface PollState {
  question: string
  options: string[]
  emoji: string[]
  /** userKey → option index (single-choice polls) */
  votes: Record<string, number>
  /** Several picks per person allowed; their choices are in `picks`. */
  multi?: boolean
  /** userKey → option indexes (multi-choice polls) */
  picks?: Record<string, number[]>
  /** Closes by itself at this time (epoch ms; the "poll-close" job). */
  closesAt?: number
  /** Time zone for showing the closing time (the creator's /time zone in DMs). */
  timeZone?: string
  closed?: boolean
  ownerName: string
  prefix: string
  /** Commands are tappable in this chat (DMs, or groups with /groupmenu). */
  tappable: boolean
  /** Rubi couldn't add reactions — reactions are probably turned off in this chat. */
  reactionsOff?: boolean
}

/** Votes per option, and how many people voted. */
function tally(s: PollState): {counts: number[]; voters: number} {
  if (s.multi) {
    const lists = Object.values(s.picks ?? {}).filter((l) => l.length)
    return {counts: s.options.map((_, i) => lists.filter((l) => l.includes(i)).length), voters: lists.length}
  }
  const counts = s.options.map((_, i) => Object.values(s.votes).filter((v) => v === i).length)
  return {counts, voters: counts.reduce((a, b) => a + b, 0)}
}

/** Toggle one pick of a multi-choice poll (`on` forces it). Returns false if nothing changed. */
function togglePick(s: PollState, key: string, i: number, on?: boolean): boolean {
  const picks = (s.picks ??= {})
  const cur = picks[key] ?? []
  const has = cur.includes(i)
  const want = on ?? !has
  if (want === has) return false
  const next = want ? [...cur, i].sort((a, b) => a - b) : cur.filter((x) => x !== i)
  if (next.length) picks[key] = next
  else delete picks[key]
  return true
}

export function renderPoll(ix: Interaction<PollState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const {counts, voters} = tally(s)
  const top = Math.max(...counts)
  const rows = s.options.map((opt, i) => {
    const n = counts[i]!
    const pct = voters ? Math.round((n / voters) * 100) : 0
    const win = s.closed && n === top && n > 0 ? " 🏆" : ""
    // vote buttons only where they can be tapped; elsewhere people react
    const btn = s.closed || !s.tappable ? "" : `  ${ui.button("", "vote", `${ix.id} ${i + 1}`)}`
    return `${s.emoji[i]} ${fmt.bold(opt)}${win}\n${fmt.bar(voters ? n / voters : 0)} ${n} (${pct}%)${btn}`
  })
  const how = s.reactionsOff
    ? s.tappable
      ? "tap a button to vote"
      : `vote with ${ui.cmd("vote", `${ix.id} <number>`)}`
    : s.tappable
      ? "react with an emoji or tap a button"
      : "react with an option's emoji to vote"
  const count = fmt.plural(voters, s.multi ? "voter" : "vote")
  const pick = s.multi ? " · pick as many as you like" : ""
  return fmt.lines(
    `📊 ${fmt.bold(s.question)}`,
    "",
    rows.join("\n\n"),
    "",
    s.closed ? fmt.italic(`Poll closed · ${count}`) : fmt.italic(`${count} · ${how}${pick} · by ${s.ownerName}`),
    !s.closed && s.closesAt ? `⏳ Closes ${formatDateTime(s.closesAt, s.timeZone)}` : undefined,
    s.closed ? undefined : `Close: ${ui.button("", "endpoll", ix.id, {important: true})}`
  )
}

/** Closes a timed poll (/poll 2h …). */
defineJob<{id: string; ref: T.ChatRef}>("poll-close", async (job, rt) => {
  await rt.interactions.mutate<PollState, void>(job.payload.id, async (ix) => {
    if (ix.state.closed) return
    ix.state.closed = true
    try {
      await rt.messenger.update(ix.ref, ix.itemId, renderPoll(ix))
    } catch (e) {
      rt.log.debug(`could not close poll ${ix.id}: ${describeError(e)}`)
    }
    rt.interactions.end(ix.id)
  })
})

defineInteraction<PollState>("poll", {
  onReaction(ix, r) {
    if (ix.state.closed) return
    const i = ix.state.emoji.indexOf(normalizeReaction(r.emoji))
    if (i < 0) return
    if (ix.state.multi) {
      if (!togglePick(ix.state, r.userKey, i, r.added)) return
    } else if (r.added) ix.state.votes[r.userKey] = i
    else if (ix.state.votes[r.userKey] === i) delete ix.state.votes[r.userKey]
    else return
    return renderPoll(ix)
  },
  onButton(ix, args, ctx) {
    if (ix.state.closed) return {reply: "This poll is closed."}
    const n = Number(args[0])
    if (!Number.isInteger(n) || n < 1 || n > ix.state.options.length) return {reply: `Pick 1–${ix.state.options.length}.`}
    const key = ctx.sender.key
    if (ix.state.multi) togglePick(ix.state, key, n - 1)
    // tapping your current choice again removes your vote
    else if (ix.state.votes[key] === n - 1) delete ix.state.votes[key]
    else ix.state.votes[key] = n - 1
    return {text: renderPoll(ix), ack: "👍"}
  },
  onExpire(ix) {
    ix.state.closed = true
    return renderPoll(ix)
  },
})

/** Leading "multi" and/or a duration ("2h") before the question, in any order. */
export function parsePollOptions(input: string): {text: string; multi: boolean; durationMs?: number} {
  let text = input.trim()
  let multi = false
  let durationMs: number | undefined
  for (let i = 0; i < 2; i++) {
    const m = text.match(/^(\S+)\s+([\s\S]+)$/)
    if (!m) break
    const word = m[1]!
    if (!multi && /^multi$/i.test(word)) multi = true
    else if (durationMs === undefined && /^\d/.test(word) && parseDuration(word) !== undefined) durationMs = parseDuration(word)
    else break
    text = m[2]!.trim()
  }
  return {text, multi, durationMs}
}

export default defineCommand({
  name: "poll",
  description: "Start a poll: /poll Pizza tonight? | yes | no | maybe",
  details:
    "Separate the question and options with |. With no options it's a 👍/👎 poll. Up to 8 options. " +
    "Vote by reacting with an option's emoji (I add the reactions myself for polls with up to 3 options — they don't count as votes), " +
    "or tap its vote button in DMs. One vote per person; only its creator can close it with /endpoll. " +
    "Start with multi to let people pick several options (SimpleX allows 3 reactions per person, so more picks need the buttons), " +
    "and/or a duration (1m to 30d) to close it automatically: /poll multi 2h Lunch? | pizza | sushi | tacos.",
  category: "Utility",
  args: [{name: "poll", type: "text", description: "[multi] [duration] Question | option | option", required: true}],
  examples: ["poll Movie night? | Friday | Saturday | Sunday", "poll Should we start a book club?", "poll 1h Pizza tonight? | yes | no", "poll multi Which days work? | Mon | Tue | Wed | Thu"],
  cooldown: 15,
  async run(ctx) {
    const {text, multi, durationMs} = parsePollOptions(ctx.args.poll)
    if (durationMs !== undefined && (durationMs < MIN_DURATION || durationMs > MAX_DURATION)) return ctx.usageError("A poll can run from 1 minute to 30 days.")
    const parts = text.split("|").map((s) => s.trim()).filter(Boolean)
    const [question, ...options] = parts
    if (!question) return ctx.usageError("Give a question first.")
    if (options.length === 1) return ctx.usageError("A poll needs at least 2 options (or none for 👍/👎).")
    if (options.length > EMOJI.length) return ctx.usageError(`At most ${EMOJI.length} options — SimpleX only allows ${EMOJI.length} reaction emoji.`)
    const yesNo = options.length === 0
    if (multi && yesNo) return ctx.usageError("A multi-choice poll needs options: /poll multi Question | a | b | c")
    const state: PollState = {
      question: fmt.truncate(question, 200),
      options: yesNo ? ["Yes", "No"] : options.map((o) => fmt.truncate(o, 80)),
      emoji: [...(yesNo ? YES_NO : EMOJI)].slice(0, yesNo ? 2 : options.length),
      votes: {},
      ownerName: ctx.sender.displayName,
      prefix: ctx.config.prefix,
      tappable: ctx.ui.tappable,
    }
    if (multi) {
      state.multi = true
      state.picks = {}
    }
    if (durationMs !== undefined) {
      state.closesAt = Date.now() + durationMs
      if (ctx.isDirect) state.timeZone = (await ctx.contactData.get()).timezone
    }
    // send first: the buttons need the interaction id, which needs the message
    const msg = await ctx.send(`📊 ${fmt.bold(state.question)}`)
    const ttlMs = durationMs !== undefined ? durationMs + 10 * 60_000 : 30 * 86_400_000
    const ix = ctx.rt.interactions.create("poll", msg, state, {ownerKey: ctx.sender.key, ttlMs})
    if (state.closesAt !== undefined) ctx.rt.scheduler.schedule("poll-close", state.closesAt, {id: ix.id, ref: ctx.ref})

    // pre-add the option reactions so people can just tap them (Rubi's own reactions are never counted)
    if (state.emoji.length <= MAX_SEED) {
      for (const e of state.emoji) {
        try {
          await msg.react(e)
        } catch (err) {
          ctx.log.debug(`poll: can't add reaction ${e}: ${describeError(err)}`)
          state.reactionsOff = true
          break
        }
      }
    }
    await msg.edit(renderPoll(ix))
    ctx.rt.interactions.save(ix)
  },
})
