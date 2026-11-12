import type {T} from "@simplex-chat/types"
import type {api} from "simplex-chat"

/**
 * Per-group and per-contact settings, stored *inside the SimpleX chat database* via
 * `apiSetGroupCustomData` / `apiSetContactCustomData` — no extra database, and they travel with the bot's DB.
 *
 * Everything Rubi stores lives under the `rubi` key of the chat's customData, so other tools can share it.
 *
 *   const s = await ctx.groupData.get()                 // GroupSettings
 *   await ctx.groupData.update((s) => { s.rules = "Be nice" })
 *
 * Add new fields to `GroupSettings` / `ContactSettings` below so every command sees them typed.
 */
export interface GroupSettings {
  rules?: string
  /** Welcome message for new members; `{name}` and `{group}` are replaced. */
  welcome?: string
  /** Delete links posted by brand-new members. */
  antispam?: boolean
  /** Warnings by groupMemberId. */
  warnings?: Record<string, {name: string; count: number; reasons: string[]; last: number}>
  /** Auto-kick at this many warnings (0 = never). Default 3. */
  warnLimit?: number
  tasks?: TodoTask[]
  events?: GroupEvent[]
  /** Banned words/phrases (lowercase, `*` wildcard): messages containing one are deleted (/filter). */
  filter?: string[]
  /** Minimum time between two messages of a member, in ms (/slowmode). */
  slowmodeMs?: number
}

export interface ContactSettings {
  /** IANA time zone, e.g. "Europe/Berlin" (set by /time). */
  timezone?: string
  /** Personal defaults used only when a direct-chat command omits a place/country/currency. */
  defaultWeather?: string
  defaultCountry?: string
  defaultCurrency?: string
  tasks?: TodoTask[]
}

export interface TodoTask {
  id: string
  text: string
  creatorKey: string
  creatorName: string
  assigneeKey?: string
  assigneeName?: string
  done?: boolean
  createdAt: number
}

export interface GroupEvent {
  id: string
  title: string
  at: number
  timeZone: string
  creatorKey: string
  creatorName: string
  roster: Record<string, {name: string; status: "yes" | "maybe" | "no"}>
  canceled?: boolean
}

const NS = "rubi"

export class ChatData {
  private groupCache = new Map<number, Record<string, unknown>>()
  private contactCache = new Map<number, Record<string, unknown>>()
  private queues = new Map<string, Promise<unknown>>()

  constructor(private readonly chat: api.ChatApi) {}

  group(g: T.GroupInfo): ScopedData<GroupSettings> {
    return new ScopedData<GroupSettings>(
      () => this.groupCache.get(g.groupId) ?? ((g.customData as Record<string, unknown> | undefined) ?? {}),
      async (full) => {
        await this.chat.apiSetGroupCustomData(g.groupId, full)
        this.groupCache.set(g.groupId, full)
      },
      (fn) => this.serialize(`g${g.groupId}`, fn)
    )
  }

  contact(c: T.Contact): ScopedData<ContactSettings> {
    return new ScopedData<ContactSettings>(
      () => this.contactCache.get(c.contactId) ?? (((c as any).customData as Record<string, unknown> | undefined) ?? {}),
      async (full) => {
        await this.chat.apiSetContactCustomData(c.contactId, full)
        this.contactCache.set(c.contactId, full)
      },
      (fn) => this.serialize(`c${c.contactId}`, fn)
    )
  }

  /** One read-modify-write at a time per chat, so concurrent commands don't lose updates. */
  private serialize<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const settled = next.catch(() => undefined)
    this.queues.set(key, settled)
    void settled.finally(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key)
    })
    return next
  }
}

export class ScopedData<S extends object> {
  constructor(
    private readonly read: () => Record<string, unknown>,
    private readonly write: (full: Record<string, unknown>) => Promise<void>,
    private readonly serialize: <R>(fn: () => Promise<R>) => Promise<R>
  ) {}

  /** Current settings (a copy — use `update` to change them). */
  async get(): Promise<S> {
    return structuredClone((this.read()[NS] as S | undefined) ?? ({} as S))
  }

  /** Change settings: mutate the draft or return a new object. Saved to the chat database. */
  update(fn: (draft: S) => S | void): Promise<S> {
    return this.serialize(async () => {
      const full = structuredClone(this.read())
      const draft = structuredClone((full[NS] as S | undefined) ?? ({} as S))
      const next = fn(draft) ?? draft
      await this.write({...full, [NS]: next})
      return structuredClone(next)
    })
  }
}
