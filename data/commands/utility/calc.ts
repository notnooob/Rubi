import {CalcError, defineCommand, evaluate, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "calc",
  aliases: ["math", "calculate"],
  description: "Calculator: /calc (2+3)*4^2",
  details: "Supports + - * / % ^, parentheses, sqrt, abs, round, floor, ceil, sin, cos, tan, log, ln, exp, min, max, pi, e.",
  category: "Utility",
  args: [{name: "expression", type: "text", description: "What to calculate", required: true}],
  examples: ["calc 2+2", "calc sqrt(2)*10", "calc 15% * 80"],
  run(ctx) {
    // "15%" on its own means 0.15 in everyday use
    const expr = ctx.args.expression.replace(/((?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)%(?!\s*[\d(])/gi, "($1/100)")
    try {
      const result = evaluate(expr)
      return `🧮 ${fmt.code(ctx.args.expression)} = ${fmt.bold(fmt.num(result, 10))}`
    } catch (e) {
      if (e instanceof CalcError) return ctx.usageError(e.message)
      throw e
    }
  },
})
