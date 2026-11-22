import type {Runtime, Stats} from "./runtime"
import type {Store} from "./store"

/**
 * Command counters that survive restarts, saved in the state file (`stats` collection, key `totals`).
 * `/stats` and `/about` show them with the date counting began.
 */
interface SavedStats {
  since: number
  commandsRun: number
  commandsFailed: number
  perCommand: Record<string, number>
}

const KEY = "totals"

export function loadStats(store: Store): Stats {
  const saved = store.collection<SavedStats>("stats").get(KEY)
  return {
    since: saved?.since ?? Date.now(),
    commandsRun: saved?.commandsRun ?? 0,
    commandsFailed: saved?.commandsFailed ?? 0,
    perCommand: new Map(Object.entries(saved?.perCommand ?? {})),
  }
}

/** Save the current counters (the store batches writes). */
export function recordStats(rt: Pick<Runtime, "stats" | "store">): void {
  const s = rt.stats
  rt.store.collection<SavedStats>("stats").set(KEY, {
    since: s.since,
    commandsRun: s.commandsRun,
    commandsFailed: s.commandsFailed,
    perCommand: Object.fromEntries(s.perCommand),
  })
}
