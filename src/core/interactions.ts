import type {CEvt, T} from "@simplex-chat/types"
import {chatKey, chatRefOf} from "../util/chat"
import type {CommandContext} from "./context"
import {CommandError, describeError} from "./errors"
import type {Logger} from "./logger"
import type {BotMessage} from "./messages"
import type {Runtime} from "./runtime"
import {newId} from "./scheduler"
import type {Collection, Store} from "./store"

/**
 * Interactive messages — "buttons" for SimpleX.
 *
 * SimpleX has no inline keyboards, so Rubi uses the two things the apps make tappable:
 *  1. **Reactions** on the bot's message. The apps only allow 8: 👍 👎 😀 😂 😢 ❤ 🚀 ✅ (max 3 per user per message).
 *  2. **Command buttons**: `/'vote <id> <choice>'` renders as a tappable command that sends instantly.
 *
 * A command posts a message, then `rt.interactions.create(kind, message, state)`. Reactions on that message
 * and `/vote <id> …` taps are routed to the kind's handlers, which change `state` and return the new message
 * text — Rubi saves the state (it survives restarts) and edits the message.
 *
 *   defineInteraction<PollState>("poll", {
 *     onReaction: (ix, r) => { ...; return render(ix.state) },
 *     onButton: (ix, args, ctx) => { ...; return {text: render(ix.state), ack: "✅"} },
 *   })
 */

/** The only reactions SimpleX accepts (single code point — no ❤️ variation selector). */
export const REACTIONS = ["👍", "👎", "😀", "😂", "😢", "❤", "🚀", "✅"] as const
export type Reaction = (typeof REACTIONS)[number]

export interface Interaction<S = any> {
  id: string
  kind: string
  ref: T.ChatRef
  itemId: number
  state: S
  createdAt: number
  /** Epoch ms after which it stops responding (and is cleaned up). */
  expiresAt?: number
  /** Who created it (sender key), e.g. to let only the creator close a poll. */
  ownerKey?: string
}

export interface ReactionInput {
  emoji: string
  added: boolean
  /** Stable key for the reacting user in this chat (same as `ctx.sender.key`). */
  userKey: string
  displayName: string
  member?: T.GroupMember
}

/** What a handler returns: new message text (edits the message), or nothing to leave it. */
export type InteractionUpdate = string | void | undefined | {text?: string; ack?: string; reply?: string; done?: boolean}

export interface InteractionHandlers<S = any> {
  onReaction?(ix: Interaction<S>, r: ReactionInput, rt: Runtime): InteractionUpdate | Promise<InteractionUpdate>
  /** `/vote <id> <args...>` — `args` are the words after the id. */
  onButton?(ix: Interaction<S>, args: string[], ctx: CommandContext<any>): InteractionUpdate | Promise<InteractionUpdate>
  onCancel?(ix: Interaction<S>, ctx: CommandContext<any>): InteractionUpdate | Promise<InteractionUpdate>
}

const kinds = new Map<string, InteractionHandlers>()

/** Register handlers for an interaction kind (call at module load, e.g. in the command file). */
export function defineInteraction<S>(kind: string, handlers: InteractionHandlers<S>): void {
  kinds.set(kind, handlers as InteractionHandlers)
}

export class Interactions {
  private readonly items: Collection<Interaction>
  private chains = new Map<string, Promise<unknown>>()
  private accepting = true

  get activeCount(): number {
    return this.items.size
  }

  counts(): Record<string, number> {
    return this.items.values().reduce<Record<string, number>>((out, ix) => {
      out[ix.kind] = (out[ix.kind] ?? 0) + 1
      return out
    }, {})
  }

  hasActive(kind: string, ref: T.ChatRef, predicate?: (ix: Interaction) => boolean): boolean {
    return this.items.values().some((ix) => ix.kind === kind && chatKey(ix.ref) === chatKey(ref) && !this.expired(ix) && (!predicate || predicate(ix)))
  }

  find<S = any>(predicate: (ix: Interaction) => boolean): Interaction<S> | undefined {
    const ix = this.items.values().find((candidate) => !this.expired(candidate) && predicate(candidate))
    return ix as Interaction<S> | undefined
  }

  constructor(
    store: Store,
    private readonly log: Logger
  ) {
    this.items = store.collection<Interaction>("interactions")
    const sweep = setInterval(() => this.sweep(), 10 * 60_000)
    sweep.unref()
  }

  create<S>(kind: string, msg: BotMessage, state: S, opts: {ttlMs?: number; ownerKey?: string} = {}): Interaction<S> {
    if (!kinds.has(kind)) throw new Error(`unknown interaction kind "${kind}" — call defineInteraction first`)
    const ix: Interaction<S> = {
      id: newId(),
      kind,
      ref: msg.ref,
      itemId: msg.itemId,
      state,
      createdAt: Date.now(),
      expiresAt: opts.ttlMs ? Date.now() + opts.ttlMs : undefined,
      ownerKey: opts.ownerKey,
    }
    this.items.set(ix.id, ix)
    return ix
  }

  get<S = any>(id: string): Interaction<S> | undefined {
    const ix = this.items.get(id) as Interaction<S> | undefined
    return ix && !this.expired(ix) ? ix : undefined
  }

  /** Save changed state (handlers' changes are saved automatically). */
  save(ix: Interaction): void {
    this.items.set(ix.id, ix)
  }

  end(id: string): void {
    this.items.delete(id)
  }

  /** End every interaction matching `predicate`; returns their ids. */
  endWhere(predicate: (ix: Interaction) => boolean): string[] {
    const ids = this.items.values().filter(predicate).map((ix) => ix.id)
    for (const id of ids) this.items.delete(id)
    return ids
  }

  /** Route a `/vote <id> …` tap. The interaction is re-read inside its serial queue. */
  async button(id: string, args: string[], ctx: CommandContext<any>): Promise<string | undefined> {
    if (!this.accepting) throw new CommandError("The bot is shutting down.")
    const result = await this.serial(id, async () => {
      const ix = this.get(id)
      if (!ix) throw new CommandError("That has ended or expired.")
      if (chatKey(ix.ref) !== chatKey(ctx.ref)) throw new CommandError("That button belongs to another chat.")
      const handler = kinds.get(ix.kind)?.onButton
      if (!handler) throw new CommandError("That message has no buttons.")
      return this.apply(ix, await handler(ix, args, ctx), ctx.rt)
    })
    if (result?.ack) await ctx.react(result.ack)
    return result?.reply
  }

  /** Core handler for `chatItemReaction` events. */
  async onReaction(evt: CEvt.ChatItemReaction, rt: Runtime): Promise<void> {
    if (!this.accepting) return
    const {chatInfo, chatReaction} = evt.reaction
    const dir = chatReaction.chatDir
    if (dir.type !== "directRcv" && dir.type !== "groupRcv") return // ignore the bot's own reactions
    const ref = chatRefOf(chatInfo)
    if (!ref) return
    const key = chatKey(ref)
    const itemId = chatReaction.chatItem.meta.itemId
    const r = chatReaction.reaction
    const input: ReactionInput = {
      emoji: r.type === "emoji" ? r.emoji : r.tag,
      added: evt.added,
      ...(dir.type === "groupRcv"
        ? {userKey: `g${ref.chatId}:m${dir.groupMember.groupMemberId}`, displayName: dir.groupMember.memberProfile.displayName, member: dir.groupMember}
        : {userKey: `c${ref.chatId}`, displayName: chatInfo.type === "direct" ? chatInfo.contact.profile.displayName : "?"}),
    }
    // Re-read the interaction inside the queue: a close/reveal may have won the race.
    const candidate = this.items.values().find((i) => i.itemId === itemId && chatKey(i.ref) === key)
    if (!candidate) return
    void this.serial(candidate.id, async () => {
      const ix = this.get(candidate.id)
      if (!ix) return
      const handler = kinds.get(ix.kind)?.onReaction
      if (handler) await this.apply(ix, await handler(ix, input, rt), rt)
    }).catch((e) => this.log.warn(`reaction handler failed: ${describeError(e)}`))
  }

  /** Close an interaction only by its creator, serializing the terminal edit with votes. */
  async closeOwned<S>(id: string, ctx: CommandContext<any>, render: (ix: Interaction<S>) => string): Promise<void> {
    await this.serial(id, async () => {
      const ix = this.get<S>(id)
      if (!ix) throw new CommandError("That interaction has ended or expired.")
      if (chatKey(ix.ref) !== chatKey(ctx.ref)) throw new CommandError("That interaction belongs to another chat.")
      if (ix.ownerKey !== ctx.sender.key) {
        const owner = (ix.state as any)?.ownerName
        throw new CommandError(owner ? `Only the poll's creator (${owner}) can close it.` : "Only the person who started it can close it.")
      }
      const text = render(ix)
      await ctx.rt.messenger.update(ix.ref, ix.itemId, text)
      this.end(id)
    })
  }

  /** Cancel an interaction through its registered handler, preserving ownership and serialization. */
  async cancel(id: string, ctx: CommandContext<any>): Promise<string | undefined> {
    if (!this.accepting) throw new CommandError("The bot is shutting down.")
    const result = await this.serial(id, async () => {
      const ix = this.get(id)
      if (!ix) throw new CommandError("That interaction has ended or expired.")
      if (chatKey(ix.ref) !== chatKey(ctx.ref)) throw new CommandError("That interaction belongs to another chat.")
      if (ix.ownerKey !== ctx.sender.key) throw new CommandError("Only the person who started it can cancel it.")
      const handler = kinds.get(ix.kind)?.onCancel
      if (!handler) throw new CommandError("That interaction cannot be cancelled.")
      return this.apply(ix, await handler(ix, ctx), ctx.rt)
    })
    return result?.reply
  }

  /** Run a terminal or scheduled transition through the same per-interaction queue as votes. */
  async mutate<S, R>(id: string, fn: (ix: Interaction<S>) => Promise<R> | R): Promise<R | undefined> {
    return this.serial(id, async () => {
      const ix = this.get<S>(id)
      return ix ? fn(ix) : undefined
    })
  }

  private async apply(ix: Interaction, update: InteractionUpdate, rt: Runtime) {
    const u = typeof update === "string" ? {text: update} : (update ?? {})
    if (u.text !== undefined) {
      try {
        await rt.messenger.update(ix.ref, ix.itemId, u.text)
      } catch (e) {
        this.log.warn(`could not update ${ix.kind} message: ${describeError(e)}`)
        return u
      }
    }
    if (u.done) this.end(ix.id)
    else this.save(ix)
    return u
  }

  /** Handlers for one interaction run one at a time (ordered edits, no lost votes). */
  private serial<R>(id: string, fn: () => Promise<R>): Promise<R> {
    const prev = this.chains.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const settled = next.catch(() => undefined)
    this.chains.set(id, settled)
    void settled.finally(() => {
      if (this.chains.get(id) === settled) this.chains.delete(id)
    })
    return next
  }

  private expired(ix: Interaction): boolean {
    return ix.expiresAt !== undefined && ix.expiresAt < Date.now()
  }

  private sweep(): void {
    for (const ix of this.items.values()) if (this.expired(ix)) this.items.delete(ix.id)
  }

  stop(): void {
    this.accepting = false
  }

  async drain(timeoutMs: number): Promise<void> {
    const pending = [...this.chains.values()]
    if (!pending.length) return
    await Promise.race([Promise.allSettled(pending), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
  }
}

/** Normalize user-typed / app-sent emoji to the form SimpleX accepts ("❤️" → "❤"). */
export function normalizeReaction(e: string): string {
  return e.replace(/️/g, "")
}
