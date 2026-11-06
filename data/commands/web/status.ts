import {defineCommand, fmt, HttpError} from "../../../src/sdk"

export default defineCommand({
  name: "status",
  aliases: ["isup", "up"],
  description: "Check if a website is up: /status example.com",
  details: "Only public addresses are allowed (no local network).",
  category: "Web",
  args: [{name: "url", type: "string", description: "Website or URL", required: true}],
  examples: ["status simplex.chat"],
  live: "🔎 Checking",
  cooldown: 5,
  async run(ctx) {
    const raw = ctx.args.url.trim()
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return ctx.usageError(`"${raw}" doesn't look like a website.`)
    }
    const again = ctx.ui.button("🔁", "status", raw)
    ctx.progress(`🔎 Checking ${host}`)
    try {
      const r = await ctx.http.request(url, {service: host, publicOnly: true, allowErrorStatus: true, timeoutMs: 10_000, maxBytes: 512 * 1024})
      const up = r.status < 500
      const icon = r.status < 400 ? "🟢" : up ? "🟡" : "🔴"
      const finalHost = new URL(r.url).hostname
      return fmt.lines(
        `${icon} ${fmt.bold(host)} is ${up ? "up" : "having problems"} — HTTP ${r.status} in ${r.ms}ms`,
        finalHost !== host ? fmt.italic(`↪ redirected to ${finalHost}`) : undefined,
        again
      )
    } catch (e) {
      if (e instanceof HttpError && /isn't public|valid URL|Only http|non-http/.test(e.message)) return ctx.fail(e.message)
      if (e instanceof HttpError) return fmt.lines(`🔴 ${fmt.bold(host)} looks down — ${e.message}`, again)
      throw e
    }
  },
})
