import {randomInt} from "node:crypto"
import {setTimeout as sleep} from "node:timers/promises"
import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "choose",
  aliases: ["pick"],
  description: "Pick one for you: /choose pizza | sushi | tacos",
  details: "Separate options with |, commas, or the word \"or\".",
  category: "Utility",
  args: [{name: "options", type: "text", description: "Things to choose from", required: true}],
  examples: ["choose pizza | sushi | tacos", "choose tea or coffee"],
  live: "🤔 Hmm, let me think",
  async run(ctx) {
    const raw = ctx.args.options
    const sep = raw.includes("|") ? /\|/ : raw.includes(",") ? /,/ : /\s+or\s+/i
    const options = raw.split(sep).map((s) => s.trim()).filter(Boolean)
    if (options.length < 2) return ctx.usageError("Give me at least two options, e.g. tea | coffee.")
    await sleep(900, undefined, {signal: ctx.signal})
    return `👉 I choose… ${fmt.bold(options[randomInt(options.length)]!)}!`
  },
})
