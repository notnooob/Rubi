import {mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs"
import path from "node:path"
import type {Logger} from "./logger"

/**
 * Tiny persistent key-value store (one JSON file), for bot state that isn't tied to a single chat:
 * reminders, polls, scheduled jobs…  Per-group / per-contact settings belong in `rt.data` instead
 * (stored inside the SimpleX database itself).
 *
 *   const reminders = rt.store.collection<Reminder>("reminders")
 *   reminders.set(id, value); reminders.get(id); reminders.values(); reminders.delete(id)
 *
 * Writes are batched and atomic (write temp file + rename). Call `flush()` on shutdown.
 * Values must be JSON-serializable.
 */
export class Store {
  private data: Record<string, Record<string, unknown>> = {}
  private timer: NodeJS.Timeout | undefined
  private dirty = false

  constructor(
    readonly file: string,
    private readonly log: Logger
  ) {
    try {
      this.data = JSON.parse(readFileSync(file, "utf8"))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // keep the broken file for inspection instead of silently overwriting it
        const backup = `${file}.broken-${Date.now()}`
        try {
          renameSync(file, backup)
        } catch {
          /* ignore */
        }
        log.error(`could not read ${file} (${(e as Error).message}); starting empty, old file kept as ${backup}`)
      }
      this.data = {}
    }
  }

  collection<V>(name: string): Collection<V> {
    return new Collection<V>(this, name)
  }

  /** @internal */
  raw(name: string): Record<string, unknown> {
    return (this.data[name] ??= {})
  }

  /** @internal */
  changed(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, 250)
    this.timer.unref()
  }

  /** Write pending changes now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.dirty) return
    this.dirty = false
    try {
      mkdirSync(path.dirname(this.file), {recursive: true})
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 1))
      renameSync(tmp, this.file)
    } catch (e) {
      this.dirty = true
      this.log.error(`could not save ${this.file}: ${(e as Error).message}`)
    }
  }
}

export class Collection<V> {
  constructor(
    private readonly store: Store,
    readonly name: string
  ) {}

  private get map(): Record<string, V> {
    return this.store.raw(this.name) as Record<string, V>
  }

  get(key: string): V | undefined {
    return this.map[key]
  }

  has(key: string): boolean {
    return key in this.map
  }

  set(key: string, value: V): V {
    this.map[key] = value
    this.store.changed()
    return value
  }

  /** Read-modify-write. Return `undefined` from `fn` to delete. */
  update(key: string, fn: (current: V | undefined) => V | undefined): V | undefined {
    const next = fn(this.map[key])
    if (next === undefined) this.delete(key)
    else this.set(key, next)
    return next
  }

  delete(key: string): boolean {
    if (!(key in this.map)) return false
    delete this.map[key]
    this.store.changed()
    return true
  }

  keys(): string[] {
    return Object.keys(this.map)
  }

  values(): V[] {
    return Object.values(this.map)
  }

  entries(): [string, V][] {
    return Object.entries(this.map)
  }

  get size(): number {
    return Object.keys(this.map).length
  }
}
