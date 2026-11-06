import {defineCommand, fmt, isActiveMember, ROLE_ORDER} from "../../../src/sdk"

export default defineCommand({
  name: "groupinfo",
  aliases: ["group", "gi"],
  description: "About this group: members, roles and my settings here",
  category: "Groups",
  scope: "group",
  cooldown: 5,
  async run(ctx) {
    const g = ctx.group!
    const members = (await ctx.members()).filter(isActiveMember)
    const byRole = [...ROLE_ORDER].reverse().map((role) => [role, members.filter((m) => m.memberRole === role).length] as const).filter(([, n]) => n > 0)
    const s = await ctx.groupData.get()
    const warned = Object.keys(s.warnings ?? {}).length
    const on = (b: boolean) => (b ? "on" : "off")
    return fmt.lines(
      `👥 ${fmt.bold(g.groupProfile.displayName)}${g.groupProfile.fullName && g.groupProfile.fullName !== g.groupProfile.displayName ? ` — ${g.groupProfile.fullName}` : ""}`,
      g.groupProfile.shortDescr ? fmt.italic(g.groupProfile.shortDescr) : undefined,
      g.groupProfile.description ? fmt.truncate(g.groupProfile.description, 300) : undefined,
      "",
      `${fmt.bold("Members:")} ${members.length + 1} ${fmt.italic(`(${byRole.map(([r, n]) => `${n} ${r}${n === 1 ? "" : "s"}`).join(", ")} + me)`)}`,
      `${fmt.bold("My role:")} ${ctx.botRole ?? "?"}${ctx.botRole === "admin" || ctx.botRole === "owner" ? "" : fmt.italic(" — make me admin for moderation commands")}`,
      `${fmt.bold("Business chat:")} ${ctx.isBusiness ? "yes" : "no"}`,
      "",
      `${fmt.bold("Rules:")} ${s.rules ? "set" : "none"} · ${fmt.bold("Welcome:")} ${on(!!s.welcome)} · ${fmt.bold("Anti-spam:")} ${on(!!s.antispam)} · ${fmt.bold("Warned:")} ${warned}`,
      ctx.ui.tappable ? "\n" + ctx.ui.buttons([ctx.ui.button("👥", "members"), ctx.ui.button("📜", "rules"), ctx.ui.button("🔗", "link")]) : undefined
    )
  },
})
