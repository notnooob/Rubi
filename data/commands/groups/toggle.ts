import {defineCommand, describeError, fmt, groupMenuBudget, modLog, T, type Command, type CommandContext} from "../../../src/sdk"

/** Commands that can't be turned off: the help, this switch, and hidden button targets (they're checked separately). */
const ALWAYS_ON = new Set(["help", "toggle"])

export default defineCommand({
  name: "toggle",
  description: "Turn commands on or off in this group (admins)",
  details:
    "Name commands or whole categories, separated by commas or spaces: /toggle off fun turns off every Fun command. " +
    "Turned-off commands don't run here (for anyone, admins included), disappear from /help and from the group's " +
    "/ menu. /help and /toggle can't be turned off. /toggle alone lists what's off.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [
    {name: "state", type: "string", description: "on or off", choices: ["on", "off"]},
    {name: "commands", type: "text", description: "Commands or categories"},
  ],
  examples: ["toggle off fun", "toggle off trivia, joke", "toggle on trivia", "toggle"],
  async run(ctx) {
    const {state, commands} = ctx.args
    const off = (await ctx.groupData.get()).disabled ?? []
    if (!state) {
      return off.length
        ? fmt.lines(`🔌 ${fmt.bold(fmt.plural(off.length, "command"))} turned off here:`, off.map((n) => fmt.code(n)).join(" "), "", `Turn on again: ${ctx.ui.cmd("toggle", `on ${off[0]}`)}`)
        : `🔌 Every command is on. Turn some off: ${ctx.ui.cmd("toggle", "off fun")}`
    }
    if (!commands) return ctx.usageError(`Name commands or categories: ${fmt.code(`/toggle ${state} fun, wiki`)}`)

    const {found, unknown, locked} = resolve(ctx, commands)
    if (!found.length) {
      return ctx.fail(fmt.lines(unknown.length ? `I don't know ${unknown.map((u) => fmt.code(u)).join(", ")}.` : undefined, locked.length ? `${locked.map((n) => fmt.code(n)).join(", ")} can't be turned off.` : undefined))
    }
    const names = found.map((c) => c.name)
    const next = state === "off" ? [...new Set([...off, ...names])].sort() : off.filter((n) => !names.includes(n))
    await ctx.groupData.update((s) => {
      if (next.length) s.disabled = next
      else delete s.disabled
    })
    void modLog(ctx.rt, ctx.group!, `${ctx.sender.displayName} turned ${state} ${names.join(", ")}`)
    const menu = await refreshGroupMenu(ctx, next)
    return fmt.lines(
      `🔌 Turned ${fmt.bold(state)}: ${names.map((n) => fmt.code(n)).join(" ")}`,
      unknown.length > 0 && `Unknown: ${unknown.map((u) => fmt.code(u)).join(", ")}`,
      locked.length > 0 && `Always on: ${locked.map((n) => fmt.code(n)).join(", ")}`,
      menu && fmt.italic("The group's / menu was updated too.")
    )
  },
})

/** "fun, wiki /r" → commands (categories expand to their commands; aliases resolve). */
function resolve(ctx: CommandContext<any>, input: string): {found: Command[]; unknown: string[]; locked: string[]} {
  const reg = ctx.rt.commands
  const found = new Map<string, Command>()
  const unknown: string[] = []
  const locked: string[] = []
  const canToggle = (c: Command) => !ALWAYS_ON.has(c.name) && !c.hidden
  for (const raw of input.split(/[\s,;]+/).filter(Boolean)) {
    const word = raw.replace(/^\//, "").toLowerCase()
    const cmd = reg.get(word)
    if (cmd) {
      if (canToggle(cmd)) found.set(cmd.name, cmd)
      else locked.push(cmd.name)
      continue
    }
    // a whole category; its always-on commands are skipped quietly
    const inCategory = reg.all().filter((c) => c.category.toLowerCase() === word)
    if (!inCategory.length) unknown.push(raw)
    for (const c of inCategory.filter(canToggle)) found.set(c.name, c)
  }
  return {found: [...found.values()], unknown, locked}
}

/** If this group has Rubi's command menu (/groupmenu), rebuild it without the turned-off commands. */
async function refreshGroupMenu(ctx: CommandContext<any>, disabled: string[]): Promise<boolean> {
  const g = ctx.group!
  if (!g.groupProfile.groupPreferences?.commands?.length || !ctx.botHasRole(T.GroupMemberRole.Owner)) return false
  const commands = ctx.rt.commands.menu({forGroup: true, maxBytes: groupMenuBudget(g.groupProfile), exclude: disabled})
  try {
    await ctx.chat.apiUpdateGroupProfile(g.groupId, {...g.groupProfile, groupPreferences: {...g.groupProfile.groupPreferences, commands}})
    return true
  } catch (e) {
    ctx.log.warn(`toggle: could not update the group menu: ${describeError(e)}`)
    return false
  }
}
