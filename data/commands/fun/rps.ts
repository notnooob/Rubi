import {randomInt} from "node:crypto"
import {defineCommand, fmt} from "../../../src/sdk"

const MOVES = ["rock", "paper", "scissors"] as const
type Move = (typeof MOVES)[number]
const ICON: Record<Move, string> = {rock: "🪨", paper: "📄", scissors: "✂️"}
const BEATS: Record<Move, Move> = {rock: "scissors", paper: "rock", scissors: "paper"}

export default defineCommand({
  name: "rps",
  aliases: ["rockpaperscissors"],
  description: "Rock, paper, scissors against me",
  category: "Fun",
  args: [{name: "move", type: "string", description: "Your move", choices: MOVES}],
  examples: ["rps rock"],
  cooldown: 1,
  run(ctx) {
    const choices = ctx.ui.buttons(MOVES.map((m) => ctx.ui.button(ICON[m], "rps", m, {important: true})), "   ")
    const you = ctx.args.move
    if (!you) return fmt.lines("✊ Rock, paper, scissors — pick one:", choices)
    const me = MOVES[randomInt(3)]!
    const result = you === me ? "🤝 It's a draw!" : BEATS[you] === me ? "🎉 You win!" : "😎 I win!"
    return fmt.lines(`You: ${ICON[you]} ${you} · Me: ${ICON[me]} ${me}`, fmt.bold(result), ctx.ui.tappable ? `\nAgain? ${choices}` : undefined)
  },
})
