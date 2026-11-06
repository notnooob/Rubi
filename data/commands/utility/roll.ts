import {randomInt} from "node:crypto"
import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "roll",
  aliases: ["dice"],
  description: "Roll dice: /roll 2d6+3, /roll d20, /roll 100",
  category: "Utility",
  args: [{name: "dice", type: "string", description: "NdM±K (e.g. 2d6+3), dM, or a number for 1–N"}],
  examples: ["roll", "roll 2d6+3", "roll d20", "roll 100"],
  cooldown: 1,
  run(ctx) {
    const spec = (ctx.args.dice ?? "1d6").toLowerCase().replace(/\s/g, "")
    const m = spec.match(/^(\d*)d(\d+)([+-]\d+)?$/) ?? spec.match(/^()(\d+)()$/)
    if (!m) return ctx.usageError(`"${spec}" isn't a dice roll — try 2d6, d20, 3d8+2 or 100.`)
    const count = m[1] ? Number(m[1]) : 1
    const sides = Number(m[2])
    const mod = m[3] ? Number(m[3]) : 0
    if (count < 1 || count > 100) return ctx.usageError("Roll between 1 and 100 dice.")
    if (sides < 2 || sides > 1_000_000) return ctx.usageError("Dice need 2 to 1,000,000 sides.")
    const rolls = Array.from({length: count}, () => randomInt(1, sides + 1))
    const total = rolls.reduce((a, b) => a + b, 0) + mod
    const label = spec.includes("d") ? spec : `1-${sides}`
    const detail = count > 1 || mod ? ` ${fmt.italic(`[${rolls.join(", ")}]${mod ? ` ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}` : ""}`)}` : ""
    const crit = count === 1 && sides === 20 ? (rolls[0] === 20 ? " 💥 Natural 20!" : rolls[0] === 1 ? " 💀 Natural 1…" : "") : ""
    return fmt.lines(`🎲 ${fmt.code(label)} → ${fmt.bold(total)}${detail}${crit}`, ctx.ui.button("🔁 Again", "roll", ctx.args.dice ?? ""))
  },
})
