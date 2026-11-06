import {createHash} from "node:crypto"
import {defineCommand, fmt} from "../../../src/sdk"

const ALGOS = ["md5", "sha1", "sha256", "sha512", "sha3-256"] as const

export default defineCommand({
  name: "hash",
  aliases: ["digest"],
  description: "Hash text: /hash sha256 hello",
  category: "Utility",
  args: [
    {name: "algorithm", type: "string", description: "Hash algorithm", required: true, choices: ALGOS},
    {name: "text", type: "text", description: "Text to hash", required: true},
  ],
  examples: ["hash sha256 hello world", "hash md5 hello"],
  run(ctx) {
    const digest = createHash(ctx.args.algorithm).update(ctx.args.text, "utf8").digest("hex")
    const weak = ctx.args.algorithm === "md5" || ctx.args.algorithm === "sha1" ? fmt.italic("(not collision-resistant — don't use for security)") : undefined
    return fmt.lines(`#️⃣ ${fmt.bold(ctx.args.algorithm.toUpperCase())}`, fmt.codeBlock(digest), weak)
  },
})
