import type {CEvt, T} from "@simplex-chat/types"
import {chatKey, chatName, chatRefOf, itemText} from "../util/chat"
import * as fmt from "../util/format"
import {uiFor} from "../util/ui"
import type {Command, CommandResult} from "./command"
import {CommandContext, senderOf} from "./context"
import {parseArgs} from "./args"
import {
  CommandError,
  CooldownError,
  PermissionError,
  ScopeError,
  TimeoutError,
  UsageError,
  describeError,
  errorRef,
} from "./errors"
import type {Logger} from "./logger"
import {PERMISSION_LABEL, permissionRole} from "./permissions"
import type {Runtime} from "./runtime"

export interface ParsedCommand {
  keyword: string
  rawArgs: string
}

/** `/keyword args...` → {keyword, rawArgs}. Also unwraps the tappable `/'keyword args'` form. */
export function parseCommand(text: string, prefix = "/"): ParsedCommand | undefined {
  let t = text.trim()
  if (!t.startsWith(prefix)) return undefined
  t = t.slice(prefix.length)
  const quoted = t.match(/^'([^']+)'$/)
  if (quoted) t = quoted[1]!.trim()
  const m = t.match(/^(\S+)([\s\S]*)$/)
  if (!m) return undefined
  const keyword = m[1]!.toLowerCase()
  // "/path/to/file" or "/ hello" are not commands
  if (!/^[\p{L}\p{N}_]+$/u.test(keyword)) return undefined
  return {keyword, rawArgs: m[2]!.trim()}
}

const isIncomingMessage = (ci: T.AChatItem): boolean =>
  ci.chatItem.content.type === "rcvMsgContent" &&
  (ci.chatItem.chatDir.type === "directRcv" || ci.chatItem.chatDir.type === "groupRcv") &&
  !ci.chatItem.meta.itemDeleted

/**
 * The message @mentions Rubi explicitly. Not `meta.userMention`: chat core also sets that flag for *replies*
 * to Rubi's messages (`userMention = userReply || mentioned`), and quoting a bot reply isn't talking to the bot.
 */
function mentionsBot(groupInfo: T.GroupInfo, item: T.ChatItem): boolean {
  const me = groupInfo.membership
  return Object.values(item.mentions ?? {}).some((m) => m.memberId === me.memberId || m.memberRef?.groupMemberId === me.groupMemberId)
}

const itemKey = (ci: T.AChatItem): string => {
  const ref = chatRefOf(ci.chatInfo)
  return `${ref?.chatType}:${ref?.chatId}:${ci.chatItem.meta.itemId}`
}

/**
 * Turns incoming messages into command runs:
 * parse → lookup → scope/permission/bot-role checks → anti-flood/cooldown → args → (live placeholder)
 * → run with timeout → reply → error handling.
 *
 * Commands run concurrently and are NOT awaited by the event handler, so a slow command never
 * blocks the library's event loop.
 */
export class Dispatcher {
  private readonly log: Logger
  private readonly inFlight = new Set<CommandContext<any>>()
  /** Users' live messages still being typed — handled when they are finalized. */
  private readonly typing = new Set<string>()
  private accepting = true
  private missed = 0
  private missedTimer: NodeJS.Timeout | undefined

  constructor(private readonly rt: Runtime) {
    this.log = rt.log.child("dispatch")
  }

  get activeCount(): number {
    return this.inFlight.size
  }

  readonly onNewChatItems = (evt: CEvt.NewChatItems): void => {
    for (const ci of evt.chatItems) this.consider(ci)
  }

  /** A user's live message ("typing" mode) is finalized via an update: treat it as a new message then. */
  readonly onChatItemUpdated = (evt: CEvt.ChatItemUpdated): void => {
    const ci = evt.chatItem
    const key = itemKey(ci)
    if (this.typing.has(key) && !ci.chatItem.meta.itemLive) {
      this.typing.delete(key)
      this.consider(ci)
    }
  }

  private consider(ci: T.AChatItem): void {
    if (!this.accepting || !isIncomingMessage(ci)) return
    if (ci.chatItem.meta.itemLive) {
      // live messages deleted before they're finished never come back, so don't let the set grow forever
      if (this.typing.size > 10_000) this.typing.clear()
      this.typing.add(itemKey(ci))
      return
    }
    const dir = ci.chatItem.chatDir
    if (dir.type === "groupRcv" && dir.groupMember.blockedByAdmin) return

    const text = itemText(ci.chatItem)?.trim()
    if (!text) return
    // itemTs of a received message is the relay server's time, so a clock-skewed sender can't dodge this
    if (this.rt.config.replies.skipMissedCommands && Date.parse(ci.chatItem.meta.itemTs) < this.rt.startedAt.getTime()) {
      if (parseCommand(text, this.rt.config.prefix)) this.countMissed()
      return
    }

    // a running command waiting for this user's answer (ctx.awaitReply / ctx.confirm) gets it first
    const ref = chatRefOf(ci.chatInfo)
    if (ref && this.rt.prompts.offer(`${chatKey(ref)}|${senderOf(ci).key}`, ci, text)) return

    const parsed = parseCommand(text, this.rt.config.prefix)
    if (!parsed) {
      void this.nonCommand(ci).catch((e) => this.log.warn("hint reply failed:", describeError(e)))
      return
    }
    void this.execute(ci, parsed)
  }

  /** Missed commands arrive in a burst after startup: log one total once it's quiet for a few seconds. */
  private countMissed(): void {
    this.missed++
    clearTimeout(this.missedTimer)
    this.missedTimer = setTimeout(() => {
      this.log.info(`skipped ${this.missed} command(s) sent while I was offline (RUBI_SKIP_MISSED_COMMANDS)`)
      this.missed = 0
    }, 5_000)
    this.missedTimer.unref()
  }

  /** Hints for plain messages: in DMs, and in groups when the bot is @mentioned. */
  private async nonCommand(ci: T.AChatItem): Promise<void> {
    const ref = chatRefOf(ci.chatInfo)
    if (!ref) return
    const {prefix, replies} = this.rt.config
    const help = uiFor(ci.chatInfo, prefix).cmd("help")
    if (ci.chatInfo.type === "direct") {
      if (!replies.nonCommandHintInDirect) return
      if (!this.rt.limiter.throttle(`hint:c${ci.chatInfo.contact.contactId}`, 60_000)) return
      await this.rt.messenger.send(ref, `I only understand commands. Send ${help} to see them.`, {quote: ci.chatItem.meta.itemId})
    } else if (ci.chatInfo.type === "group" && replies.mentionHintInGroups && mentionsBot(ci.chatInfo.groupInfo, ci.chatItem)) {
      if (!this.rt.limiter.throttle(`hint:g${ci.chatInfo.groupInfo.groupId}`, 30_000)) return
      await this.rt.messenger.send(ref, `👋 Hi! Send ${help} to see what I can do.`, {quote: ci.chatItem.meta.itemId})
    }
  }

  private async execute(ci: T.AChatItem, {keyword, rawArgs}: ParsedCommand): Promise<void> {
    const cmd = this.rt.commands.get(keyword)
    if (!cmd) return this.unknown(ci, keyword)

    let ctx: CommandContext<any>
    try {
      ctx = new CommandContext(this.rt, ci, cmd, keyword, rawArgs)
    } catch (e) {
      this.log.debug(`ignoring /${keyword}: ${(e as Error).message}`)
      return
    }

    this.inFlight.add(ctx)
    try {
      await this.runWithTimeout(ctx, cmd, async () => {
        await this.checkEnabled(ctx, cmd)
        this.checkAccess(ctx, cmd)
        this.checkRate(ctx, cmd)
        ctx.args = await parseArgs(cmd.args, rawArgs, (t) => ctx.resolveMember(t))
        if (cmd.live) await ctx.defer(cmd.live)
        const result = await cmd.run(ctx)
        await this.finalize(ctx, result)
      })
      this.rt.stats.commandsRun++
      this.rt.stats.perCommand.set(cmd.name, (this.rt.stats.perCommand.get(cmd.name) ?? 0) + 1)
      this.log.info(`${ctx.who} ran /${cmd.name}${keyword !== cmd.name ? ` (as /${keyword})` : ""} — ${Date.now() - ctx.startedAt}ms`)
    } catch (e) {
      await this.handleError(ctx, e)
    } finally {
      ctx.abort(new CommandError("Command finished."))
      this.inFlight.delete(ctx)
    }
  }

  /** Commands an admin turned off in this group (/toggle) don't run, for anyone. */
  private async checkEnabled(ctx: CommandContext<any>, cmd: Command): Promise<void> {
    const g = ctx.group
    if (!g || cmd.hidden) return
    const {disabled} = this.rt.data.group(g).peek()
    if (!disabled?.includes(cmd.name)) return
    // say so once per member and command every 10 minutes, then stay quiet: a turned-off game shouldn't become noise
    const tell = this.rt.limiter.throttle(`disabled:${g.groupId}:${ctx.sender.key}:${cmd.name}`, 600_000)
    if (tell) throw new ScopeError(`${this.rt.config.prefix}${cmd.name} is turned off in this group.`)
    throw new CooldownError("turned off", 0, true)
  }

  private checkAccess(ctx: CommandContext<any>, cmd: Command): void {
    const p = this.rt.config.prefix
    if (!ctx.inScope(cmd.scope)) {
      throw new ScopeError(cmd.scope === "group" ? `${p}${cmd.name} only works in groups.` : `${p}${cmd.name} only works in a direct chat with me.`)
    }
    if (!ctx.can(cmd.permission)) {
      const role = permissionRole(cmd.permission)
      throw new PermissionError(
        role && !ctx.isGroup
          ? `${p}${cmd.name} is for ${PERMISSION_LABEL[cmd.permission].toLowerCase()} — use it in a group where you have that role.`
          : `${p}${cmd.name} is only for ${PERMISSION_LABEL[cmd.permission].toLowerCase()}.`
      )
    }
    if (cmd.botRole && ctx.isGroup && !ctx.botHasRole(cmd.botRole)) {
      throw new PermissionError(`I need to be a group *${cmd.botRole}* to do that — ask an owner to change my role.`)
    }
  }

  private checkRate(ctx: CommandContext<any>, cmd: Command): void {
    if (ctx.isBotAdmin) return
    const {limits, prefix} = this.rt.config
    const flood = this.rt.limiter.flood(ctx.sender.key, limits.floodMax, limits.floodWindowMs)
    if (!flood.ok) {
      throw new CooldownError(`You're sending commands too fast — wait ${fmt.duration(flood.retryAfterMs)}.`, flood.retryAfterMs, !flood.warn)
    }
    const remaining = this.rt.limiter.cooldown(ctx.sender.key, cmd.name, cmd.cooldown ?? limits.defaultCooldown)
    if (remaining > 0) {
      throw new CooldownError(`Slow down! You can use ${prefix}${cmd.name} again in ${fmt.duration(remaining)}.`, remaining)
    }
  }

  private async runWithTimeout(ctx: CommandContext<any>, cmd: Command, operation: () => Promise<void>): Promise<void> {
    const seconds = cmd.timeout ?? this.rt.config.limits.defaultTimeout
    const run = Promise.resolve().then(operation)
    if (!seconds) return run
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new TimeoutError(`${this.rt.config.prefix}${cmd.name} took too long (over ${fmt.duration(seconds * 1000)}) and was stopped.`)
        ctx.abort(err)
        reject(err)
      }, seconds * 1000)
    })
    try {
      return await Promise.race([run, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private async finalize(ctx: CommandContext<any>, result: CommandResult): Promise<void> {
    if (ctx.signal.aborted) return
    if (typeof result === "string" ? result.length > 0 : result && typeof result === "object") {
      await ctx.deliver(result as string | T.MsgContent)
    } else if (ctx.deferred && !ctx.deferred.finished) {
      // command used defer() but never replied
      await ctx.deliver("✅ Done.")
    }
  }

  private async handleError(ctx: CommandContext<any>, e: unknown): Promise<void> {
    const {prefix, replies} = this.rt.config
    const cmd = ctx.command
    let text: string
    if (e instanceof CooldownError && e.silent) {
      await ctx.deferred?.delete().catch(() => undefined)
      return
    }
    if (e instanceof CommandError) {
      text = `${e.icon} ${e.message}`
      if (e instanceof UsageError) {
        text += `\n\n*Usage:* ${fmt.code(ctx.usage())}\n*Details:* ${ctx.ui.cmd("help", cmd.name)}`
        this.rt.limiter.reset(ctx.sender.key, cmd.name) // don't make users wait after a typo
      }
      this.log.debug(`${ctx.who} /${cmd.name}: ${e.name}: ${e.message}`)
    } else {
      this.rt.stats.commandsFailed++
      const ref = errorRef()
      this.log.error(`[${ref}] /${cmd.name} crashed for ${ctx.who}: ${describeError(e)}`, e)
      text = `💥 Something went wrong while running ${prefix}${cmd.name}. Please try again later.\n${fmt.italic(`Error ref: ${ref}`)}`
      if (ctx.isBotAdmin && replies.errorDetailsToBotAdmins) text += `\n${fmt.codeBlock(describeError(e))}`
    }
    try {
      await ctx.deliver(text)
    } catch (e2) {
      this.log.warn(`could not deliver error reply to ${ctx.who}: ${describeError(e2)}`)
    }
  }

  private async unknown(ci: T.AChatItem, keyword: string): Promise<void> {
    const {replies, prefix} = this.rt.config
    const isDirect = ci.chatInfo.type === "direct"
    if (replies.unknownCommand === "never" || (replies.unknownCommand === "direct" && !isDirect)) return
    const ref = chatRefOf(ci.chatInfo)
    if (!ref) return
    // anti-loop / anti-spam for unknown commands
    const who = ci.chatItem.chatDir.type === "groupRcv" ? `g${ref.chatId}:m${ci.chatItem.chatDir.groupMember.groupMemberId}` : `c${ref.chatId}`
    if (!this.rt.limiter.throttle(`unknown:${who}`, 5_000)) return
    const pool = this.rt.commands.all().filter((c) => !c.hidden && c.permission === "everyone")
    const guess = this.rt.commands.suggest(keyword, pool)
    const ui = uiFor(ci.chatInfo, prefix)
    const text = [
      `❓ I don't know ${fmt.code(prefix + keyword)}.`,
      guess ? `Did you mean ${ui.cmd(guess.name)}?` : undefined,
      `Send ${ui.cmd("help")} to see all commands.`,
    ]
      .filter(Boolean)
      .join(" ")
    try {
      await this.rt.messenger.send(ref, text, {quote: ci.chatItem.meta.itemId})
    } catch (e) {
      this.log.warn(`could not reply to unknown command in ${chatName(ci.chatInfo)}: ${describeError(e)}`)
    }
  }

  /**
   * Stop accepting commands and wait for running ones. Commands still running after `timeoutMs`
   * are aborted and their live placeholders are finalized with a restart notice.
   */
  async drain(timeoutMs: number): Promise<void> {
    this.accepting = false
    this.rt.prompts.cancelAll()
    const deadline = Date.now() + timeoutMs
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const left = [...this.inFlight]
    if (left.length) this.log.warn(`interrupting ${left.length} running command(s)`)
    await Promise.all(
      left.map(async (ctx) => {
        ctx.abort(new CommandError("Bot is shutting down."))
        if (ctx.deferred && !ctx.deferred.finished) {
          await ctx.deferred.finish(`🔌 Interrupted: ${this.rt.config.profile.displayName} is restarting. Please try again in a moment.`).catch(() => undefined)
        }
      })
    )
  }
}
