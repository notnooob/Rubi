import {isIP} from "node:net"
import {defineCommand, fmt, HttpError, type Http} from "../../../src/sdk"

interface Entity {
  roles?: string[]
  vcardArray?: [string, [string, unknown, string, unknown][]]
  entities?: Entity[]
}
interface Rdap {
  ldhName?: string
  name?: string
  handle?: string
  status?: string[]
  events?: {eventAction: string; eventDate: string}[]
  entities?: Entity[]
  nameservers?: {ldhName: string}[]
  secureDNS?: {delegationSigned?: boolean}
  startAddress?: string
  endAddress?: string
  country?: string
}

/** Name ("fn") of the first entity with `role`, searching nested entities too. */
function entityName(entities: Entity[] | undefined, role: string): string | undefined {
  for (const e of entities ?? []) {
    const fn = e.vcardArray?.[1]?.find((p) => p[0] === "fn")?.[3]
    if (e.roles?.includes(role) && typeof fn === "string" && fn.trim()) return fn.trim()
    const nested = entityName(e.entities, role)
    if (nested) return nested
  }
}

async function lookup(http: Http, path: string): Promise<Rdap | undefined> {
  try {
    return await http.json<Rdap>(`https://rdap.org/${path}`, {service: "RDAP", headers: {accept: "application/rdap+json"}})
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return undefined
    throw e
  }
}

export default defineCommand({
  name: "whois",
  aliases: ["rdap"],
  description: "Domain or IP owner: /whois simplex.chat",
  details: "Registrar, dates, status, name servers and DNSSEC for domains; network name, range and country for IP addresses. Uses RDAP (rdap.org), the successor of WHOIS.",
  category: "Web",
  args: [{name: "target", type: "string", description: "Domain or IP address", required: true}],
  examples: ["whois simplex.chat", "whois 1.1.1.1"],
  live: "🔎 Looking up",
  cooldown: 3,
  async run(ctx) {
    const target = ctx.args.target.toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "")
    const date = (r: Rdap, action: string) => {
      const at = r.events?.find((e) => e.eventAction === action)?.eventDate
      return at && !Number.isNaN(Date.parse(at)) ? `${at.slice(0, 10)} (${fmt.relative(Date.parse(at))})` : undefined
    }

    if (isIP(target)) {
      const r = await lookup(ctx.http, `ip/${target}`)
      if (!r) return ctx.fail(`No RDAP record for ${target}.`)
      const org = entityName(r.entities, "registrant") ?? entityName(r.entities, "administrative")
      return fmt.lines(
        `🔎 ${fmt.bold(target)}`,
        r.name ? `Network: ${fmt.bold(r.name)}${r.handle ? ` (${r.handle})` : ""}` : undefined,
        r.startAddress && r.endAddress ? `Range: ${fmt.code(`${r.startAddress} – ${r.endAddress}`)}` : undefined,
        org ? `Organization: ${org}` : undefined,
        r.country ? `Country: ${r.country}` : undefined,
        date(r, "registration") ? `Registered: ${date(r, "registration")}` : undefined
      )
    }

    if (!/^(?=.{1,253}$)([a-z0-9-_]{1,63}\.)+[a-z0-9-]{2,63}$/i.test(target)) return ctx.usageError(`"${target}" isn't a domain name or IP address.`)
    // RDAP only knows registered domains, so fall back from "www.example.com" to "example.com".
    // shortcut: drops to the last two labels, which misses names under suffixes like co.uk; use the Public Suffix List if that matters
    const parent = target.split(".").slice(-2).join(".")
    const r = (await lookup(ctx.http, `domain/${target}`)) ?? (parent !== target ? await lookup(ctx.http, `domain/${parent}`) : undefined)
    if (!r) return ctx.fail(`No RDAP record for ${target}: it isn't registered, or its registry doesn't offer RDAP.`)
    const nameservers = (r.nameservers ?? []).map((n) => n.ldhName.toLowerCase())
    const registrar = entityName(r.entities, "registrar")
    return fmt.lines(
      `🔎 ${fmt.bold((r.ldhName ?? target).toLowerCase())}`,
      registrar ? `Registrar: ${registrar}` : undefined,
      date(r, "registration") ? `Registered: ${date(r, "registration")}` : undefined,
      date(r, "expiration") ? `Expires: ${date(r, "expiration")}` : undefined,
      date(r, "last changed") ? `Updated: ${date(r, "last changed")}` : undefined,
      r.status?.length ? `Status: ${r.status.join(", ")}` : undefined,
      nameservers.length ? `Name servers: ${nameservers.join(", ")}` : undefined,
      r.secureDNS ? `DNSSEC: ${r.secureDNS.delegationSigned ? "signed" : "unsigned"}` : undefined
    )
  },
})
