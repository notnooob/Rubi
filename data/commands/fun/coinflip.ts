import {randomInt} from "node:crypto"
import {setTimeout as sleep} from "node:timers/promises"
import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "coinflip",
  aliases: ["flip"],
  description: "Flip a coin",
  category: "Fun",
  live: "🪙 Flipping",
  cooldown: 2,
  async run(ctx) {
    // a little live animation (no dots: the apps already animate "..." after live messages)
    for (const frame of ["🪙 Flipping — heads?", "🪙 Flipping — tails?", "🪙 Flipping — heads?"]) {
      await sleep(450, undefined, {signal: ctx.signal})
      ctx.progress(frame)
    }
    await sleep(450, undefined, {signal: ctx.signal})
    const heads = randomInt(2) === 0
    return fmt.lines(`🪙 ${fmt.bold(heads ? "Heads!" : "Tails!")}`, ctx.ui.button("🔁 Again", "coinflip"))
  },
})
