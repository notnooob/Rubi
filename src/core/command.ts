import type {T} from "@simplex-chat/types"
import type {ArgDef, ParsedArgs} from "./args"
import type {CommandContext} from "./context"
import type {Permission} from "./permissions"

/**
 * Where a command can be used.
 * - `any`    — DMs and groups (default)
 * - `direct` — DMs only (business chats count as DMs: they are 1:1 chats with the bot's business)
 * - `group`  — groups only
 */
export type CommandScope = "any" | "direct" | "group"

/** What a command's `run` may return. A string/MsgContent is sent as the reply (or finalizes the live reply). */
export type CommandResult = string | T.MsgContent | void | undefined

export interface CommandDefinition<As extends readonly ArgDef[] = readonly ArgDef[]> {
  /** Keyword without the slash: lowercase letters, digits, `_`. */
  name: string
  /** Extra keywords that run the same command. */
  aliases?: readonly string[]
  /** One line, shown in /help and as the label in the app's command menu. */
  description: string
  /** Longer explanation, shown in /help <command>. */
  details?: string
  /** Help/menu section. Defaults to the subfolder name in data/commands, or "General". */
  category?: string
  /** Typed arguments, parsed and validated before `run`. Available as `ctx.args`. */
  args?: As
  /** Example invocations without the slash, e.g. "help ping". Shown as tappable commands. */
  examples?: readonly string[]
  scope?: CommandScope
  /** Who may run it (default `everyone`). Group admins are identified by their member role. */
  permission?: Permission
  /** Minimum role the *bot* needs in the group (e.g. `admin` to remove members). */
  botRole?: T.GroupMemberRole
  /** Per-user cooldown in seconds (default RUBI_DEFAULT_COOLDOWN). Bot admins are exempt. */
  cooldown?: number
  /** Seconds before the command is aborted (`ctx.signal`) and the user is told it timed out. 0 = never. */
  timeout?: number
  /** Not listed in /help or the app menu (still runnable). */
  hidden?: boolean
  /** Show in the SimpleX app command menu (default true for everyone-commands that aren't group-only). */
  menu?: boolean
  /**
   * Live (deferred) reply: before `run`, immediately post a live placeholder message
   * (`true` → "⏳ Working on /name", or your own text). It shows elapsed time while running, and
   * `ctx.reply()` / the returned value replace it with the result. Don't end live texts with "…":
   * the apps already animate "..." after live messages.
   */
  live?: boolean | string
  run(ctx: CommandContext<ParsedArgs<As>>): CommandResult | Promise<CommandResult>
}

/** A loaded, normalized command. */
export interface Command {
  name: string
  aliases: readonly string[]
  description: string
  details?: string
  category: string
  args: readonly ArgDef[]
  examples: readonly string[]
  scope: CommandScope
  permission: Permission
  botRole?: T.GroupMemberRole
  cooldown?: number
  timeout?: number
  hidden: boolean
  menu: boolean
  live: false | string
  run(ctx: CommandContext<any>): CommandResult | Promise<CommandResult>
  /** File it was loaded from. */
  file: string
}

/**
 * Declare a command. `export default defineCommand({...})` from a file in data/commands.
 * `const` inference makes `ctx.args` fully typed from the `args` array.
 */
export function defineCommand<const As extends readonly ArgDef[] = []>(def: CommandDefinition<As>): CommandDefinition<As> {
  return def
}
