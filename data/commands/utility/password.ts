import {randomInt} from "node:crypto"
import {defineCommand, fmt} from "../../../src/sdk"

const SETS = {
  strong: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%^&*()-_=+[]{};:,.?",
  alnum: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
  pin: "0123456789",
} as const

export default defineCommand({
  name: "password",
  aliases: ["pass", "pw"],
  description: "Generate a strong random password (DMs only)",
  details: "Generated with a cryptographic RNG and not stored by Rubi separately. It remains in SimpleX chat history until you delete the message. Look-alike characters (0/O, 1/l/I) are left out. DMs only, so it isn't shown to a whole group.",
  category: "Utility",
  scope: "direct",
  args: [
    {name: "length", type: "integer", description: "Length (4–128, default 20)", min: 4, max: 128},
    {name: "kind", type: "string", description: "strong (default), alnum or pin", choices: ["strong", "alnum", "pin"]},
  ],
  examples: ["password", "password 32", "password 6 pin"],
  cooldown: 1,
  run(ctx) {
    const kind = ctx.args.kind ?? "strong"
    const length = ctx.args.length ?? (kind === "pin" ? 6 : 20)
    const set = SETS[kind]
    let pw = ""
    for (let i = 0; i < length; i++) pw += set[randomInt(set.length)]
    const bits = Math.round(length * Math.log2(set.length))
    return fmt.lines(`🔑 ${fmt.code(pw)}`, fmt.italic(`${length} characters · ~${bits} bits of entropy · Rubi does not store it separately`), ctx.ui.button("🔁", "password", [ctx.args.length, ctx.args.kind].filter(Boolean).join(" ")))
  },
})
