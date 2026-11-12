import {randomBytes} from "node:crypto"
import {describeError} from "./errors"
import type {Logger} from "./logger"
import type {Runtime} from "./runtime"
import type {Collection, Store} from "./store"

export interface Job<P = unknown> {
  id: string
  kind: string
  /** Due time (epoch ms). */
  at: number
  payload: P
  createdAt: number
  attempts?: number
  failedAt?: number
  lastError?: string
  retryAt?: number
}

/** Return a due time (epoch ms) to run the same job again later (recurring jobs); return nothing to finish it. */
export type JobHandler<P = any> = (job: Job<P>, rt: Runtime) => void | number | Promise<void | number>

/** Jobs that failed permanently are kept this long for inspection, then deleted. */
const FAILED_KEEP_MS = 7 * 86_400_000

/** Job handlers by kind — filled by `defineJob` at module load. */
export const jobKinds = new Map<string, JobHandler>()

/** Register what runs when a job of this kind is due (call at module load, e.g. in the command file). */
export function defineJob<P>(kind: string, handler: JobHandler<P>): void {
  jobKinds.set(kind, handler as JobHandler)
}

/**
 * Persistent scheduled jobs: they survive restarts (stored in the Store) and run once when due.
 * Jobs that came due while the bot was offline run right after it starts.
 *
 *   // once, at module load (e.g. in a command file):
 *   defineJob("reminder", async (job, rt) => { ... })
 *   // later:
 *   rt.scheduler.schedule("reminder", Date.now() + 60_000, {text: "hi"})
 */
export class Scheduler {
  private readonly jobs: Collection<Job>
  private timer: NodeJS.Timeout | undefined
  private running = new Set<string>()
  private warned = new Set<string>()
  private rt: Runtime | undefined
  private accepting = true
  private active = new Set<Promise<void>>()

  get runningCount(): number {
    return this.running.size
  }

  get failedCount(): number {
    return this.jobs.values().filter((j) => !!j.failedAt).length
  }

  constructor(
    store: Store,
    private readonly log: Logger,
    private readonly handlers: ReadonlyMap<string, JobHandler> = jobKinds,
    private readonly tickMs = 2_000
  ) {
    this.jobs = store.collection<Job>("jobs")
  }

  start(rt: Runtime): void {
    this.rt = rt
    this.accepting = true
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.tickMs)
    this.timer.unref()
    void this.tick()
  }

  stop(): void {
    this.accepting = false
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  schedule<P>(kind: string, at: number | Date, payload: P): Job<P> {
    const job: Job<P> = {id: newId(), kind, at: +at, payload, createdAt: Date.now()}
    this.jobs.set(job.id, job)
    return job
  }

  cancel(id: string): boolean {
    return this.jobs.delete(id)
  }

  cancelWhere(predicate: (job: Job) => boolean): number {
    let count = 0
    for (const job of this.jobs.values()) if (predicate(job) && this.jobs.delete(job.id)) count++
    return count
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  /** Pending jobs, soonest first. */
  list<P = unknown>(filter?: (job: Job<P>) => boolean): Job<P>[] {
    return (this.jobs.values() as Job<P>[]).filter((j) => !filter || filter(j)).sort((a, b) => a.at - b.at)
  }

  /** Run due jobs now (also called by the interval). */
  async tick(): Promise<void> {
    const rt = this.rt
    if (!rt || !this.accepting) return
    const now = Date.now()
    for (const job of this.jobs.values()) {
      if (job.failedAt && job.failedAt < now - FAILED_KEEP_MS) {
        this.jobs.delete(job.id)
        this.log.info(`deleted job ${job.kind}/${job.id} that failed on ${new Date(job.failedAt).toISOString()}`)
        continue
      }
      if (job.at > now || (job.retryAt ?? 0) > now || job.failedAt || this.running.has(job.id)) continue
      const handler = this.handlers.get(job.kind)
      if (!handler) {
        // keep it: the handler's file may just have failed to load
        if (!this.warned.has(job.kind)) this.log.warn(`no handler for job kind "${job.kind}" — keeping job(s) until one is registered`)
        this.warned.add(job.kind)
        continue
      }
      this.running.add(job.id)
      const work = Promise.resolve()
        .then(() => handler(job, rt))
        .then((next) => {
          // `has`: a job cancelled while it ran stays cancelled
          if (typeof next === "number" && this.jobs.has(job.id)) {
            this.jobs.set(job.id, {...job, at: next, attempts: undefined, retryAt: undefined, lastError: undefined})
          } else this.jobs.delete(job.id)
        })
        .catch((e) => {
          const attempts = (job.attempts ?? 0) + 1
          const message = describeError(e)
          if (attempts >= 3) {
            this.jobs.set(job.id, {...job, attempts, failedAt: Date.now(), lastError: message, retryAt: undefined})
            this.log.error(`job ${job.kind}/${job.id} failed permanently: ${message}`, e)
          } else {
            const retryAt = Date.now() + 1_000 * 2 ** (attempts - 1)
            this.jobs.set(job.id, {...job, attempts, lastError: message, retryAt})
            this.log.warn(`job ${job.kind}/${job.id} failed; retry ${attempts}/3 at ${new Date(retryAt).toISOString()}: ${message}`)
          }
        })
        .finally(() => {
          this.running.delete(job.id)
          this.active.delete(work)
        })
      this.active.add(work)
    }
  }

  async drain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.active.size && Date.now() < deadline) {
      await Promise.race([...this.active, new Promise<void>((resolve) => setTimeout(resolve, 50))])
    }
  }
}

/** Short, readable id (also used for buttons like /'unremind ab12cd'). */
export function newId(bytes = 3): string {
  return randomBytes(bytes).toString("hex")
}
