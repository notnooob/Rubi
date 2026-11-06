import path from "node:path"
import type {CEvt, ChatEvent} from "@simplex-chat/types"
import type {api} from "simplex-chat"
import {describeError} from "./errors"
import type {Logger} from "./logger"
import {listModules, loadModule} from "./registry"
import type {Runtime} from "./runtime"

export type EventOf<K extends CEvt.Tag> = ChatEvent & {type: K}

export interface EventDefinition<K extends CEvt.Tag = CEvt.Tag> {
  /** Chat core event tag — see docs/bot-api/EVENTS.md for the full list. */
  event: K
  /** Shown in logs. Defaults to the file name. */
  name?: string
  run(event: EventOf<K>, rt: Runtime): void | Promise<void>
}

/**
 * Declare an event handler. `export default defineEvent("userJoinedGroup", async (evt, rt) => {...})`
 * from a file in data/events. A file may also export an array of handlers.
 *
 * Handlers run in order inside the library's single event loop: keep them quick, and don't
 * `await` long work (start it and let it run) or other events will queue behind it.
 */
export function defineEvent<K extends CEvt.Tag>(event: K, run: EventDefinition<K>["run"], opts: {name?: string} = {}): EventDefinition<K> {
  return {event, run, name: opts.name}
}

interface Handler {
  name: string
  run(event: ChatEvent, rt: Runtime): void | Promise<void>
}

/**
 * Fans chat core events out to any number of handlers (core + data/events).
 *
 * Events can arrive while `bot.run()` is still finishing setup; handlers wait until the
 * runtime is ready, so they always see `rt.chat`, `rt.user` etc.
 */
export class EventBus {
  private handlers = new Map<CEvt.Tag, Handler[]>()
  private runtime: Runtime | undefined
  private readyWaiters: ((rt: Runtime) => void)[] = []
  private subscribed = new Set<CEvt.Tag>()
  private chat: api.ChatApi | undefined

  constructor(private readonly log: Logger) {}

  on<K extends CEvt.Tag>(event: K, name: string, run: (event: EventOf<K>, rt: Runtime) => void | Promise<void>): void {
    const list = this.handlers.get(event) ?? []
    list.push({name, run: run as Handler["run"]})
    this.handlers.set(event, list)
    if (this.chat && !this.subscribed.has(event)) this.subscribe(this.chat, event)
  }

  /** Load handlers from data/events (recursively). Broken files are logged and skipped. */
  loadDir(dir: string): {loaded: number; errors: string[]} {
    const errors: string[] = []
    let loaded = 0
    for (const [file] of listModules(dir)) {
      const short = path.relative(dir, file)
      try {
        const exported = loadModule(file)
        const defs = (Array.isArray(exported) ? exported : [exported]) as EventDefinition[]
        for (const def of defs) {
          if (!def || typeof def.event !== "string" || typeof def.run !== "function") {
            throw new Error("expected `export default defineEvent(...)` (or an array of them)")
          }
          this.on(def.event, def.name ?? short.replace(/\.[^.]+$/, ""), def.run)
          loaded++
        }
      } catch (e) {
        const msg = `${short}: ${(e as Error).message}`
        errors.push(msg)
        this.log.error(`failed to load event handler ${msg}`)
      }
    }
    this.log.info(`loaded ${loaded} event handler(s)`)
    return {loaded, errors}
  }

  /** Subscribers object for `bot.run({events})` — one per event type that has handlers. */
  subscribers(): api.EventSubscribers {
    const subs: Record<string, (e: ChatEvent) => Promise<void>> = {}
    for (const event of this.handlers.keys()) {
      subs[event] = (e) => this.dispatch(e)
      this.subscribed.add(event)
    }
    return subs as api.EventSubscribers
  }

  /** Mark ready (after `bot.run` resolves). Handlers registered later are subscribed directly. */
  setReady(rt: Runtime): void {
    this.runtime = rt
    this.chat = rt.chat
    for (const w of this.readyWaiters.splice(0)) w(rt)
    for (const event of this.handlers.keys()) if (!this.subscribed.has(event)) this.subscribe(rt.chat, event)
  }

  private subscribe(chat: api.ChatApi, event: CEvt.Tag): void {
    this.subscribed.add(event)
    chat.on<CEvt.Tag>(event, (e) => this.dispatch(e))
  }

  private ready(): Promise<Runtime> {
    return this.runtime ? Promise.resolve(this.runtime) : new Promise((resolve) => this.readyWaiters.push(resolve))
  }

  private async dispatch(event: ChatEvent): Promise<void> {
    const rt = await this.ready()
    for (const h of this.handlers.get(event.type) ?? []) {
      try {
        await h.run(event, rt)
      } catch (e) {
        this.log.error(`event handler "${h.name}" failed on ${event.type}: ${describeError(e)}`, e)
      }
    }
  }
}
