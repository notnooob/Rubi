import {defineCommand, fmt} from "../../../src/sdk"

const TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "CAA"] as const
const STATUS: Record<number, string> = {1: "format error", 2: "server failure", 3: "domain doesn't exist", 5: "refused"}

interface DohResponse {
  Status: number
  Answer?: {name: string; type: number; TTL: number; data: string}[]
}

export default defineCommand({
  name: "dns",
  aliases: ["dig", "lookup"],
  description: "DNS lookup: /dns simplex.chat MX",
  details: "Uses DNS-over-HTTPS (Cloudflare), so lookups are encrypted.",
  category: "Web",
  args: [
    {name: "domain", type: "string", description: "Domain name", required: true},
    {name: "type", type: "string", description: "Record type (default A)", choices: TYPES},
  ],
  examples: ["dns simplex.chat", "dns simplex.chat MX", "dns simplex.chat TXT"],
  live: "🧭 Looking up",
  cooldown: 3,
  async run(ctx) {
    const domain = ctx.args.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "")
    if (!/^(?=.{1,253}$)([a-z0-9-_]{1,63}\.)*[a-z0-9-]{1,63}$/i.test(domain)) return ctx.usageError(`"${domain}" isn't a domain name.`)
    const type = (ctx.args.type ?? "A").toUpperCase()
    const r = await ctx.http.json<DohResponse>("https://cloudflare-dns.com/dns-query", {
      service: "DNS",
      query: {name: domain, type},
      headers: {accept: "application/dns-json"},
    })
    if (r.Status !== 0) return ctx.fail(`${domain}: ${STATUS[r.Status] ?? `DNS error ${r.Status}`}.`)
    const answers = r.Answer ?? []
    if (!answers.length) return `🧭 ${fmt.bold(domain)} has no ${type} records.`
    return fmt.lines(
      `🧭 ${fmt.bold(domain)} · ${type}`,
      fmt.codeBlock(answers.map((a) => `${a.data}  (TTL ${a.TTL}s)`).join("\n").slice(0, 3500))
    )
  },
})
