import {randomInt} from "node:crypto"
import {defineCommand, defineInteraction, defineJob, describeError, fmt, makeUi, normalizeReaction, type BotMessage, type Http, type Interaction, type Runtime} from "../../../src/sdk"

const EMOJI = ["👍", "❤", "🚀", "😀"] as const
const SECONDS = 30
const NEXT_ROUND_DELAY = 5_000

interface TournamentState {
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
type Tournament = {ref: Interaction<TriviaState>["ref"]; prefix: string; tappable: boolean; tournament: TournamentState}
type QuestionRun = {rt: Runtime; q: Question; prefix: string; tappable: boolean; tournament?: TournamentState; send: () => Promise<BotMessage>}

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
    const final = !!tournament && tournament.round >= tournament.total
    return fmt.lines(
      title(s),
      tournament ? fmt.italic(`${s.category} · ${s.difficulty}`) : undefined,
      fmt.bold(s.question),
      "",
      ...s.answers.map((a, i) => (i === s.correct ? `✅ ${fmt.bold(a)}` : `${EMOJI[i]} ${fmt.strike(a)}`)),
      "",
      right.length ? `🏆 ${fmt.bold("Right:")} ${right.join(", ")}` : "🤷 Nobody got it right.",
      wrong ? fmt.italic(`${wrong} wrong`) : undefined,
      tournament ? `${final ? "🏁 Final scoreboard" : "📊 Scoreboard"}: ${scoreboard(s)}` : undefined,
      tournament && final ? `🎉 ${fmt.bold("Tournament winners:")} ${winners(s)}` : undefined,
      tournament && !final ? fmt.italic("Next round in about 5 seconds") : undefined,
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
    fmt.italic(`${s.tappable ? "React or tap" : "React with your answer's emoji"} · first answer counts · ${SECONDS}s · ${fmt.plural(n, "answer")} so far`)
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
    const i = Number(args[0]?.replace(/,/g, "")) - 1
    if (!(i >= 0 && i < ix.state.answers.length)) return {reply: "Pick one of the answers."}
    if (ix.state.picks[ctx.sender.key]) return {reply: "You already answered — first answer counts!"}
    if (!pick(ix, ctx.sender.key, ctx.sender.displayName, i)) return {reply: "Too late — this question is closed."}
    return {text: render(ix), ack: "👍"}
  },
})

defineJob<{id: string}>("trivia-reveal", async (job, rt) => {
  const ix = rt.interactions.get<TriviaState>(job.payload.id)
  if (!ix) return
  ix.state.revealed = true
  const tournament = ix.state.tournament
  if (tournament) {
    for (const [key, answer] of Object.entries(ix.state.picks)) {
      tournament.names[key] = answer.name
      tournament.scores[key] ??= 0
      if (answer.i === ix.state.correct) tournament.scores[key]++
    }
    // Persist names and cumulative points even though this interaction is now closed.
    rt.interactions.save(ix)
  }
  rt.interactions.end(ix.id)
  await rt.messenger.update(ix.ref, ix.itemId, render(ix))
  if (tournament && tournament.round < tournament.total) {
    rt.scheduler.schedule("tournament-next", Date.now() + NEXT_ROUND_DELAY, {
      ref: ix.ref,
      prefix: ix.state.prefix,
      tappable: ix.state.tappable,
      tournament: {
        round: tournament.round + 1,
        total: tournament.total,
        scores: tournament.scores,
        names: tournament.names,
        questions: tournament.questions,
        difficulty: tournament.difficulty,
      },
    } satisfies Tournament)
  }
})

defineJob<Tournament>("tournament-next", async (job, rt) => {
  try {
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
  const ix = run.rt.interactions.create("trivia", msg, state, {ttlMs: SECONDS * 1000 + 60_000})
  await msg.edit(render(ix))
  run.rt.scheduler.schedule("trivia-reveal", state.closesAt, {id: ix.id})
}

export default defineCommand({
  name: "trivia",
  aliases: ["quiz"],
  description: "A trivia question, or a tournament of 2–10 rounds",
  details: `Answers are revealed after ${SECONDS} seconds. Questions from the Open Trivia Database. Start a tournament with /trivia tournament [2–10] [easy|medium|hard]; points accumulate across rounds.`,
  category: "Fun",
  args: [{name: "mode", type: "string", description: "tournament, easy, medium or hard"}, {name: "rounds", type: "integer", description: "Tournament rounds", min: 2, max: 10}, {name: "difficulty", type: "string", description: "easy, medium or hard", choices: ["easy", "medium", "hard"]}],
  examples: ["trivia", "trivia hard", "trivia tournament 5 medium"],
  cooldown: 10,
  live: "🧠 Finding a question",
  async run(ctx) {
    let difficulty: string | undefined = ctx.args.difficulty
    if (ctx.args.mode && ctx.args.mode !== "tournament") {
      if (!["easy", "medium", "hard"].includes(ctx.args.mode)) return ctx.usageError("Use /trivia [easy|medium|hard] or /trivia tournament [2–10] [easy|medium|hard].")
      if (ctx.args.rounds !== undefined || difficulty !== undefined) return ctx.usageError("Use only one difficulty for a single question.")
      difficulty = ctx.args.mode
    }
    if (ctx.args.mode !== "tournament" && ctx.args.rounds !== undefined) return ctx.usageError("Rounds are only used with tournament mode.")
    const isTournament = ctx.args.mode === "tournament"
    const total = isTournament ? (ctx.args.rounds ?? 5) : 1
    try {
      const data = await fetchQuestions(ctx.http, total, difficulty)
      const tournament: TournamentState | undefined = isTournament ? {round: 1, total, scores: {}, names: {}, questions: data.results.slice(1), difficulty} : undefined
      await startQuestion({
        rt: ctx.rt,
        q: data.results[0]!,
        prefix: ctx.config.prefix,
        tappable: ctx.ui.tappable,
        tournament,
        send: () => ctx.reply(`🧠 ${fmt.bold("Trivia")}`),
      })
    } catch (err) {
      if (err instanceof Error && /trivia service is busy|enough questions/.test(err.message)) return ctx.fail(err.message)
      throw err
    }
  },
})
