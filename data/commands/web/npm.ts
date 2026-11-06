import {defineCommand, fmt, HttpError} from "../../../src/sdk"

interface Manifest {
  name: string
  version: string
  description?: string
  license?: string
  homepage?: string
}

export default defineCommand({
  name: "npm",
  description: "npm package info: /npm simplex-chat",
  category: "Web",
  args: [{name: "package", type: "string", description: "Package name", required: true}],
  examples: ["npm simplex-chat", "npm @simplex-chat/types"],
  live: "📦 Checking npm",
  cooldown: 3,
  async run(ctx) {
    const name = ctx.args.package.trim().toLowerCase()
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) return ctx.usageError(`"${name}" isn't a valid package name.`)
    let m: Manifest
    try {
      m = await ctx.http.json<Manifest>(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`, {service: "npm"})
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return ctx.fail(`No npm package called ${name}.`)
      throw e
    }
    const dl = await ctx.http
      .json<{downloads: number}>(`https://api.npmjs.org/downloads/point/last-week/${name}`, {service: "npm"})
      .catch(() => undefined)
    return fmt.lines(
      `📦 ${fmt.bold(m.name)} ${fmt.code(m.version)}`,
      m.description ? fmt.italic(fmt.truncate(m.description, 300)) : undefined,
      [m.license && `⚖️ ${m.license}`, dl && `⬇️ ${fmt.num(dl.downloads)}/week`].filter(Boolean).join(" · ") || undefined,
      `https://www.npmjs.com/package/${m.name}`
    )
  },
})
