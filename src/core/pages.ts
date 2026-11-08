import type {T} from "@simplex-chat/types"
import {chatKey} from "../util/chat"
import * as fmt from "../util/format"
import {makeUi, type Ui} from "../util/ui"
import {newId} from "./scheduler"

/**
 * Paginated lists with tappable ◀ / ▶ buttons (`/'page <id> <n>'`).
 *
 *   return ctx.paginate({title: "👥 Members", items: lines, perPage: 15})
 *
 * Pages live in memory for 30 minutes (they're just views of data you already have).
 */
export interface PageSet {
  id: string
  chat: string
  title: string
  items: string[]
  perPage: number
  footer?: string
  expiresAt: number
  /** Whether commands are tappable in the chat the list was posted in. */
  tappable: boolean
  prefix: string
}

export class Pages {
  private sets = new Map<string, PageSet>()

  create(ref: T.ChatRef, opts: {title: string; items: string[]; perPage?: number; footer?: string; ui: Ui}): PageSet {
    this.sweep()
    const set: PageSet = {
      id: newId(),
      chat: chatKey(ref),
      title: opts.title,
      items: opts.items,
      perPage: Math.max(1, opts.perPage ?? 15),
      footer: opts.footer,
      expiresAt: Date.now() + 30 * 60_000,
      tappable: opts.ui.tappable,
      prefix: opts.ui.prefix,
    }
    this.sets.set(set.id, set)
    return set
  }

  get(id: string, ref: T.ChatRef): PageSet | undefined {
    const s = this.sets.get(id)
    return s && s.expiresAt > Date.now() && s.chat === chatKey(ref) ? s : undefined
  }

  pageCount(set: PageSet): number {
    return Math.max(1, Math.ceil(set.items.length / set.perPage))
  }

  render(set: PageSet, page: number): string {
    const ui = makeUi(set.tappable, set.prefix)
    const total = this.pageCount(set)
    const p = Math.min(Math.max(1, page), total)
    const source = set.items.slice((p - 1) * set.perPage, p * set.perPage)
    const slice: string[] = []
    for (const item of source) {
      const candidate = slice.length ? `${slice.join("\n")}\n${item}` : item
      if (Buffer.byteLength(candidate) > 9_500 && slice.length) break
      slice.push(Buffer.byteLength(item) > 9_500 ? item.slice(0, 9_400) + "…" : item)
    }
    const nav =
      total > 1
        ? [
            p > 1 ? `◀ ${ui.button("", "page", `${set.id} ${p - 1}`, {important: true})}` : undefined,
            fmt.italic(`page ${p}/${total}`),
            p < total ? `${ui.button("", "page", `${set.id} ${p + 1}`, {important: true})} ▶` : undefined,
          ]
            .filter(Boolean)
            .join("   ")
        : undefined
    return fmt.lines(set.title, "", slice.length ? slice.join("\n") : fmt.italic("Nothing here."), set.footer && `\n${set.footer}`, nav && `\n${nav}`)
  }

  private sweep(): void {
    const now = Date.now()
    for (const [id, s] of this.sets) if (s.expiresAt < now) this.sets.delete(id)
  }
}
