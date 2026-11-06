/**
 * In-memory rate limiting:
 * - per user + command cooldowns
 * - per user anti-flood (sliding window across all commands)
 * - generic "at most once per N ms" throttles (e.g. hint replies)
 */
export class RateLimiter {
  private lastUse = new Map<string, number>()
  private hits = new Map<string, number[]>()
  private warned = new Map<string, number>()
  private throttles = new Map<string, number>()
  private sweeper: NodeJS.Timeout

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 10 * 60_000)
    this.sweeper.unref()
  }

  /** Remaining cooldown in ms for this user+command (0 = ready). Records the use when ready. */
  cooldown(userKey: string, command: string, seconds: number): number {
    if (seconds <= 0) return 0
    const key = `${userKey}|${command}`
    const now = Date.now()
    const last = this.lastUse.get(key)
    const remaining = last === undefined ? 0 : last + seconds * 1000 - now
    if (remaining > 0) return remaining
    this.lastUse.set(key, now)
    return 0
  }

  /**
   * Record a command attempt. Returns `ok` when under the limit; otherwise whether the user
   * should be warned (once per window) and when they can retry.
   */
  flood(userKey: string, max: number, windowMs: number): {ok: true} | {ok: false; warn: boolean; retryAfterMs: number} {
    if (max <= 0) return {ok: true}
    const now = Date.now()
    const list = (this.hits.get(userKey) ?? []).filter((t) => t > now - windowMs)
    if (list.length >= max) {
      this.hits.set(userKey, list)
      const lastWarn = this.warned.get(userKey) ?? 0
      const warn = lastWarn < now - windowMs
      if (warn) this.warned.set(userKey, now)
      return {ok: false, warn, retryAfterMs: list[0]! + windowMs - now}
    }
    list.push(now)
    this.hits.set(userKey, list)
    return {ok: true}
  }

  /** True at most once per `ms` for a key. */
  throttle(key: string, ms: number): boolean {
    const now = Date.now()
    const last = this.throttles.get(key)
    if (last !== undefined && now - last < ms) return false
    this.throttles.set(key, now)
    return true
  }

  /** Forget a user's cooldown for a command (e.g. when the command failed validation). */
  reset(userKey: string, command: string): void {
    this.lastUse.delete(`${userKey}|${command}`)
  }

  private sweep(): void {
    const cutoff = Date.now() - 60 * 60_000
    for (const map of [this.lastUse, this.warned, this.throttles]) {
      for (const [k, t] of map) if (t < cutoff) map.delete(k)
    }
    for (const [k, list] of this.hits) if ((list[list.length - 1] ?? 0) < cutoff) this.hits.delete(k)
  }
}
