import {randomInt} from "node:crypto"
import {setTimeout as sleep} from "node:timers/promises"
import {defineCommand, fmt} from "../../../src/sdk"

const ANSWERS = [
  ["🟢", "It is certain."], ["🟢", "Without a doubt."], ["🟢", "You may rely on it."], ["🟢", "Yes, definitely."],
  ["🟢", "As I see it, yes."], ["🟢", "Most likely."], ["🟢", "Outlook good."], ["🟢", "Signs point to yes."],
  ["🟡", "Reply hazy, try again."], ["🟡", "Ask again later."], ["🟡", "Better not tell you now."], ["🟡", "Cannot predict now."],
  ["🔴", "Don't count on it."], ["🔴", "My reply is no."], ["🔴", "My sources say no."], ["🔴", "Very doubtful."],
] as const

export default defineCommand({
  name: "8ball",
  aliases: ["eightball", "ask"],
  description: "Ask the magic 8-ball a yes/no question",
  category: "Fun",
  args: [{name: "question", type: "text", description: "Your yes/no question", required: true}],
  examples: ["8ball Will it rain tomorrow?"],
  live: "🎱 Shaking the ball",
  async run(ctx) {
    await sleep(1200, undefined, {signal: ctx.signal})
    const [dot, answer] = ANSWERS[randomInt(ANSWERS.length)]!
    return fmt.lines(`🎱 ${fmt.italic(fmt.truncate(ctx.args.question, 200))}`, `${dot} ${fmt.bold(answer)}`)
  },
})
