import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "base64",
  aliases: ["b64"],
  description: "Encode or decode Base64",
  category: "Utility",
  args: [
    {name: "action", type: "string", description: "encode or decode", required: true, choices: ["encode", "decode"]},
    {name: "text", type: "text", description: "The text", required: true},
  ],
  examples: ["base64 encode hello", "base64 decode aGVsbG8="],
  run(ctx) {
    const {action, text} = ctx.args
    if (action === "encode") return fmt.codeBlock(Buffer.from(text, "utf8").toString("base64"))
    const clean = text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/")
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return ctx.usageError("That isn't valid Base64.")
    const buf = Buffer.from(clean, "base64")
    const decoded = buf.toString("utf8")
    // binary data doesn't survive as text — show hex instead
    const printable = !decoded.includes("�") && !/[\x00-\x08\x0E-\x1F]/.test(decoded)
    return printable ? fmt.codeBlock(decoded) : fmt.lines(fmt.italic(`Binary data (${buf.length} bytes), shown as hex:`), fmt.codeBlock(buf.toString("hex").slice(0, 2000)))
  },
})
