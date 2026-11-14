import {createHash} from "node:crypto"
import {chatUtil, defineCommand, fmt} from "../../../src/sdk"

const MAX_GUESSES = 6

export const ANSWERS = (
  "about above actor acute adopt adult after again agent agree alarm album alert alive allow alone angel angle apple " +
  "apron arena argue arrow aside award badge baker basic beach begin being bench berry birth black blade blame blank " +
  "blast blend bloom board boost brain brave bread break brick brief bring broad brush build cabin cable camel candy " +
  "cargo carry catch cause chain chair chalk charm chart chase cheap check chess chief child cider claim class clean " +
  "clear climb clock close cloud coach coast coral couch count cover craft crane crash cream crowd crown dance delay " +
  "depth dizzy dough draft drama dream dress drink drive eager early earth eight elbow empty enjoy entry equal event " +
  "exact extra fable faith feast fence field flame flash fleet float flock flour focus forge frame fresh frost fruit " +
  "giant glass globe grace grape grass great green guard guess guide happy heart honey horse hotel house humor ideal " +
  "image inbox input jelly jewel juice knife label laser later lemon level light limit lunar magic maple march medal " +
  "melon metal minor model money month motor mount music nerve night noble north novel ocean offer olive onion orbit " +
  "order otter paint panel paper party peach pearl phone piano pilot pizza place plain plane plant plaza point polar " +
  "power press pride prize proof proud queen quick quiet radio raise ranch rapid raven reach ready river robot rocky " +
  "round royal salad scale scene scout seven shade shape share shark sheep shelf shell shine shirt short sight skill " +
  "sleep slice smile smoke snack snake solar sound south space spark spice spoon sport squad stage stamp stand steam " +
  "stone storm story sugar sunny sweet table taste teach thumb tiger toast topic torch tower track trail train treat " +
  "trend tribe trust truth tulip uncle union unity urban value vapor video vivid voice wagon watch water whale wheat " +
  "wheel world worth yacht young youth zebra"
).split(" ")

interface Guess {
  key: string
  name: string
  word: string
}
/** Today's guesses in one chat. */
interface Board {
  day: string
  guesses: Guess[]
  solvedBy?: string
}
/** Wins per player in one chat, by sender key. */
type Scores = Record<string, {name: string; wins: number}>

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/** The same word everywhere on a given (UTC) day. */
export function wordFor(day: string): string {
  return ANSWERS[createHash("sha256").update(`rubi-word:${day}`).digest().readUInt32BE(0) % ANSWERS.length]!
}

/** 🟩 right place, 🟨 elsewhere in the word (counting repeats), ⬜ not in it. */
export function wordMarks(guess: string, answer: string): string {
  const marks = Array<string>(5).fill("⬜")
  const left: Record<string, number> = {}
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) marks[i] = "🟩"
    else left[answer[i]!] = (left[answer[i]!] ?? 0) + 1
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i] === "⬜" && left[guess[i]!]) {
      marks[i] = "🟨"
      left[guess[i]!]!--
    }
  }
  return marks.join("")
}

export default defineCommand({
  name: "word",
  description: "Daily word puzzle",
  details:
    `Everyone gets the same word each day (UTC). Guess with /word <word>: 🟩 right spot, 🟨 in the word, ⬜ not in it. ` +
    `Each player has ${MAX_GUESSES} guesses a day; guesses are shared with the chat, and the first to solve it scores a win. /word scores shows the leaderboard.`,
  category: "Fun",
  args: [{name: "guess", type: "string", description: "A 5-letter word, or scores"}],
  examples: ["word", "word crane", "word scores"],
  cooldown: 0,
  async run(ctx) {
    const key = chatUtil.chatKey(ctx.ref)
    const boards = ctx.rt.store.collection<Board>("word")
    const scoreboard = ctx.rt.store.collection<Scores>("wordscores")
    const day = today()
    const answer = wordFor(day)
    const stored = boards.get(key)
    const board: Board = stored?.day === day ? stored : {day, guesses: []}
    const next = new Date(`${day}T00:00:00Z`).getTime() + 86_400_000
    const rows = () => board.guesses.map((g) => `${wordMarks(g.word, answer)} ${fmt.code(g.word.toUpperCase())} ${g.name}`)
    const guess = ctx.args.guess?.toLowerCase()

    if (guess === "scores") {
      const top = Object.values(scoreboard.get(key) ?? {}).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name)).slice(0, 10)
      if (!top.length) return `🔤 No wins yet. Play with ${ctx.ui.cmd("word", "<word>")}`
      return fmt.lines(`🔤 ${fmt.bold("Daily word: wins")}`, ...top.map((s, i) => `${i === 0 ? "🏆" : `${i + 1}.`} ${fmt.bold(s.name)}: ${fmt.plural(s.wins, "win")}`))
    }
    if (!guess) {
      return fmt.lines(
        `🔤 ${fmt.bold(`Daily word · ${day}`)}`,
        ...rows(),
        board.solvedBy ? `🎉 Solved by ${fmt.bold(board.solvedBy)}. Next word ${fmt.relative(next)}.` : `Guess with ${ctx.ui.cmd("word", "<word>")} · ${MAX_GUESSES} guesses each`,
        fmt.italic(`Yesterday's word: ${wordFor(today(next - 2 * 86_400_000)).toUpperCase()}`)
      )
    }
    if (board.solvedBy) return `🎉 Today's word was solved by ${fmt.bold(board.solvedBy)}. Next word ${fmt.relative(next)}.`
    // shortcut: any 5 letters count as a guess (no dictionary check); add a word list if people spam "aeiou"-style probes
    if (!/^[a-z]{5}$/.test(guess)) return ctx.usageError("Guess a word of exactly 5 letters (a–z).")
    const used = board.guesses.filter((g) => g.key === ctx.sender.key).length
    if (used >= MAX_GUESSES) return ctx.fail(`You've used your ${MAX_GUESSES} guesses for today. Next word ${fmt.relative(next)}.`)

    board.guesses.push({key: ctx.sender.key, name: ctx.sender.displayName, word: guess})
    const won = guess === answer
    if (won) {
      board.solvedBy = ctx.sender.displayName
      scoreboard.update(key, (s = {}) => {
        s[ctx.sender.key] = {name: ctx.sender.displayName, wins: (s[ctx.sender.key]?.wins ?? 0) + 1}
        return s
      })
    }
    boards.set(key, board)
    return fmt.lines(
      ...rows(),
      won
        ? `🎉 ${fmt.bold(ctx.sender.displayName)} solved it in ${fmt.plural(used + 1, "guess", "guesses")}!`
        : fmt.italic(`${fmt.plural(MAX_GUESSES - used - 1, "guess", "guesses")} left for ${ctx.sender.displayName}`)
    )
  },
})
