/**
 * Keep an in-memory Map or Set at most `max` entries by deleting the oldest (insertion order) ones.
 * To keep an entry "fresh", delete and re-add it before calling this (Maps and Sets keep insertion order).
 *
 *   lastPost.delete(key); lastPost.set(key, now); capSize(lastPost, 20_000)
 */
export function capSize(c: Map<unknown, unknown> | Set<unknown>, max: number): void {
  if (c.size <= max) return
  let excess = c.size - max
  for (const key of c.keys()) {
    if (excess-- <= 0) break
    c.delete(key)
  }
}
