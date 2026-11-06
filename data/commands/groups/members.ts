import {defineCommand, fmt, isActiveMember, roleRank, type T} from "../../../src/sdk"

const ICON: Record<string, string> = {owner: "👑", admin: "🛡", moderator: "🔧", member: "👤", author: "✍️", observer: "👁", relay: "📡"}

export default defineCommand({
  name: "members",
  aliases: ["who", "roster"],
  description: "List group members and their roles",
  category: "Groups",
  scope: "group",
  cooldown: 5,
  async run(ctx) {
    const g = ctx.group!
    const all: T.GroupMember[] = [g.membership, ...(await ctx.members())]
    const list = all
      .filter((m) => isActiveMember(m) || m.groupMemberId === g.membership.groupMemberId)
      .sort((a, b) => roleRank(b.memberRole) - roleRank(a.memberRole) || a.memberProfile.displayName.localeCompare(b.memberProfile.displayName))
    const pending = all.filter((m) => !isActiveMember(m) && m.groupMemberId !== g.membership.groupMemberId && /invited|pending|accepted|announced/.test(m.memberStatus)).length
    await ctx.paginate({
      title: `👥 ${fmt.bold(g.groupProfile.displayName)} — ${fmt.plural(list.length, "member")}`,
      items: list.map((m) => {
        const me = m.groupMemberId === g.membership.groupMemberId ? fmt.italic(" (me)") : ""
        const blocked = m.blockedByAdmin ? " 🚫" : ""
        return `${ICON[m.memberRole] ?? "•"} ${m.memberProfile.displayName}${me}${blocked} ${fmt.italic(`${m.memberRole} · #${m.groupMemberId}`)}`
      }),
      perPage: 20,
      footer: pending ? fmt.italic(`+ ${pending} still joining`) : undefined,
    })
  },
})
