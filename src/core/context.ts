import {T} from "@simplex-chat/types"
import type {api} from "simplex-chat"
import type {RubiConfig} from "../config"
import {chatKey, chatName, chatRefOf} from "../util/chat"
import * as fmt from "../util/format"
import {uiFor, type Ui} from "../util/ui"
import {usageParams} from "./args"
import type {Command, CommandScope} from "./command"
import type {ContactSettings, GroupSettings, ScopedData} from "./data"
import {CommandError, ScopeError, UsageError} from "./errors"
import type {Http} from "./http"
import type {Logger} from "./logger"
import type {BotMessage, Content, LiveMessage, SendOptions} from "./messages"
import {isActiveMember, permissionRole, roleAtLeast, type Permission} from "./permissions"
import type {Runtime} from "./runtime"

/** Who sent the command. */
export interface Sender {
  displayName: string
  /** Stable per-chat key, used for cooldowns and anti-flood. */
  key: string
  /** In DMs: the contact. */
  contact?: T.Contact
  /** In groups: the member who sent the message (role as of when it was received). */
  member?: T.GroupMember
  /** Contact id in the bot's database: the DM contact, or the group member's linked contact (if any). */
  contactId?: number
  /** Group role (groups only). */
  role?: T.GroupMemberRole
}

type ReplyOptions = Omit<SendOptions, "quote" | "live">

/**
 * Everything a command needs: who/where it was invoked, parsed args,
 * permission helpers and reply helpers (including live / deferred replies).
 */
export class CommandContext<A = Record<string, unknown>> {
  /** Parsed, validated arguments (see the command's `args`). */
  args: A = {} as A
  /** The live placeholder created by `defer()` (or `live: true`), until finished. */
  deferred: LiveMessage | undefined
  /** Whether a reply was delivered (the dispatcher uses this to finalize deferred replies). */
  replied = false
  readonly startedAt = Date.now()
  readonly ref: T.ChatRef
  readonly sender: Sender
  readonly log: Logger

  private readonly abortController = new AbortController()
  private membersCache: Promise<T.GroupMember[]> | undefined
  private mentionMap: Record<string, number> = {}
  private httpClient: Http | undefined
  private uiCache: Ui | undefined

  constructor(
    readonly rt: Runtime,
    /** The chat item (message) that invoked the command. */
    readonly item: T.AChatItem,
    readonly command: Command,
    /** Keyword actually typed (may be an alias). */
    readonly invokedAs: string,
    /** Raw text after the keyword. */
    readonly rawArgs: string
  ) {
    const ref = chatRefOf(item.chatInfo)
    if (!ref) throw new Error(`commands are not supported in ${item.chatInfo.type} chats`)
    this.ref = ref
    this.sender = senderOf(item)
    this.log = rt.log.child(`/${command.name}`)
  }

  // ── where ────────────────────────────────────────────────────────────────

  get chat(): api.ChatApi {
    return this.rt.chat
  }
  get config(): RubiConfig {
    return this.rt.config
  }
  get chatInfo(): T.ChatInfo {
    return this.item.chatInfo
  }
  /** Item id of the invoking message (use to quote / react). */
  get itemId(): number {
    return this.item.chatItem.meta.itemId
  }
  /** Full text of the invoking message. */
  get text(): string {
    const c = this.item.chatItem.content
    return c.type === "rcvMsgContent" ? c.msgContent.text : ""
  }
  get isDirect(): boolean {
    return this.chatInfo.type === "direct"
  }
  get isGroup(): boolean {
    return this.chatInfo.type === "group"
  }
  /** Business chat: a group created per customer by a business address. */
  get isBusiness(): boolean {
    return this.chatInfo.type === "group" && !!this.chatInfo.groupInfo.businessChat
  }
  /** Group info (groups only). */
  get group(): T.GroupInfo | undefined {
    return this.chatInfo.type === "group" ? this.chatInfo.groupInfo : undefined
  }
  /** DM contact (direct chats only). */
  get contact(): T.Contact | undefined {
    return this.chatInfo.type === "direct" ? this.chatInfo.contact : undefined
  }
  /** "@Alice" or "#Group". */
  get chatName(): string {
    return chatName(this.chatInfo)
  }
  /** "@Alice" or "@Alice in #Group" — for logs. */
  get who(): string {
    return this.isGroup ? `@${this.sender.displayName} in ${this.chatName}` : `@${this.sender.displayName}`
  }

  inScope(scope: CommandScope): boolean {
    switch (scope) {
      case "any":
        return true
      case "direct":
        return this.isDirect || this.isBusiness
      case "group":
        return this.isGroup
    }
  }

  // ── who ──────────────────────────────────────────────────────────────────

  /** Bot operator (contact id listed in RUBI_BOT_ADMINS). */
  get isBotAdmin(): boolean {
    const id = this.sender.contactId
    return id !== undefined && this.config.botAdmins.includes(id)
  }

  /** Sender has at least this group role (false outside groups). */
  hasRole(min: T.GroupMemberRole): boolean {
    return this.isGroup && roleAtLeast(this.sender.role, min)
  }

  /** Group admin or owner. */
  get isGroupAdmin(): boolean {
    return this.hasRole(T.GroupMemberRole.Admin)
  }

  /** Whether the sender passes a permission level (bot admins pass all). */
  can(permission: Permission): boolean {
    if (permission === "everyone" || this.isBotAdmin) return true
    if (permission === "botAdmin") return false
    const role = permissionRole(permission)
    return role !== undefined && this.hasRole(role)
  }

  /** The bot's own role in this group. */
  get botRole(): T.GroupMemberRole | undefined {
    return this.group?.membership.memberRole
  }

  /** The bot has at least this role in this group. */
  botHasRole(min: T.GroupMemberRole): boolean {
    return this.isGroup && roleAtLeast(this.botRole, min)
  }

  // ── replies ──────────────────────────────────────────────────────────────

  /**
   * Reply to the command. If a live placeholder is pending (deferred), it is edited into
   * this reply and finalized; otherwise a new message quoting the command is sent.
   */
  async reply(content: Content, opts: ReplyOptions = {}): Promise<BotMessage> {
    this.ensureActive()
    return this.deliver(content, opts)
  }

  /** Send a message in this chat without quoting the command. */
  async send(content: Content, opts: SendOptions = {}): Promise<BotMessage> {
    this.ensureActive()
    return this.rt.messenger.send(this.ref, content, {...opts, mentions: this.mentionsFor(opts.mentions)})
  }

  /**
   * Live/deferred reply: immediately post a live placeholder quoting the command; it shows elapsed
   * time until `reply()` replaces it with the result. Calling it again returns the same message.
   */
  // no trailing "…": SimpleX apps animate "..." after every live message themselves
  async defer(text = `⏳ Working on ${this.config.prefix}${this.command.name}`): Promise<LiveMessage> {
    this.ensureActive()
    if (this.deferred && !this.deferred.finished) return this.deferred
    this.deferred = await this.rt.messenger.live(this.ref, text, {quote: this.itemId})
    this.deferred.startTicker()
    return this.deferred
  }

  /** Update the deferred placeholder text (e.g. "Fetching 3/10…"). No-op if not deferred. */
  progress(text: string): void {
    if (!this.signal.aborted) this.deferred?.update(text)
  }

  /** Start an extra live message (you must call `finish()` on it). */
  async live(text: string, opts: ReplyOptions = {}): Promise<LiveMessage> {
    this.ensureActive()
    return this.rt.messenger.live(this.ref, text, {...opts, quote: this.itemId, mentions: this.mentionsFor(opts.mentions)})
  }

  /** React to the command message. Returns false if reactions are disabled in this chat. */
  async react(emoji: string): Promise<boolean> {
    try {
      await this.rt.messenger.react(this.ref, this.itemId, emoji)
      return true
    } catch (e) {
      this.log.debug("reaction failed:", (e as Error).message)
      return false
    }
  }

  /** Abort the command with a user-facing error. */
  fail(message: string): never {
    throw new CommandError(message)
  }

  /** Abort with a usage error (reply includes usage). */
  usageError(message: string): never {
    throw new UsageError(message)
  }

  /** "/name <arg> [opt]" */
  usage(): string {
    const params = usageParams(this.command.args)
    return `${this.config.prefix}${this.command.name}${params ? ` ${params}` : ""}`
  }

  /** Reply with an inline image (small data URI — see `Messenger.sendImage`). */
  async replyImage(image: string, caption = "", opts: ReplyOptions & {filePath?: string} = {}): Promise<BotMessage> {
    this.ensureActive()
    if (this.deferred && !this.deferred.finished) {
      // an image can't replace a text placeholder: drop the placeholder instead
      await this.deferred.delete().catch(() => undefined)
    }
    const msg = await this.rt.messenger.sendImage(this.ref, image, caption, {...opts, quote: this.itemId, mentions: this.mentionsFor(opts.mentions)})
    this.replied = true
    return msg
  }

  // ── utilities ────────────────────────────────────────────────────────────

  /**
   * Chat-aware commands and buttons: tappable in DMs (and groups with a /groupmenu), `code` elsewhere,
   * where only important buttons are shown. Use `ctx.ui.cmd(…)` / `ctx.ui.button(…)` instead of fmt.command/button.
   */
  get ui(): Ui {
    return (this.uiCache ??= uiFor(this.chatInfo, this.config.prefix))
  }

  /** HTTP client cancelled together with this command (timeouts → friendly errors). */
  get http(): Http {
    return (this.httpClient ??= this.rt.http.withSignal(this.signal))
  }

  /** This group's settings (stored in the chat database). Groups only. */
  get groupData(): ScopedData<GroupSettings> {
    const g = this.group
    if (!g) throw new ScopeError("This only works in groups.")
    return this.rt.data.group(g)
  }

  /** This contact's settings (stored in the chat database). DMs only. */
  get contactData(): ScopedData<ContactSettings> {
    const c = this.contact
    if (!c) throw new ScopeError("This only works in a direct chat with me.")
    return this.rt.data.contact(c)
  }

  /** Key identifying this user in this chat (used by prompts). */
  get promptKey(): string {
    return `${chatKey(this.ref)}|${this.sender.key}`
  }

  /**
   * Ask the user something and wait for their next message in this chat.
   * Returns the text, or `undefined` on timeout or if they send /cancel. Other commands still work meanwhile.
   */
  async awaitReply(prompt?: string, opts: {timeoutMs?: number} = {}): Promise<string | undefined> {
    this.ensureActive()
    const timeoutMs = opts.timeoutMs ?? 60_000
    if (prompt) {
      await this.rt.messenger.send(this.ref, `${prompt}\n${fmt.italic(`Reply within ${fmt.duration(timeoutMs)}, or send ${this.ui.cmd("cancel")}.`)}`, {
        quote: this.itemId,
      })
    }
    const p = this.config.prefix
    const r = await this.rt.prompts.wait(
      this.promptKey,
      (text) => {
        const t = text.trim().toLowerCase()
        if (t === `${p}cancel`) return "cancel"
        return t.startsWith(p) ? "skip" : "take"
      },
      timeoutMs,
      this.signal
    )
    return r.status === "reply" ? r.text?.trim() : undefined
  }

  /**
   * Ask for confirmation with ✅ /confirm and ✖ /cancel buttons. Only the person who ran the command can answer.
   * The question message is edited to show the outcome. Resolves `true` only on /confirm.
   */
  async confirm(question: string, opts: {timeoutMs?: number} = {}): Promise<boolean> {
    this.ensureActive()
    const timeoutMs = opts.timeoutMs ?? 60_000
    const p = this.config.prefix
    const buttons = this.ui.buttons([this.ui.button("✅", "confirm", undefined, {important: true}), this.ui.button("✖", "cancel", undefined, {important: true})], "    ")
    const msg = await this.rt.messenger.send(
      this.ref,
      `${question}\n\n${buttons}\n${fmt.italic(`Only ${this.sender.displayName} can answer · ${fmt.duration(timeoutMs)}`)}`,
      {quote: this.itemId, mentions: this.mentionsFor()}
    )
    const yes = new Set([`${p}confirm`, `${p}yes`, "yes", "y"])
    const no = new Set([`${p}cancel`, `${p}no`, "no", "n"])
    const r = await this.rt.prompts.wait(
      this.promptKey,
      (text) => {
        const t = text.trim().toLowerCase()
        return yes.has(t) ? "take" : no.has(t) ? "cancel" : "skip"
      },
      timeoutMs,
      this.signal
    )
    const outcome = r.status === "reply" ? "✅ Confirmed." : r.status === "timeout" ? "⌛ No answer — cancelled." : "✖ Cancelled."
    await msg.edit(`${question}\n\n${fmt.italic(outcome)}`, this.mentionsFor()).catch(() => undefined)
    return r.status === "reply"
  }

  /** Reply with a paginated list (◀ ▶ buttons). */
  async paginate(opts: {title: string; items: string[]; perPage?: number; footer?: string}): Promise<BotMessage> {
    const set = this.rt.pages.create(this.ref, {...opts, ui: this.ui})
    return this.reply(this.rt.pages.render(set, 1))
  }

  // ── groups ───────────────────────────────────────────────────────────────

  /** Group members (cached for this command run). The bot itself is not included. */
  members(): Promise<T.GroupMember[]> {
    const g = this.group
    if (!g) return Promise.reject(new ScopeError("This only works in groups."))
    this.membersCache ??= this.chat.apiListMembers(g.groupId)
    return this.membersCache
  }

  /** Resolve `@mention`, `@'Full Name'`, `name`, or `#id` to a group member. */
  async resolveMember(token: string): Promise<T.GroupMember> {
    const g = this.group
    if (!g) throw new UsageError("Members can only be referenced in groups.")
    const raw = token.trim()
    const all = [g.membership, ...(await this.members())]
    const byId = (id: number) => all.find((m) => m.groupMemberId === id)

    const idMatch = raw.match(/^#(\d+)$/)
    if (idMatch) {
      const m = byId(Number(idMatch[1]))
      if (m) return m
      throw new UsageError(`No member with id #${idMatch[1]}.`)
    }

    const name = raw.startsWith("@") ? raw.slice(1) : raw
    // SimpleX mentions carry the exact member reference
    const mentioned = this.item.chatItem.mentions[name]?.memberRef?.groupMemberId
    if (mentioned !== undefined) {
      const m = byId(mentioned)
      if (m) return m
    }
    const lower = name.toLowerCase()
    const exact = all.filter((m) => m.memberProfile.displayName.toLowerCase() === lower || m.localDisplayName.toLowerCase() === lower)
    const active = exact.filter(isActiveMember)
    const candidates = active.length ? active : exact
    if (candidates.length === 1) return candidates[0]!
    if (candidates.length > 1) {
      const list = candidates.map((m) => `#${m.groupMemberId} ${m.memberProfile.displayName}`).join(", ")
      throw new UsageError(`"${name}" matches several members (${list}). Use #id or an @mention.`)
    }
    throw new UsageError(`No member named "${name}" in this group.`)
  }

  /**
   * `@name` text for a member, registered so replies in this run carry a real SimpleX mention
   * (the member gets notified and the name is tappable).
   */
  mention(member: T.GroupMember): string {
    const name = member.memberProfile.displayName
    this.mentionMap[name] = member.groupMemberId
    return fmt.mention(name)
  }

  // ── lifecycle (used by the dispatcher) ───────────────────────────────────

  /** Aborted when the command times out or the bot shuts down. Pass it to fetch() etc. */
  get signal(): AbortSignal {
    return this.abortController.signal
  }

  /** @internal */
  abort(reason: Error): void {
    if (!this.signal.aborted) this.abortController.abort(reason)
  }

  /** @internal Deliver a reply even after abort (used for error/timeout messages). */
  async deliver(content: Content, opts: ReplyOptions = {}): Promise<BotMessage> {
    const mentions = this.mentionsFor(opts.mentions)
    const d = this.deferred
    if (d && !d.finished) {
      try {
        await d.finish(content, mentions)
        this.replied = true
        return d
      } catch (e) {
        this.log.warn("could not finalize live reply, sending a new message:", (e as Error).message)
      }
    }
    const msg = await this.rt.messenger.send(this.ref, content, {...opts, quote: this.itemId, mentions})
    this.replied = true
    return msg
  }

  /** Mentions registered via `mention()` (groups only — DMs have no mentions). */
  private mentionsFor(extra?: Record<string, number>): Record<string, number> | undefined {
    return this.isGroup ? {...this.mentionMap, ...extra} : undefined
  }

  private ensureActive(): void {
    if (this.signal.aborted) throw this.signal.reason instanceof Error ? this.signal.reason : new CommandError("Command was cancelled.")
  }
}

export function senderOf({chatInfo, chatItem}: T.AChatItem): Sender {
  const dir = chatItem.chatDir
  if (dir.type === "groupRcv" && chatInfo.type === "group") {
    const m = dir.groupMember
    return {
      displayName: m.memberProfile.displayName,
      key: `g${chatInfo.groupInfo.groupId}:m${m.groupMemberId}`,
      member: m,
      contactId: m.memberContactId,
      role: m.memberRole,
    }
  }
  if (chatInfo.type === "direct") {
    const c = chatInfo.contact
    return {displayName: c.profile.displayName, key: `c${c.contactId}`, contact: c, contactId: c.contactId}
  }
  return {displayName: "unknown", key: `x${chatItem.meta.itemId}`}
}
