import {randomInt} from "node:crypto"
import {defineCommand, defineInteraction, defineJob, fmt, makeUi, normalizeReaction, type Interaction} from "../../../src/sdk"

const EMOJI = ["👍", "❤", "🚀", "😀"] as const
const SECONDS = 30

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
}

interface OpenTdb {
  response_code: number
  results: {category: string; difficulty: string; question: string; correct_answer: string; incorrect_answers: string[]}[]
}

function render(ix: Interaction<TriviaState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const n = Object.keys(s.picks).length
  if (s.revealed) {
    const right = Object.values(s.picks).filter((p) => p.i === s.correct).map((p) => p.name)
    const wrong = n - right.length
    return fmt.lines(
      `🧠 ${fmt.bold("Trivia")} · ${fmt.italic(`${s.category} · ${s.difficulty}`)}`,
      fmt.bold(s.question),
      "",
      ...s.answers.map((a, i) => (i === s.correct ? `✅ ${fmt.bold(a)}` : `${EMOJI[i]} ${fmt.strike(a)}`)),
      "",
      right.length ? `🏆 ${fmt.bold("Right:")} ${right.join(", ")}` : "🤷 Nobody got it right.",
      wrong ? fmt.italic(`${wrong} wrong`) : undefined,
      ui.button("🧠 Another", "trivia")
    )
  }
  return fmt.lines(
    `🧠 ${fmt.bold("Trivia")} · ${fmt.italic(`${s.category} · ${s.difficulty}`)}`,
    fmt.bold(s.question),
    "",
    ...s.answers.map((a, i) => `${EMOJI[i]} ${a}${s.tappable ? `   ${ui.button("", "vote", `${ix.id} ${i + 1}`)}` : ""}`),
    "",
    fmt.italic(`${s.tappable ? "React or tap" : "React with your answer's emoji"} · first answer counts · ${SECONDS}s · ${fmt.plural(n, "answer")} so far`)
  )
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
    const i = Number(args[0]) - 1
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
  rt.interactions.end(ix.id)
  await rt.messenger.update(ix.ref, ix.itemId, render(ix))
})

const decode = (s: string) => decodeURIComponent(s)

export default defineCommand({
  name: "trivia",
  aliases: ["quiz"],
  description: "A trivia question — everyone can answer",
  details: `Answers are revealed after ${SECONDS} seconds. Questions from the Open Trivia Database.`,
  category: "Fun",
  args: [{name: "difficulty", type: "string", description: "easy, medium or hard", choices: ["easy", "medium", "hard"]}],
  cooldown: 10,
  live: "🧠 Finding a question",
  async run(ctx) {
    const data = await ctx.http.json<OpenTdb>("https://opentdb.com/api.php", {
      service: "Open Trivia DB",
      query: {amount: 1, type: "multiple", encode: "url3986", difficulty: ctx.args.difficulty},
    })
    if (data.response_code === 5) return ctx.fail("The trivia service is busy — try again in a few seconds.")
    const q = data.results[0]
    if (data.response_code !== 0 || !q) return ctx.fail("Couldn't get a question right now.")

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
      prefix: ctx.config.prefix,
      tappable: ctx.ui.tappable,
    }
    // the live placeholder becomes the question (the interaction is attached to that same message)
    const msg = await ctx.reply(`🧠 ${fmt.bold(state.question)}`)
    const ix = ctx.rt.interactions.create("trivia", msg, state, {ttlMs: SECONDS * 1000 + 60_000})
    await msg.edit(render(ix))
    ctx.rt.scheduler.schedule("trivia-reveal", state.closesAt, {id: ix.id})
  },
})
