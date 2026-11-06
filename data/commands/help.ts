import {
  CATEGORIES,
  categoryIcon,
  CommandRegistry,
  defineCommand,
  fmt,
  PERMISSION_LABEL,
  T,
  type ArgDef,
  type Command,
  type CommandContext,
} from "../../src/sdk"

/**
 * /help            — compact overview: every category with the commands you can use here
 * /help <category> — that category's commands with descriptions
 * /help <command>  — usage, arguments, aliases, examples, permissions for one command
 *
 * Fully dynamic: it reads the command registry, so new files in data/commands show up automatically
 * (and only for people allowed to run them in the current chat). Commands are tappable in DMs; in groups
 * without a /groupmenu they're shown as `code`.
 */
export default defineCommand({
  name: "help",
  aliases: ["h", "commands", "start"],
  description: "List commands, or show details for one",
  details: "/help lists categories and commands; /help <category> adds descriptions; /help <command> shows everything about one command.",
  category: "General",
  args: [{name: "command", type: "string", description: "A command or category to show details for"}],
  examples: ["help", "help utility", "help remind"],
  cooldown: 2,
  run(ctx) {
    const query = ctx.args.command?.replace(/^['"]|['"]$/g, "").replace(/^\//, "").trim()
    return query ? lookup(ctx, query) : overview(ctx)
  },
})

function overview(ctx: CommandContext<any>): string {
  const reg = ctx.rt.commands
  const ui = ctx.ui
  const available = reg.available(ctx)
  const locked = reg.all().filter((c) => !c.hidden && ctx.inScope(c.scope) && !ctx.can(c.permission))
  const elsewhere = reg.all().filter((c) => !c.hidden && !ctx.inScope(c.scope) && ctx.can(c.permission))

  const sections = [...CommandRegistry.byCategory(available)].map(([cat, cmds]) =>
    fmt.lines(`${categoryIcon(cat)} ${fmt.bold(cat)} · ${ui.cmd("help", cat.toLowerCase())}`, cmds.map((c) => ui.cmd(c.name)).join(ui.tappable ? "  " : " "))
  )

  const one = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm)
  const notes: string[] = [fmt.plural(available.length, "command") + (ctx.isGroup ? " available here" : "")]
  if (locked.length) notes.push(`${locked.length} more ${one(locked.length, "needs", "need")} a group role you don't have here`)
  if (elsewhere.length) notes.push(`${elsewhere.length} more ${one(elsewhere.length, "works", "work")} ${ctx.isGroup ? "in DMs" : "in groups"}`)

  const roleLine =
    ctx.isGroup && ctx.sender.role
      ? `You're ${article(ctx.sender.role)} ${fmt.bold(ctx.sender.role)} in ${fmt.bold(ctx.group!.groupProfile.displayName)}${ctx.isBotAdmin ? " and a bot admin" : ""}.`
      : ctx.isBotAdmin
        ? "You're a bot admin — every command is unlocked for you."
        : undefined
  const menuTip =
    ctx.isGroup && !ui.tappable && ctx.hasRole(T.GroupMemberRole.Owner)
      ? fmt.italic(`Tip: make me a group owner and send ${ui.cmd("groupmenu")} to make commands tappable here.`)
      : undefined

  return fmt.lines(
    `💎 ${fmt.bold(ctx.config.profile.displayName)} — commands`,
    fmt.italic(
      ui.tappable
        ? "Tap a command to run it, or a category to see what each one does."
        : `Send ${ui.cmd("help", "<category>")} for descriptions or ${ui.cmd("help", "<command>")} for details.`
    ),
    "",
    sections.length ? sections.join("\n\n") : fmt.italic("No commands available here."),
    "",
    roleLine,
    fmt.italic(notes.join(" · ")),
    menuTip
  )
}

function commandLine(ctx: CommandContext<any>, c: Command): string {
  const required = c.args.filter((a) => a.required)
  const params = required.length ? ` ${fmt.italic(required.map((a) => `<${a.name}>`).join(" "))}` : ""
  const badge = c.permission !== "everyone" ? ` · ${fmt.italic(PERMISSION_LABEL[c.permission].toLowerCase())}` : ""
  return `${ctx.ui.cmd(c.name)}${params} — ${c.description}${badge}`
}

function lookup(ctx: CommandContext<any>, query: string): string {
  const reg = ctx.rt.commands
  const ui = ctx.ui
  const cmd = reg.get(query)
  if (cmd && (!cmd.hidden || ctx.isBotAdmin)) return details(ctx, cmd)

  const cat = [...new Set(reg.all().map((c) => c.category))].find((c) => c.toLowerCase() === query.toLowerCase())
  if (cat) {
    const cmds = reg.available(ctx).filter((c) => c.category === cat)
    const info = CATEGORIES.find((c) => c.name === cat)?.description
    return fmt.lines(
      `${categoryIcon(cat)} ${fmt.bold(cat)}${info ? ` — ${fmt.italic(info)}` : ""}`,
      "",
      cmds.length ? cmds.map((c) => commandLine(ctx, c)).join("\n") : fmt.italic("None of these are available to you here."),
      "",
      `Details: ${ui.cmd("help", "<command>")} · All: ${ui.cmd("help")}`
    )
  }

  const guess = reg.suggest(query, reg.available(ctx))
  return fmt.lines(
    `❓ No command or category called ${fmt.code(query)}.`,
    guess ? `Did you mean ${ui.cmd("help", guess.name)}?` : `See ${ui.cmd("help")} for the full list.`
  )
}

function details(ctx: CommandContext<any>, c: Command): string {
  const p = ctx.config.prefix
  const ui = ctx.ui
  const usage = `${p}${c.name}${c.args.length ? " " + c.args.map(argUsage).join(" ") : ""}`
  const restriction = !ctx.inScope(c.scope)
    ? `🚫 ${scopeLabel(c.scope)} — you can't use it in this chat.`
    : !ctx.can(c.permission)
      ? `🔒 Only for ${PERMISSION_LABEL[c.permission].toLowerCase()} — you can't use it here.`
      : undefined

  return fmt.lines(
    `${categoryIcon(c.category)} ${c.category} › ${fmt.bold(p + c.name)}`,
    c.description,
    c.details && c.details !== c.description ? `\n${c.details}` : undefined,
    restriction && `\n${restriction}`,
    "",
    `${fmt.bold("Usage:")} ${fmt.code(usage)}`,
    c.args.length ? fmt.lines(fmt.bold("Arguments:"), ...c.args.map(argLine)) : undefined,
    c.aliases.length ? `${fmt.bold("Aliases:")} ${c.aliases.map((a) => fmt.code(p + a)).join(", ")}` : undefined,
    c.examples.length ? `${fmt.bold("Examples:")} ${c.examples.map((e) => example(ctx, e)).join("  ")}` : undefined,
    `${fmt.bold("Where:")} ${scopeLabel(c.scope)}`,
    `${fmt.bold("Who:")} ${PERMISSION_LABEL[c.permission]}`,
    c.botRole ? `${fmt.bold("Needs me to be:")} group ${c.botRole}` : undefined,
    `${fmt.bold("Cooldown:")} ${fmt.duration((c.cooldown ?? ctx.config.limits.defaultCooldown) * 1000)}`,
    c.live ? `${fmt.bold("Live reply:")} yes — the answer appears in place as it's ready` : undefined,
    c.hidden ? fmt.italic("(hidden command)") : undefined,
    "",
    `${c.category}: ${ui.cmd("help", c.category.toLowerCase())} · All: ${ui.cmd("help")}`
  )
}

function argUsage(a: ArgDef): string {
  const inner = a.choices ? a.choices.join("|") : a.name + (a.type === "text" ? "..." : "")
  return a.required ? `<${inner}>` : `[${inner}]`
}

function argLine(a: ArgDef): string {
  const type = a.choices ? `one of ${a.choices.map((c) => fmt.code(c)).join(", ")}` : TYPE_LABEL[a.type]
  const range = a.min !== undefined || a.max !== undefined ? ` (${a.min ?? "…"}–${a.max ?? "…"})` : ""
  return `• ${fmt.code(a.name)} — ${a.description} ${fmt.italic(`${type}${range}${a.required ? "" : ", optional"}`)}`
}

const TYPE_LABEL: Record<ArgDef["type"], string> = {
  string: "word or \"quoted text\"",
  text: "text",
  integer: "whole number",
  number: "number",
  boolean: "yes/no",
  member: "group member (@mention or name)",
}

function scopeLabel(scope: Command["scope"]): string {
  return scope === "group" ? "Groups only" : scope === "direct" ? "Direct messages only" : "DMs and groups"
}

/** "help ping" → tappable /'help ping' in DMs, `/help ping` in groups */
function example(ctx: CommandContext<any>, e: string): string {
  const [name = "", ...rest] = e.replace(/^\//, "").split(" ")
  return ctx.ui.cmd(name, rest.join(" "))
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a")
