import {CC, type ChatResponse, T} from "@simplex-chat/types"
import type {api} from "simplex-chat"
import type {RubiConfig} from "../config"
import {duration, italic} from "../util/format"
import {textContent} from "../util/chat"
import {chatErrorType} from "./errors"
import type {Logger} from "./logger"

/**
 * Thrown when chat core answers a command with an unexpected response.
 * Same shape as the library's `api.ChatCommandError` (`.response`), so `describeError` handles both.
 */
export class ChatResponseError extends Error {
  override name = "ChatResponseError"
  constructor(
    message: string,
    public readonly response: ChatResponse
  ) {
    super(message)
  }
}

/** Conservative per-message text budget (bytes). Longer texts are split into several messages. */
export const MAX_TEXT_BYTES = 12_000

export interface SendOptions {
  /** Item id of the message to quote (reply to). */
  quote?: number
  /** Mentions used in the text: display name (as written after `@`) → groupMemberId. Groups only. */
  mentions?: Record<string, number>
  /** Send as a live message (shown as "being typed" until finished). */
  live?: boolean
  /** Disappearing message: delete after N seconds. */
  ttl?: number
}

export type Content = string | T.MsgContent

const toContent = (c: Content): T.MsgContent => (typeof c === "string" ? textContent(c) : c)

/**
 * Thin, typed layer over chat core message commands.
 *
 * Wraps the commands directly (instead of `ChatApi.apiUpdateChatItem` / `apiChatItemReaction`)
 * because the library versions can't do live edits and expect the wrong response type for reactions.
 */
export class Messenger {
  constructor(
    readonly chat: api.ChatApi,
    private readonly cfg: RubiConfig["live"],
    private readonly log: Logger
  ) {}

  /** Send a message. Long plain texts are split; the last sent message is returned. */
  async send(ref: T.ChatRef, content: Content, opts: SendOptions = {}): Promise<BotMessage> {
    const mc = toContent(content)
    const parts = mc.type === "text" && !opts.live ? splitText(mc.text) : [mc.text]
    const messages: T.ComposedMessage[] = parts.map((text, i) => ({
      msgContent: i === 0 && mc.type !== "text" ? {...mc, text} : textContent(text),
      mentions: opts.mentions ?? {},
      quotedItemId: i === 0 ? opts.quote : undefined,
    }))
    const items = await this.sendComposed(ref, messages, opts)
    const last = items[items.length - 1]
    if (!last) throw new Error("chat core returned no chat items for sent message")
    return new BotMessage(this, ref, last.chatItem.meta.itemId, parts[parts.length - 1] ?? "")
  }

  /**
   * Send an image shown inline. `image` is a small data URI (`data:image/png;base64,…` or `data:image/jpg;base64,…`,
   * under ~12.5K chars — the apps strip only those exact prefixes, "image/jpeg" renders blank). For a big
   * full-resolution image, also pass `filePath` to send the file alongside (needs files allowed in the chat).
   */
  async sendImage(ref: T.ChatRef, image: string, caption = "", opts: SendOptions & {filePath?: string} = {}): Promise<BotMessage> {
    const items = await this.sendComposed(
      ref,
      [
        {
          msgContent: {type: "image", text: caption, image},
          mentions: opts.mentions ?? {},
          quotedItemId: opts.quote,
          fileSource: opts.filePath ? {filePath: opts.filePath} : undefined,
        },
      ],
      opts
    )
    const item = items[0]
    if (!item) throw new Error("chat core returned no chat item for image")
    return new BotMessage(this, ref, item.chatItem.meta.itemId, caption)
  }

  /** Send a file from disk (sent via XFTP; files must be allowed in the chat). */
  async sendFile(ref: T.ChatRef, filePath: string, caption = "", opts: SendOptions = {}): Promise<BotMessage> {
    const items = await this.sendComposed(
      ref,
      [{msgContent: {type: "file", text: caption}, fileSource: {filePath}, mentions: opts.mentions ?? {}, quotedItemId: opts.quote}],
      opts
    )
    const item = items[0]
    if (!item) throw new Error("chat core returned no chat item for file")
    return new BotMessage(this, ref, item.chatItem.meta.itemId, caption)
  }

  /**
   * Send pre-composed messages (files, images, links...). Returns the created chat items.
   * If a quoted message is gone (deleted, e.g. by /purge or its author), the messages are sent without the quote.
   */
  async sendComposed(ref: T.ChatRef, composedMessages: T.ComposedMessage[], opts: Pick<SendOptions, "live" | "ttl"> = {}): Promise<T.AChatItem[]> {
    const send = async (messages: T.ComposedMessage[]) => {
      const r = await this.chat.sendChatCmd(
        CC.APISendMessages.cmdString({sendRef: ref, composedMessages: messages, liveMessage: !!opts.live, ttl: opts.ttl, signMessages: false})
      )
      if (r.type === "newChatItems") return r.chatItems
      throw new ChatResponseError("error sending message", r)
    }
    try {
      return await send(composedMessages)
    } catch (e) {
      if (chatErrorType(e) !== "invalidQuote" || !composedMessages.some((m) => m.quotedItemId !== undefined)) throw e
      return send(composedMessages.map((m) => ({...m, quotedItemId: undefined})))
    }
  }

  /** Edit a sent message. `live: true` keeps it in the live (typing) state. */
  async update(ref: T.ChatRef, itemId: number, content: Content, opts: {live?: boolean; mentions?: Record<string, number>} = {}): Promise<void> {
    const r = await this.chat.sendChatCmd(
      CC.APIUpdateChatItem.cmdString({
        chatRef: ref,
        chatItemId: itemId,
        liveMessage: !!opts.live,
        updatedMessage: {msgContent: toContent(content), mentions: opts.mentions ?? {}},
      })
    )
    if (r.type === "chatItemUpdated" || r.type === "chatItemNotChanged") return
    throw new ChatResponseError("error updating message", r)
  }

  /** Delete messages. Default mode deletes for everyone. */
  async delete(ref: T.ChatRef, itemIds: number[], mode: T.CIDeleteMode = T.CIDeleteMode.Broadcast): Promise<T.ChatItemDeletion[]> {
    const r = await this.chat.sendChatCmd(CC.APIDeleteChatItem.cmdString({chatRef: ref, chatItemIds: itemIds, deleteMode: mode}))
    if (r.type === "chatItemsDeleted") return r.chatItemDeletions
    throw new ChatResponseError("error deleting message", r)
  }

  /** Add or remove an emoji reaction. Reactions must be enabled in the chat (they are by default). */
  async react(ref: T.ChatRef, itemId: number, emoji: string, add = true): Promise<void> {
    const r = await this.chat.sendChatCmd(
      CC.APIChatItemReaction.cmdString({chatRef: ref, chatItemId: itemId, add, reaction: {type: "emoji", emoji}})
    )
    if (r.type === "chatItemReaction") return
    throw new ChatResponseError("error setting reaction", r)
  }

  /** Start a live message — it shows as being typed until `finish()` is called. */
  async live(ref: T.ChatRef, text: string, opts: Omit<SendOptions, "live"> = {}): Promise<LiveMessage> {
    const items = await this.sendComposed(ref, [{msgContent: textContent(text), mentions: opts.mentions ?? {}, quotedItemId: opts.quote}], {
      live: true,
      ttl: opts.ttl,
    })
    const item = items[0]
    if (!item) throw new Error("chat core returned no chat item for live message")
    return new LiveMessage(this, ref, item.chatItem.meta.itemId, text, this.cfg, this.log)
  }
}

/** A message the bot sent. Use it to edit, delete or react to it later. */
export class BotMessage {
  constructor(
    protected readonly messenger: Messenger,
    readonly ref: T.ChatRef,
    readonly itemId: number,
    /** Last text the bot set on this message. */
    public text: string
  ) {}

  async edit(content: Content, mentions?: Record<string, number>): Promise<void> {
    const text = typeof content === "string" ? fitText(content) : content
    await this.messenger.update(this.ref, this.itemId, text, {mentions})
    this.text = typeof text === "string" ? text : text.text
  }

  delete(mode?: T.CIDeleteMode): Promise<T.ChatItemDeletion[]> {
    return this.messenger.delete(this.ref, [this.itemId], mode)
  }

  react(emoji: string, add = true): Promise<void> {
    return this.messenger.react(this.ref, this.itemId, emoji, add)
  }
}

/**
 * A live message: sent with `live=on`, then edited in place while it stays live
 * (clients show it as being typed), and finalized with `finish()`.
 *
 * - `update()` is throttled (`RUBI_LIVE_MIN_INTERVAL_MS`) and ordered; only the latest text is sent.
 * - `startTicker()` appends elapsed time ("_4s_") to the current text until finished.
 * - Always call `finish()` (the dispatcher does it for deferred replies, even on errors).
 */
export class LiveMessage extends BotMessage {
  private status: string
  private pending: string | undefined
  private lastSentAt = Date.now()
  private timer: NodeJS.Timeout | undefined
  private chain: Promise<void> = Promise.resolve()
  private ticker: {handle: NodeJS.Timeout; startedAt: number; maxMs: number} | undefined
  private done = false

  constructor(
    messenger: Messenger,
    ref: T.ChatRef,
    itemId: number,
    text: string,
    private readonly cfg: RubiConfig["live"],
    private readonly log: Logger
  ) {
    super(messenger, ref, itemId, text)
    this.status = text
  }

  get finished(): boolean {
    return this.done
  }

  /** Change the live text (e.g. progress). Throttled; resolves immediately. */
  update(text: string): void {
    if (this.done) return
    this.status = text
    this.schedule()
  }

  /** Show elapsed time after the current text, refreshed every `intervalMs`. */
  startTicker(intervalMs = this.cfg.tickerIntervalMs, maxMs = this.cfg.tickerMaxMs): void {
    if (this.done || this.ticker || intervalMs <= 0) return
    const startedAt = Date.now()
    const handle = setInterval(() => {
      if (!this.ticker || Date.now() - startedAt > this.ticker.maxMs) return this.stopTicker()
      this.schedule()
    }, intervalMs)
    handle.unref()
    this.ticker = {handle, startedAt, maxMs}
  }

  stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker.handle)
    this.ticker = undefined
  }

  /** Finalize: final text, live state off. Safe to call more than once (later calls are ignored). */
  async finish(content?: Content, mentions?: Record<string, number>): Promise<void> {
    if (this.done) return
    this.done = true
    this.stopTicker()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.chain
    const final = content === undefined ? this.status : typeof content === "string" ? fitText(content) : content
    await this.messenger.update(this.ref, this.itemId, final, {live: false, mentions})
    this.text = typeof final === "string" ? final : final.text
  }

  /** Remove the live message instead of finalizing it. */
  override async delete(mode?: T.CIDeleteMode): Promise<T.ChatItemDeletion[]> {
    this.done = true
    this.stopTicker()
    if (this.timer) clearTimeout(this.timer)
    await this.chain
    return super.delete(mode)
  }

  private render(): string {
    const t = this.ticker
    return fitText(t ? `${this.status} ${italic(duration(Math.floor((Date.now() - t.startedAt) / 1000) * 1000))}` : this.status)
  }

  private schedule(): void {
    this.pending = this.render()
    if (this.timer) return
    const wait = Math.max(0, this.lastSentAt + this.cfg.minUpdateIntervalMs - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.chain = this.chain.then(() => this.flush())
    }, wait)
  }

  private async flush(): Promise<void> {
    const text = this.pending
    this.pending = undefined
    if (this.done || text === undefined || text === this.text) return
    try {
      await this.messenger.update(this.ref, this.itemId, text, {live: true})
      this.text = text
    } catch (e) {
      this.log.warn(`live message ${this.itemId} update failed:`, (e as Error).message)
    } finally {
      this.lastSentAt = Date.now()
    }
  }
}

/** Split text into chunks under MAX_TEXT_BYTES, preferring line boundaries. */
export function splitText(text: string, maxBytes = MAX_TEXT_BYTES): string[] {
  if (Buffer.byteLength(text) <= maxBytes) return [text]
  const chunks: string[] = []
  let cur = ""
  const push = () => {
    if (cur) chunks.push(cur)
    cur = ""
  }
  for (const line of text.split("\n")) {
    const candidate = cur ? `${cur}\n${line}` : line
    if (Buffer.byteLength(candidate) <= maxBytes) {
      cur = candidate
      continue
    }
    push()
    if (Buffer.byteLength(line) <= maxBytes) {
      cur = line
    } else {
      // a single huge line: hard-split by characters
      let piece = ""
      let bytes = 0
      for (const ch of line) {
        const b = Buffer.byteLength(ch)
        if (bytes + b > maxBytes) {
          chunks.push(piece)
          piece = ""
          bytes = 0
        }
        piece += ch
        bytes += b
      }
      cur = piece
    }
  }
  push()
  return chunks
}

/** Edits can't be split, so over-long texts are truncated. */
export function fitText(text: string, maxBytes = MAX_TEXT_BYTES): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const suffix = "\n…(truncated)"
  const budget = maxBytes - Buffer.byteLength(suffix)
  let out = ""
  let bytes = 0
  for (const ch of text) {
    const b = Buffer.byteLength(ch)
    if (bytes + b > budget) break
    out += ch
    bytes += b
  }
  return out + suffix
}
