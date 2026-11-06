import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "about",
  aliases: ["info", "uptime"],
  description: "About me: uptime, version and stats",
  cooldown: 5,
  async run(ctx) {
    const {rt} = ctx
    const [contacts, groups] = await Promise.all([
      rt.chat.apiListContacts(rt.user.userId).catch(() => []),
      rt.chat.apiListGroups(rt.user.userId).catch(() => []),
    ])
    const visible = rt.commands.all().filter((c) => !c.hidden).length
    return fmt.lines(
      `💎 ${fmt.bold(ctx.config.profile.displayName)} — the first multi-purpose SimpleX Chat bot`,
      "",
      `⏱ ${fmt.bold("Uptime:")} ${fmt.duration(Date.now() - rt.startedAt.getTime())}`,
      `🧩 ${fmt.bold("Commands:")} ${visible} · ${fmt.num(rt.stats.commandsRun)} run since start`,
      `👥 ${fmt.bold("Chats:")} ${fmt.plural(contacts.length, "contact")} · ${fmt.plural(groups.length, "group")}`,
      `📦 ${fmt.bold("Versions:")} Rubi ${rt.versions.rubi} · simplex-chat ${rt.versions.simplex} · Node ${rt.versions.node}`,
      "",
      ctx.ui.buttons([ctx.ui.button("📖", "help", undefined, {important: true}), ctx.ui.button("🔗", "invite"), ctx.ui.button("🏓", "ping")])
    )
  },
})
