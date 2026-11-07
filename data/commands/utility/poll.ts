import {defineCommand, defineInteraction, describeError, fmt, makeUi, normalizeReaction, type Interaction} from "../../../src/sdk"

/** Reactions SimpleX allows, in the order options get them. */
const EMOJI = ["👍", "❤", "🚀", "😀", "😂", "✅", "😢", "👎"] as const
const YES_NO = ["👍", "👎"] as const
/** SimpleX lets one participant (Rubi included) add at most 3 reactions to a message. */
const MAX_SEED = 3

export interface PollState {
  question: string
  options: string[]
  emoji: string[]
  /** userKey → option index */
  votes: Record<string, number>
  closed?: boolean
  ownerName: string
  prefix: string
  /** Commands are tappable in this chat (DMs, or groups with /groupmenu). */
  tappable: boolean
  /** Rubi couldn't add reactions — reactions are probably turned off in this chat. */
  reactionsOff?: boolean
}

export function renderPoll(ix: Interaction<PollState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const counts = s.options.map((_, i) => Object.values(s.votes).filter((v) => v === i).length)
  const total = counts.reduce((a, b) => a + b, 0)
  const top = Math.max(...counts)
  const rows = s.options.map((opt, i) => {
    const n = counts[i]!
    const pct = total ? Math.round((n / total) * 100) : 0
    const win = s.closed && n === top && n > 0 ? " 🏆" : ""
    // vote buttons only where they can be tapped; elsewhere people react
    const btn = s.closed || !s.tappable ? "" : `  ${ui.button("", "vote", `${ix.id} ${i + 1}`)}`
    return `${s.emoji[i]} ${fmt.bold(opt)}${win}\n${fmt.bar(total ? n / total : 0)} ${n} (${pct}%)${btn}`
  })
  const how = s.reactionsOff
    ? s.tappable
      ? "tap a button to vote"
      : `vote with ${ui.cmd("vote", `${ix.id} <number>`)}`
    : s.tappable
      ? "react with an emoji or tap a button"
      : "react with an option's emoji to vote"
  return fmt.lines(
    `📊 ${fmt.bold(s.question)}`,
    "",
    rows.join("\n\n"),
    "",
    s.closed ? fmt.italic(`Poll closed · ${fmt.plural(total, "vote")}`) : fmt.italic(`${fmt.plural(total, "vote")} · ${how} · by ${s.ownerName}`),
    s.closed ? undefined : `Close: ${ui.button("", "endpoll", ix.id, {important: true})}`
  )
}

defineInteraction<PollState>("poll", {
  onReaction(ix, r) {
    if (ix.state.closed) return
    const i = ix.state.emoji.indexOf(normalizeReaction(r.emoji))
    if (i < 0) return
    if (r.added) ix.state.votes[r.userKey] = i
    else if (ix.state.votes[r.userKey] === i) delete ix.state.votes[r.userKey]
    else return
    return renderPoll(ix)
  },
  onButton(ix, args, ctx) {
    if (ix.state.closed) return {reply: "This poll is closed."}
    const n = Number(args[0]?.replace(/,/g, ""))
    if (!Number.isInteger(n) || n < 1 || n > ix.state.options.length) return {reply: `Pick 1–${ix.state.options.length}.`}
    const key = ctx.sender.key
    // tapping your current choice again removes your vote
    if (ix.state.votes[key] === n - 1) delete ix.state.votes[key]
    else ix.state.votes[key] = n - 1
    return {text: renderPoll(ix), ack: "👍"}
  },
})

export default defineCommand({
  name: "poll",
  description: "Start a poll: /poll Pizza tonight? | yes | no | maybe",
  details:
    "Separate the question and options with |. With no options it's a 👍/👎 poll. Up to 8 options. " +
    "Vote by reacting with an option's emoji (I add the reactions myself for polls with up to 3 options — they don't count as votes), " +
    "or tap its vote button in DMs. One vote per person; only its creator can close it with /endpoll.",
  category: "Utility",
  args: [{name: "poll", type: "text", description: "Question | option | option", required: true}],
  examples: ["poll Movie night? | Friday | Saturday | Sunday", "poll Should we start a book club?"],
  cooldown: 15,
  async run(ctx) {
    const parts = ctx.args.poll.split("|").map((s) => s.trim()).filter(Boolean)
    const [question, ...options] = parts
    if (!question) return ctx.usageError("Give a question first.")
    if (options.length === 1) return ctx.usageError("A poll needs at least 2 options (or none for 👍/👎).")
    if (options.length > EMOJI.length) return ctx.usageError(`At most ${EMOJI.length} options — SimpleX only allows ${EMOJI.length} reaction emoji.`)
    const yesNo = options.length === 0
    const state: PollState = {
      question: fmt.truncate(question, 200),
      options: yesNo ? ["Yes", "No"] : options.map((o) => fmt.truncate(o, 80)),
      emoji: [...(yesNo ? YES_NO : EMOJI)].slice(0, yesNo ? 2 : options.length),
      votes: {},
      ownerName: ctx.sender.displayName,
      prefix: ctx.config.prefix,
      tappable: ctx.ui.tappable,
    }
    // send first: the buttons need the interaction id, which needs the message
    const msg = await ctx.send(`📊 ${fmt.bold(state.question)}`)
    const ix = ctx.rt.interactions.create("poll", msg, state, {ownerKey: ctx.sender.key, ttlMs: 30 * 86_400_000})

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
