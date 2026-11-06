import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "stats",
  description: "Bot statistics: usage, memory, jobs",
  category: "Admin",
  permission: "botAdmin",
  async run(ctx) {
    const {rt} = ctx
    const top = [...rt.stats.perCommand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    const mem = process.memoryUsage()
    const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`
    const [contacts, groups] = await Promise.all([
      rt.chat.apiListContacts(rt.user.userId).catch(() => []),
      rt.chat.apiListGroups(rt.user.userId).catch(() => []),
    ])
    const jobs = rt.scheduler.list()
    const byKind = Object.entries(jobs.reduce<Record<string, number>>((m, j) => ((m[j.kind] = (m[j.kind] ?? 0) + 1), m), {}))
    return fmt.lines(
      `📈 ${fmt.bold("Stats")}`,
      `⏱ Uptime ${fmt.duration(Date.now() - rt.startedAt.getTime())} · since ${rt.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      `🧩 ${fmt.num(rt.stats.commandsRun)} commands run · ${fmt.num(rt.stats.commandsFailed)} crashed`,
      `👥 ${contacts.length} contacts · ${groups.length} groups`,
      `🗓 ${fmt.plural(jobs.length, "scheduled job")}${byKind.length ? ` (${byKind.map(([k, n]) => `${n} ${k}`).join(", ")})` : ""}`,
      `💾 ${mb(mem.rss)} RSS · ${mb(mem.heapUsed)} heap`,
      "",
      top.length ? fmt.bold("Most used:") : fmt.italic("No commands run yet."),
      ...top.map(([name, n], i) => `${i + 1}. /${name} — ${fmt.num(n)}`)
    )
  },
})
