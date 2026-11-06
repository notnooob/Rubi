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
}

const kinds = new Map<string, InteractionHandlers>()

/** Register handlers for an interaction kind (call at module load, e.g. in the command file). */
export function defineInteraction<S>(kind: string, handlers: InteractionHandlers<S>): void {
  kinds.set(kind, handlers as InteractionHandlers)
}

export class Interactions {
  private readonly items: Collection<Interaction>
  private chains = new Map<string, Promise<unknown>>()

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

  /** Route a `/vote <id> …` tap. */
  async button(id: string, args: string[], ctx: CommandContext<any>): Promise<string | undefined> {
    const ix = this.get(id)
    if (!ix) throw new CommandError("That has ended or expired.")
    if (chatKey(ix.ref) !== chatKey(ctx.ref)) throw new CommandError("That button belongs to another chat.")
    const handler = kinds.get(ix.kind)?.onButton
    if (!handler) throw new CommandError("That message has no buttons.")
    const result = await this.serial(ix.id, async () => this.apply(ix, await handler(ix, args, ctx), ctx.rt))
    if (result?.ack) await ctx.react(result.ack)
    return result?.reply
  }

  /** Core handler for `chatItemReaction` events. */
  async onReaction(evt: CEvt.ChatItemReaction, rt: Runtime): Promise<void> {
    const {chatInfo, chatReaction} = evt.reaction
    const dir = chatReaction.chatDir
    if (dir.type !== "directRcv" && dir.type !== "groupRcv") return // ignore the bot's own reactions
    const ref = chatRefOf(chatInfo)
    if (!ref) return
    const key = chatKey(ref)
    const itemId = chatReaction.chatItem.meta.itemId
    const ix = this.items.values().find((i) => i.itemId === itemId && chatKey(i.ref) === key)
    if (!ix || this.expired(ix)) return
    const handler = kinds.get(ix.kind)?.onReaction
    if (!handler) return
    const r = chatReaction.reaction
    const input: ReactionInput = {
      emoji: r.type === "emoji" ? r.emoji : r.tag,
      added: evt.added,
      ...(dir.type === "groupRcv"
        ? {userKey: `g${ref.chatId}:m${dir.groupMember.groupMemberId}`, displayName: dir.groupMember.memberProfile.displayName, member: dir.groupMember}
        : {userKey: `c${ref.chatId}`, displayName: chatInfo.type === "direct" ? chatInfo.contact.profile.displayName : "?"}),
    }
    // don't block the event loop on the message edit
    void this.serial(ix.id, async () => this.apply(ix, await handler(ix, input, rt), rt)).catch((e) =>
      this.log.warn(`reaction handler for ${ix.kind}/${ix.id} failed: ${describeError(e)}`)
    )
  }

  private async apply(ix: Interaction, update: InteractionUpdate, rt: Runtime) {
    const u = typeof update === "string" ? {text: update} : (update ?? {})
    if (u.done) this.end(ix.id)
    else this.save(ix)
    if (u.text !== undefined) {
      try {
        await rt.messenger.update(ix.ref, ix.itemId, u.text)
      } catch (e) {
        this.log.warn(`could not update ${ix.kind} message: ${describeError(e)}`)
      }
    }
    return u
  }

  /** Handlers for one interaction run one at a time (ordered edits, no lost votes). */
  private serial<R>(id: string, fn: () => Promise<R>): Promise<R> {
    const prev = this.chains.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.chains.set(
      id,
      next.catch(() => undefined)
    )
    return next
  }

  private expired(ix: Interaction): boolean {
    return ix.expiresAt !== undefined && ix.expiresAt < Date.now()
  }

  private sweep(): void {
    for (const ix of this.items.values()) if (this.expired(ix)) this.items.delete(ix.id)
  }
}

/** Normalize user-typed / app-sent emoji to the form SimpleX accepts ("❤️" → "❤"). */
export function normalizeReaction(e: string): string {
  return e.replace(/️/g, "")
}
