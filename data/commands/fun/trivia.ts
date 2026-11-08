import {randomInt} from "node:crypto"
import {defineCommand, defineInteraction, defineJob, describeError, fmt, makeUi, newId, normalizeReaction, type BotMessage, type Http, type Interaction, type Runtime} from "../../../src/sdk"

const EMOJI = ["👍", "❤", "🚀", "😀"] as const
const SECONDS = 30
const NEXT_ROUND_DELAY = 5_000

interface TournamentState {
  id: string
  /** Current round, numbered from 1. */
  round: number
  total: number
  /** Every participant (including zero scorers), keyed by userKey. */
  scores: Record<string, number>
  /** Stable display names, kept when a player doesn't answer later rounds. */
  names: Record<string, string>
  /** Remaining questions from the tournament's single initial OpenTDB response. */
  questions?: Question[]
  difficulty?: string
  cancelled?: boolean
  ownerKey?: string
}

interface TriviaState {
  question: string
  category: string
  difficulty: string
  answers: string[]
  correct: number
  /** userKey → {answer index, name}; first answer counts */
  picks: Record<string, {i: number; name: string}>
  closesAt: number
  revealed?: boolean
  prefix: string
  /** Commands are tappable in this chat (DMs, or groups with /groupmenu). */
  tappable: boolean
  tournament?: TournamentState
}

interface OpenTdb {
  response_code: number
  results: {category: string; difficulty: string; question: string; correct_answer: string; incorrect_answers: string[]}[]
}

type Question = OpenTdb["results"][number]
type Tournament = {ref: Interaction<TriviaState>["ref"]; prefix: string; tappable: boolean; ownerKey: string; tournament: TournamentState}
type QuestionRun = {rt: Runtime; q: Question; prefix: string; tappable: boolean; ownerKey: string; tournament?: TournamentState; send: () => Promise<BotMessage>}

function title(s: TriviaState): string {
  return s.tournament ? `🧠 ${fmt.bold("Trivia tournament")} · Round ${s.tournament.round}/${s.tournament.total}` : `🧠 ${fmt.bold("Trivia")} · ${fmt.italic(`${s.category} · ${s.difficulty}`)}`
}

function scoreboard(s: TriviaState): string {
  const t = s.tournament
  const scores = Object.entries(t?.scores ?? {}).sort((a, b) => b[1] - a[1] || (t?.names[a[0]] ?? a[0]).localeCompare(t?.names[b[0]] ?? b[0]))
  if (!scores.length) return "No points yet."
  return scores.map(([key, points], i) => `${i === 0 ? "🏆 " : ""}${fmt.bold(t?.names[key] ?? key)}: ${fmt.plural(points, "point")}`).join(" · ")
}

function render(ix: Interaction<TriviaState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const n = Object.keys(s.picks).length
  const tournament = s.tournament
  if (s.revealed) {
    const right = Object.values(s.picks).filter((p) => p.i === s.correct).map((p) => p.name)
    const wrong = n - right.length
    const final = !!tournament && (tournament.round >= tournament.total || tournament.cancelled)
    return fmt.lines(
      title(s),
      tournament ? fmt.italic(`${s.category} · ${s.difficulty}`) : undefined,
      fmt.bold(s.question),
      "",
      ...s.answers.map((a, i) => (i === s.correct ? `✅ ${fmt.bold(a)}` : `${EMOJI[i]} ${fmt.strike(a)}`)),
      "",
      right.length ? `🏆 ${fmt.bold("Right:")} ${right.join(", ")}` : "🤷 Nobody got it right.",
      wrong ? fmt.italic(`${wrong} wrong`) : undefined,
      tournament ? `${tournament.cancelled ? "✖ Tournament cancelled" : final ? "🏁 Final scoreboard" : "📊 Scoreboard"}: ${scoreboard(s)}` : undefined,
      tournament && final && !tournament.cancelled ? `🎉 ${fmt.bold("Tournament winners:")} ${winners(s)}` : undefined,
      tournament && !final ? fmt.italic("Next round in about 5 seconds") : undefined,
      tournament && !final ? `Cancel: ${ui.button("✖", "trivia", `cancel ${tournament.id}`, {important: true})}` : undefined,
      !tournament ? ui.button("🧠 Another", "trivia") : undefined
    )
  }
  return fmt.lines(
    title(s),
    tournament ? fmt.italic(`${s.category} · ${s.difficulty}`) : undefined,
    fmt.bold(s.question),
    "",
    ...s.answers.map((a, i) => `${EMOJI[i]} ${a}${s.tappable ? `   ${ui.button("", "vote", `${ix.id} ${i + 1}`)}` : ""}`),
    "",
    fmt.italic(`${s.tappable ? "React or tap" : "React with your answer's emoji"} · first answer counts · ${SECONDS}s · ${fmt.plural(n, "answer")} so far`),
    tournament && s.tappable ? ui.button("✖ Cancel tournament", "trivia", `cancel ${tournament.id}`, {important: true}) : undefined
  )
}

function winners(s: TriviaState): string {
  const t = s.tournament
  const entries = Object.entries(t?.scores ?? {})
  const top = Math.max(0, ...entries.map(([, points]) => points))
  if (!entries.length || top === 0) return "Nobody scored this time."
  return entries.filter(([, points]) => points === top).map(([key]) => fmt.bold(t?.names[key] ?? key)).join(", ")
}

function pick(ix: Interaction<TriviaState>, userKey: string, name: string, i: number): boolean {
  if (ix.state.revealed || Date.now() > ix.state.closesAt || ix.state.picks[userKey]) return false
  ix.state.picks[userKey] = {i, name}
  return true
}

defineInteraction<TriviaState>("trivia", {
  onReaction(ix, r) {
    if (!r.added) return
    const i = EMOJI.indexOf(normalizeReaction(r.emoji) as (typeof EMOJI)[number])
    if (i < 0 || i >= ix.state.answers.length) return
    return pick(ix, r.userKey, r.displayName, i) ? render(ix) : undefined
  },
  onButton(ix, args, ctx) {
    const n = Number(args[0])
    const i = Number.isInteger(n) ? n - 1 : -1
    if (!(i >= 0 && i < ix.state.answers.length)) return {reply: "Pick one of the answers."}
    if (ix.state.picks[ctx.sender.key]) return {reply: "You already answered — first answer counts!"}
    if (!pick(ix, ctx.sender.key, ctx.sender.displayName, i)) return {reply: "Too late — this question is closed."}
    return {text: render(ix), ack: "👍"}
  },
  onCancel(ix) {
    if (!ix.state.tournament) return {reply: "A single trivia question cannot be cancelled."}
    ix.state.tournament.cancelled = true
    return {text: render(ix), done: true, reply: "✅ Trivia tournament cancelled."}
  },
})

defineJob<{id: string}>("trivia-reveal", async (job, rt) => {
  await rt.interactions.mutate<TriviaState, void>(job.payload.id, async (ix) => {
    const wasRevealed = !!ix.state.revealed
    ix.state.revealed = true
    const tournament = ix.state.tournament
    if (tournament && !wasRevealed) {
      for (const [key, answer] of Object.entries(ix.state.picks)) {
        tournament.names[key] = answer.name
        tournament.scores[key] ??= 0
        if (answer.i === ix.state.correct) tournament.scores[key]++
      }
      rt.interactions.save(ix)
    }
    const alreadyScheduled = tournament && rt.scheduler.list<any>((job) => job.kind === "tournament-next" && job.payload?.tournament?.id === tournament.id).length > 0
    await rt.messenger.update(ix.ref, ix.itemId, render(ix)).catch((e) => rt.log.warn(`trivia reveal edit failed: ${describeError(e)}`))
    rt.interactions.end(ix.id)
    if (tournament && !tournament.cancelled && tournament.round < tournament.total && !alreadyScheduled) {
      rt.scheduler.schedule("tournament-next", Date.now() + NEXT_ROUND_DELAY, {
        ref: ix.ref,
        prefix: ix.state.prefix,
        tappable: ix.state.tappable,
        ownerKey: ix.ownerKey ?? "",
        tournament: {
          id: tournament.id,
          round: tournament.round + 1,
          total: tournament.total,
          scores: tournament.scores,
          names: tournament.names,
          questions: tournament.questions,
          difficulty: tournament.difficulty,
          ownerKey: tournament.ownerKey,
        },
      } satisfies Tournament)
    }
  })
})

defineJob<Tournament>("tournament-next", async (job, rt) => {
  try {
    if (job.payload.tournament.cancelled) return
    const questions = job.payload.tournament.questions
    const q = questions?.[0]
    if (!q || !questions) throw new Error("The tournament's remaining questions are unavailable.")
    job.payload.tournament.questions = questions.slice(1)
    await startQuestion({rt, q, ...job.payload, send: () => rt.messenger.send(job.payload.ref, "🧠 Next tournament round")})
  } catch (err) {
    rt.log.warn(`trivia tournament: couldn't start round ${job.payload.tournament.round}: ${describeError(err)}`)
    try {
      const state = {picks: {}, tournament: job.payload.tournament} as TriviaState
      await rt.messenger.send(job.payload.ref, fmt.lines(`🧠 ${fmt.bold("Trivia tournament")}`, `❌ Couldn't fetch round ${job.payload.tournament.round}/${job.payload.tournament.total}; the tournament has ended.`, `${fmt.bold("Scores so far:")} ${scoreboard(state)}`))
    } catch (sendErr) {
      rt.log.warn(`trivia tournament: couldn't report the fetch failure: ${describeError(sendErr)}`)
    }
  }
})

async function fetchQuestions(http: Http, amount: number, difficulty?: string): Promise<OpenTdb> {
  const data = await http.json<OpenTdb>("https://opentdb.com/api.php", {
    service: "Open Trivia DB",
    query: {amount, type: "multiple", encode: "url3986", difficulty},
  })
  if (data.response_code === 5) throw new Error("The trivia service is busy — try again in a few seconds.")
  if (data.response_code !== 0 || data.results.length < amount) throw new Error("Couldn't get enough questions right now.")
  return data
}

const decode = (s: string) => decodeURIComponent(s)

async function startQuestion(run: QuestionRun): Promise<void> {
  const q = run.q
  const answers = [...q.incorrect_answers.map(decode)]
  const correct = randomInt(answers.length + 1)
  answers.splice(correct, 0, decode(q.correct_answer))
  const state: TriviaState = {
    question: decode(q.question),
    category: decode(q.category).replace(/^Entertainment: |^Science: /, ""),
    difficulty: decode(q.difficulty),
    answers,
    correct,
    picks: {},
    closesAt: Date.now() + SECONDS * 1000,
    prefix: run.prefix,
    tappable: run.tappable,
    tournament: run.tournament,
  }
  const msg = await run.send()
  const ix = run.rt.interactions.create("trivia", msg, state, {ownerKey: run.ownerKey, ttlMs: run.tournament ? 7 * 86_400_000 : SECONDS * 1000 + 10 * 60_000})
  await msg.edit(render(ix))
  run.rt.scheduler.schedule("trivia-reveal", state.closesAt, {id: ix.id})
}

export default defineCommand({
  name: "trivia",
  aliases: ["quiz"],
  description: "A trivia question, or a tournament of 2–10 rounds",
  details: `Answers are revealed after ${SECONDS} seconds. Questions from the Open Trivia Database. Start a tournament with /trivia tournament [2–10] [easy|medium|hard]; points accumulate across rounds.`,
  category: "Fun",
  args: [{name: "input", type: "text", description: "[tournament] [rounds] [easy|medium|hard]"}],
  examples: ["trivia", "trivia hard", "trivia tournament 5 medium"],
  cooldown: 10,
  live: "🧠 Finding a question",
  async run(ctx) {
    const tokens = (ctx.args.input ?? "").trim().split(/\s+/).filter(Boolean)
    const mode = tokens.shift()?.toLowerCase()
    const isTournament = mode === "tournament"
    if (mode === "cancel") {
      const id = tokens.shift()
      if (!id || tokens.length) return ctx.usageError("Use /trivia cancel <tournament id>.")
      const active = ctx.rt.interactions.find<TriviaState>((ix) => ix.kind === "trivia" && (ix.state as TriviaState).tournament?.id === id)
      if (active) {
        if (active.ownerKey !== ctx.sender.key) return ctx.fail("Only the tournament creator can cancel it.")
        await ctx.rt.interactions.mutate<TriviaState, void>(active.id, async (ix) => {
          const tournament = ix.state.tournament
          if (!tournament || tournament.cancelled) return
          tournament.cancelled = true
          ix.state.revealed = true
          ctx.rt.scheduler.cancelWhere((job) => (job.payload as any)?.id === ix.id && job.kind === "trivia-reveal")
          await ctx.rt.messenger.update(ix.ref, ix.itemId, render(ix))
          ctx.rt.interactions.end(ix.id)
        })
        return "✅ Cancelled the trivia tournament."
      }
      const jobs = ctx.rt.scheduler.list<any>((job) => job.kind === "tournament-next" && job.payload?.tournament?.id === id)
      const owned = jobs.filter((job) => job.payload?.ownerKey === ctx.sender.key)
      if (!owned.length) return ctx.fail("No active tournament with that id belongs to you.")
      const canceled = ctx.rt.scheduler.cancelWhere((job) => (job.payload as any)?.tournament?.id === id && (job.payload as any)?.ownerKey === ctx.sender.key)
      return `✅ Cancelled the trivia tournament (${canceled} pending round${canceled === 1 ? "" : "s"} removed).`
    }
    let difficulty: string | undefined
    let total = 1
    if (isTournament && ctx.rt.interactions.hasActive("trivia", ctx.ref, (ix) => !!(ix.state as TriviaState).tournament)) {
      return ctx.fail("A trivia tournament is already running in this chat. Cancel it before starting another.")
    }
    if (isTournament) {
      const possibleRounds = tokens[0]
      if (possibleRounds && /^\d+$/.test(possibleRounds)) total = Number(tokens.shift())
      else total = 5
      if (total < 2 || total > 10) return ctx.usageError("Tournament rounds must be from 2 to 10.")
      difficulty = tokens.shift()?.toLowerCase()
      if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) return ctx.usageError("Difficulty must be easy, medium or hard.")
      if (tokens.length) return ctx.usageError("Use /trivia tournament [2–10] [easy|medium|hard].")
    } else if (mode) {
      if (!["easy", "medium", "hard"].includes(mode) || tokens.length) return ctx.usageError("Use /trivia [easy|medium|hard] or /trivia tournament [2–10] [easy|medium|hard].")
      difficulty = mode
    }
    try {
      const data = await fetchQuestions(ctx.http, total, difficulty)
      const tournament: TournamentState | undefined = isTournament ? {id: newId(), round: 1, total, scores: {}, names: {}, questions: data.results.slice(1), difficulty, ownerKey: ctx.sender.key} : undefined
      await startQuestion({
        rt: ctx.rt,
        q: data.results[0]!,
        prefix: ctx.config.prefix,
        tappable: ctx.ui.tappable,
        ownerKey: ctx.sender.key,
        tournament,
        send: () => ctx.reply(`🧠 ${fmt.bold("Trivia")}`),
      })
    } catch (err) {
      if (err instanceof Error && /trivia service is busy|enough questions/.test(err.message)) return ctx.fail(err.message)
      throw err
    }
  },
})
