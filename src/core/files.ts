import {rm} from "node:fs/promises"
import {basename} from "node:path"
import type {Logger} from "./logger"

/**
 * Temporary attachment files: downloaded media lives only until SimpleX has uploaded it.
 *
 *   const files = rt.tempFiles.group(dir)            // one folder per request
 *   const items = await rt.messenger.sendComposed(ref, msgs)
 *   files.sent(items.map((i) => i.chatItem.meta.itemId))
 *
 * SimpleX encrypts and uploads a sent file to XFTP servers in the background, then emits `sndFileCompleteXFTP`.
 * Each file is deleted `graceMs` after that (or right away on `sndFileError`), and the folder once it's empty.
 * Anything still around after `maxAgeMs` is deleted anyway, and `storage/media` is swept on start.
 */
export class TempFiles {
  /** chat item id → its group */
  private byItem = new Map<number, FileGroup>()

  constructor(
    private readonly log: Logger,
    readonly graceMs = 60_000,
    readonly maxAgeMs = 30 * 60_000
  ) {}

  /** Track the files of one folder. */
  group(dir: string): FileGroup {
    return new FileGroup(this, dir)
  }

  /** @internal */
  register(group: FileGroup, itemIds: number[]): void {
    for (const id of itemIds) this.byItem.set(id, group)
  }

  /** `sndFileCompleteXFTP`: the upload finished, delete after the grace period. */
  uploaded(itemId: number): void {
    const g = this.byItem.get(itemId)
    if (!g) return
    this.byItem.delete(itemId)
    g.itemDone(itemId, this.graceMs)
  }

  /** `sndFileError`: the upload failed for good, nothing to keep it for. */
  failed(itemId: number): void {
    const g = this.byItem.get(itemId)
    if (!g) return
    this.byItem.delete(itemId)
    g.itemDone(itemId, 0)
  }

  /** @internal */
  forget(itemIds: number[]): void {
    for (const id of itemIds) this.byItem.delete(id)
  }

  /** How many sent items are still waiting for their upload (for tests and /stats). */
  get pending(): number {
    return this.byItem.size
  }

  /** @internal */
  remove(path: string, recursive = false): void {
    rm(path, {force: true, recursive}).catch((e) => this.log.debug(`couldn't delete ${basename(path)}:`, (e as Error).message))
  }
}

export class FileGroup {
  private waiting = new Set<number>()
  private timers = new Set<NodeJS.Timeout>()
  private closed = false
  private readonly deadline: NodeJS.Timeout

  constructor(
    private readonly owner: TempFiles,
    readonly dir: string
  ) {
    this.deadline = setTimeout(() => this.purge(), owner.maxAgeMs)
    this.deadline.unref()
  }

  /** The attachments went out as these chat items: delete the folder once all of them are uploaded. */
  sent(itemIds: number[]): void {
    if (this.closed) return
    for (const id of itemIds) this.waiting.add(id)
    this.owner.register(this, itemIds)
    if (!this.waiting.size) this.purge()
  }

  /** @internal */
  itemDone(itemId: number, delayMs: number): void {
    this.waiting.delete(itemId)
    if (this.waiting.size) return
    if (delayMs <= 0) return this.purge()
    const t = setTimeout(() => this.purge(), delayMs)
    t.unref()
    this.timers.add(t)
  }

  /** Delete the whole folder now (nothing was sent, sending failed, or everything is uploaded). */
  purge(): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.deadline)
    for (const t of this.timers) clearTimeout(t)
    this.owner.forget([...this.waiting])
    this.waiting.clear()
    this.owner.remove(this.dir, true)
  }

  get purged(): boolean {
    return this.closed
  }
}
