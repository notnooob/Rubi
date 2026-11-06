import {defineCommand, fmt, HttpError} from "../../../src/sdk"

interface Repo {
  full_name: string
  description: string | null
  html_url: string
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  language: string | null
  license: {spdx_id: string} | null
  pushed_at: string
  archived: boolean
}
interface User {
  login: string
  name: string | null
  bio: string | null
  html_url: string
  public_repos: number
  followers: number
  created_at: string
  type: string
}

export default defineCommand({
  name: "github",
  aliases: ["gh"],
  description: "GitHub repo or user info: /github simplex-chat/simplex-chat",
  category: "Web",
  args: [{name: "target", type: "string", description: "owner/repo or a username", required: true}],
  examples: ["github simplex-chat/simplex-chat", "github torvalds"],
  live: "🐙 Asking GitHub",
  cooldown: 5,
  async run(ctx) {
    const target = ctx.args.target.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "")
    if (!/^[\w.-]+(\/[\w.-]+)?$/.test(target)) return ctx.usageError("Use owner/repo or a username.")
    const opts = {service: "GitHub", headers: {accept: "application/vnd.github+json"}}
    try {
      if (target.includes("/")) {
        const r = await ctx.http.json<Repo>(`https://api.github.com/repos/${target}`, opts)
        return fmt.lines(
          `🐙 ${fmt.bold(r.full_name)}${r.archived ? fmt.italic(" (archived)") : ""}`,
          r.description ? fmt.italic(fmt.truncate(r.description, 300)) : undefined,
          `⭐ ${fmt.num(r.stargazers_count)} · 🍴 ${fmt.num(r.forks_count)} · 🐛 ${fmt.num(r.open_issues_count)} open${r.language ? ` · ${r.language}` : ""}${r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? ` · ${r.license.spdx_id}` : ""}`,
          fmt.italic(`last push ${fmt.relative(Date.parse(r.pushed_at))}`),
          r.html_url
        )
      }
      const u = await ctx.http.json<User>(`https://api.github.com/users/${target}`, opts)
      return fmt.lines(
        `🐙 ${fmt.bold(u.name ?? u.login)}${u.name ? ` (${u.login})` : ""}${u.type === "Organization" ? fmt.italic(" · organization") : ""}`,
        u.bio ? fmt.italic(fmt.truncate(u.bio, 300)) : undefined,
        `📦 ${fmt.num(u.public_repos)} repos · 👥 ${fmt.num(u.followers)} followers · since ${u.created_at.slice(0, 4)}`,
        u.html_url
      )
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return ctx.fail(`GitHub has no ${target.includes("/") ? "repository" : "user"} called ${target}.`)
      if (e instanceof HttpError && e.status === 403) return ctx.fail("GitHub's rate limit is used up for now — try again in a while.")
      throw e
    }
  },
})
