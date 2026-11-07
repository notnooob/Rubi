import {readdirSync, statSync} from "node:fs"
import path from "node:path"
import type {T} from "@simplex-chat/types"
import {usageParams} from "./args"
import {categoryIcon, categoryRank, DEFAULT_CATEGORY, normalizeCategory} from "./categories"
import type {Command, CommandDefinition} from "./command"
import type {CommandContext} from "./context"
import type {Logger} from "./logger"
import {PERMISSION_ORDER} from "./permissions"

const KEYWORD = /^[\p{Ll}\p{Lo}\p{N}_]+$/u
const SOURCE_EXT = /\.(ts|js|cts|cjs)$/
const SKIP = /(\.d\.ts|\.map|\.test\.(ts|js))$/

/** Is `file` a loadable module (not a template/hidden/declaration file)? */
function isModule(name: string): boolean {
  return SOURCE_EXT.test(name) && !SKIP.test(name) && !name.startsWith("_") && !name.startsWith(".")
}

/** Recursively list loadable modules; returns [file, subfolder path relative to root]. */
export function listModules(root: string): [string, string[]][] {
  const out: [string, string[]][] = []
  const walk = (dir: string, rel: string[]) => {
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith("_") || name.startsWith(".")) continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full, [...rel, name])
      else if (isModule(name)) out.push([full, rel])
    }
  }
  walk(root, [])
  return out
}

/** `require` a module fresh (clears the require cache so reloads pick up edits). */
export function loadModule(file: string): unknown {
  const resolved = require.resolve(file)
  delete require.cache[resolved]
  const mod = require(resolved)
  return mod?.default ?? mod
}

/**
 * Loads every command file in data/commands (recursively) and indexes names + aliases.
 * Broken files are logged and skipped so one bad command doesn't take the bot down.
 */
export class CommandRegistry {
  private commands: Command[] = []
  private byKeyword = new Map<string, Command>()

  constructor(
    readonly dir: string,
    private readonly log: Logger
  ) {}

  /** (Re)load all commands. Returns the number loaded and any per-file errors. */
  load(): {loaded: number; errors: string[]} {
    const errors: string[] = []
    const commands: Command[] = []
    const byKeyword = new Map<string, Command>()

    for (const [file, rel] of listModules(this.dir)) {
      const short = path.relative(this.dir, file)
      try {
        const cmd = normalize(loadModule(file), file, rel)
        for (const kw of [cmd.name, ...cmd.aliases]) {
          const clash = byKeyword.get(kw)
          if (clash) throw new Error(`keyword "/${kw}" already used by /${clash.name} (${path.relative(this.dir, clash.file)})`)
        }
        commands.push(cmd)
        for (const kw of [cmd.name, ...cmd.aliases]) byKeyword.set(kw, cmd)
      } catch (e) {
        const msg = `${short}: ${(e as Error).message}`
        errors.push(msg)
        this.log.error(`failed to load command ${msg}`)
      }
    }

    commands.sort(compareCommands)
    this.commands = commands
    this.byKeyword = byKeyword
    this.log.info(`loaded ${commands.length} command(s): ${commands.map((c) => "/" + c.name).join(" ") || "(none)"}`)
    return {loaded: commands.length, errors}
  }

  /** Register a command programmatically (plugins, tests). Throws on keyword clashes. */
  register(def: CommandDefinition<any>, source = "<inline>"): Command {
    const cmd = normalize(def, source, [])
    for (const kw of [cmd.name, ...cmd.aliases]) {
      const clash = this.byKeyword.get(kw)
      if (clash) throw new Error(`keyword "/${kw}" already used by /${clash.name}`)
    }
    this.commands.push(cmd)
    this.commands.sort(compareCommands)
    for (const kw of [cmd.name, ...cmd.aliases]) this.byKeyword.set(kw, cmd)
    return cmd
  }

  /** Look up by name or alias (case-insensitive). */
  get(keyword: string): Command | undefined {
    return this.byKeyword.get(keyword.toLowerCase())
  }

  /** All commands, sorted by category then name. */
  all(): readonly Command[] {
    return this.commands
  }

  /** Commands the sender can see and run in this chat (not hidden, right scope, enough permission). */
  available(ctx: CommandContext<any>): Command[] {
    return this.commands.filter((c) => !c.hidden && ctx.inScope(c.scope) && ctx.can(c.permission))
  }

  /** Commands grouped by category, preserving sort order. */
  static byCategory(cmds: readonly Command[]): Map<string, Command[]> {
    const m = new Map<string, Command[]>()
    for (const c of cmds) {
      const list = m.get(c.category) ?? []
      list.push(c)
      m.set(c.category, list)
    }
    return m
  }

  /** Closest keyword (name or alias) among `pool`, for "did you mean". */
  suggest(keyword: string, pool: readonly Command[] = this.commands): Command | undefined {
    const k = keyword.toLowerCase()
    let best: {cmd: Command; d: number} | undefined
    for (const cmd of pool) {
      for (const kw of [cmd.name, ...cmd.aliases]) {
        // typing the start of a command ("/hel") counts as close
        const d = k.length >= 2 && kw.startsWith(k) ? (kw.length - k.length) * 0.5 : editDistance(k, kw)
        if (!best || d < best.d) best = {cmd, d}
      }
    }
    const limit = Math.max(1, Math.floor(k.length / 3))
    return best && best.d <= limit ? best.cmd : undefined
  }

  /**
   * Command menu shown by SimpleX apps (the "/" button and autocomplete) — DM-visible,
   * everyone-commands only. Grouped into per-category submenus when there are many.
   */
  menu(opts: {forGroup?: boolean; maxBytes?: number} = {}): T.ChatBotCommand[] {
    return this.menuWithin(opts).menu
  }

  /**
   * The menu, shrunk to fit `maxBytes` (as JSON) if needed. The menu travels inside the bot/group profile, which
   * SimpleX caps (see `src/core/profile.ts`), so it degrades step by step: without parameter hints, with shorter
   * labels, with bare keywords, and as a last resort without the last commands. `level` says how far it went.
   */
  menuWithin(opts: {forGroup?: boolean; maxBytes?: number} = {}): {menu: T.ChatBotCommand[]; level: MenuLevel; dropped: number} {
    // DM menu: no group-only commands. Group menu (/groupmenu): no DM-only commands.
    const excluded = opts.forGroup ? "direct" : "group"
    const visible = this.commands.filter((c) => c.menu && !c.hidden && c.permission === "everyone" && c.scope !== excluded)
    const build = (cmds: Command[], level: MenuLevel): T.ChatBotCommand[] => {
      const item = (c: Command): T.ChatBotCommand => {
        const required = c.args.filter((a) => a.required)
        const label = level === "keywords" ? c.name : menuLabel(c.description, level === "short-labels" ? 22 : 40)
        return {type: "command", keyword: c.name, label, ...(required.length && level === "full" ? {params: usageParams(required)} : {})}
      }
      if (cmds.length <= 10) return cmds.map(item)
      return [...CommandRegistry.byCategory(cmds)].map(([cat, list]) => ({
        type: "menu",
        label: `${categoryIcon(cat)} ${cat}`,
        commands: list.map(item),
      }))
    }
    const fits = (m: T.ChatBotCommand[]) => opts.maxBytes === undefined || Buffer.byteLength(JSON.stringify(m)) <= opts.maxBytes
    for (const level of MENU_LEVELS) {
      const menu = build(visible, level)
      if (fits(menu)) return {menu, level, dropped: 0}
    }
    // still too big: leave out commands from the end (least important categories come last)
    const cmds = [...visible]
    while (cmds.length > 1) {
      cmds.pop()
      const menu = build(cmds, "keywords")
      if (fits(menu)) return {menu, level: "keywords", dropped: visible.length - cmds.length}
    }
    return {menu: [], level: "keywords", dropped: visible.length}
  }
}

/** How much the menu had to shrink to fit the profile: full → no params → short labels → keywords only. */
export type MenuLevel = "full" | "no-params" | "short-labels" | "keywords"
const MENU_LEVELS: MenuLevel[] = ["full", "no-params", "short-labels", "keywords"]

/**
 * Short menu label: the description without its inline example ("Start a poll: /poll …" → "Start a poll")
 * or a trailing "(…)" note. The menu lives in the bot/group profile, which also carries the avatar and
 * must fit in one SimpleX message (~15 KB), so labels are kept short.
 */
export function menuLabel(description: string, max = 40): string {
  const label = description
    .replace(/:\s*\/.*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label
}

function compareCommands(a: Command, b: Command): number {
  return categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
}

function normalize(raw: unknown, file: string, rel: string[]): Command {
  const def = raw as CommandDefinition
  if (!def || typeof def !== "object") throw new Error("no default export (use `export default defineCommand({...})`)")
  if (typeof def.name !== "string" || !def.name) throw new Error("missing `name`")
  if (typeof def.description !== "string" || !def.description) throw new Error(`/${def.name}: missing \`description\``)
  if (typeof def.run !== "function") throw new Error(`/${def.name}: missing \`run\` function`)

  const name = def.name.toLowerCase()
  const aliases = [...new Set((def.aliases ?? []).map((a) => a.toLowerCase()))].filter((a) => a !== name)
  for (const kw of [name, ...aliases]) {
    if (!KEYWORD.test(kw)) throw new Error(`invalid keyword "${kw}" (use lowercase letters, digits and _)`)
  }

  const args = def.args ?? []
  const seen = new Set<string>()
  args.forEach((a, i) => {
    if (seen.has(a.name)) throw new Error(`/${name}: duplicate argument "${a.name}"`)
    seen.add(a.name)
    if (a.type === "text" && i !== args.length - 1) throw new Error(`/${name}: "text" argument "${a.name}" must be last`)
    if (a.required && args.slice(0, i).some((p) => !p.required)) throw new Error(`/${name}: required argument "${a.name}" after an optional one`)
  })

  const permission = def.permission ?? "everyone"
  if (!PERMISSION_ORDER.includes(permission)) throw new Error(`/${name}: unknown permission "${permission}"`)

  // no trailing "…" — the apps animate "..." after live messages
  const live = def.live === true ? `⏳ Working on /${name}` : typeof def.live === "string" && def.live ? def.live : false
  const scope = def.scope ?? "any"

  return {
    name,
    aliases,
    description: def.description,
    details: def.details,
    category: normalizeCategory(def.category ?? (rel[0] ? rel[0] : DEFAULT_CATEGORY)),
    args,
    examples: def.examples ?? [],
    scope,
    permission,
    botRole: def.botRole,
    cooldown: def.cooldown,
    timeout: def.timeout,
    hidden: def.hidden ?? false,
    menu: def.menu ?? true,
    live,
    run: def.run as Command["run"],
    file,
  }
}

/** Edit distance counting adjacent swaps as one edit ("hepl" → "help" = 1). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const d: number[][] = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
    }
  }
  return d[a.length]![b.length]!
}
