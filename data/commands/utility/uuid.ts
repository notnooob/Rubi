import {randomBytes, randomUUID} from "node:crypto"
import {defineCommand, fmt} from "../../../src/sdk"

let lastMs = 0
let seq = 0

/**
 * UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, then random bits — sortable by creation time.
 * Within the same millisecond the 12-bit rand_a field is a counter (RFC 9562 §6.2, method 1), so
 * ids made in one burst still sort in order.
 */
function uuidv7(): string {
  const b = randomBytes(16)
  let now = Date.now()
  if (now <= lastMs) {
    seq++
    if (seq > 0xfff) {
      // counter exhausted: borrow the next millisecond
      lastMs++
      seq = 0
    }
    now = lastMs
  } else {
    lastMs = now
    seq = b[7]! & 0x3ff // random start, leaving room to count up
  }
  const ms = BigInt(now)
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = 0x70 | ((seq >> 8) & 0x0f) // version 7 + counter high bits
  b[7] = seq & 0xff
  b[8] = (b[8]! & 0x3f) | 0x80 // RFC variant
  const h = b.toString("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export default defineCommand({
  name: "uuid",
  aliases: ["guid"],
  description: "Generate UUIDs (v4 random, or v7 time-ordered)",
  category: "Utility",
  args: [
    {name: "count", type: "integer", description: "How many (1–20)", min: 1, max: 20},
    {name: "version", type: "string", description: "v4 (default) or v7", choices: ["v4", "v7"]},
  ],
  examples: ["uuid", "uuid 5", "uuid 3 v7"],
  cooldown: 1,
  run(ctx) {
    const n = ctx.args.count ?? 1
    const v7 = ctx.args.version === "v7"
    const ids = Array.from({length: n}, () => (v7 ? uuidv7() : randomUUID()))
    return fmt.lines(`🆔 ${fmt.bold(`UUID ${v7 ? "v7" : "v4"}`)}${n > 1 ? ` × ${n}` : ""}`, fmt.codeBlock(ids.join("\n")), ctx.ui.button("🔁", "uuid", [ctx.args.count, ctx.args.version].filter(Boolean).join(" ")))
  },
})
