import type {T} from "@simplex-chat/types"

/**
 * Lets a running command wait for the same user's next message in the same chat
 * (`ctx.awaitReply()`, `ctx.confirm()`). The dispatcher offers every incoming message here first;
 * a waiter decides to take it, treat it as cancel, or skip it (then it's processed normally).
 */
export type PromptVerdict = "take" | "cancel" | "skip"

export interface PromptResult {
  status: "reply" | "cancel" | "timeout"
  text?: string
  item?: T.AChatItem
}

interface Waiter {
  accept(text: string): PromptVerdict
  finish(result: PromptResult): void
}

export class Prompts {
  private waiters = new Map<string, Waiter>()

  /** Key for a user in a chat: `${chatKey}|${senderKey}`. */
  wait(key: string, accept: (text: string) => PromptVerdict, timeoutMs: number, signal?: AbortSignal): Promise<PromptResult> {
    // a newer prompt for the same user replaces the old one
    this.waiters.get(key)?.finish({status: "cancel"})
    return new Promise((resolve) => {
      let done = false
      const finish = (r: PromptResult) => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        if (this.waiters.get(key) === waiter) this.waiters.delete(key)
        resolve(r)
      }
      const onAbort = () => finish({status: "cancel"})
      const timer = setTimeout(() => finish({status: "timeout"}), timeoutMs)
      timer.unref()
      signal?.addEventListener("abort", onAbort, {once: true})
      const waiter: Waiter = {accept, finish}
      this.waiters.set(key, waiter)
    })
  }

  /** Called by the dispatcher. Returns true when the message was consumed by a waiting command. */
  offer(key: string, item: T.AChatItem, text: string): boolean {
    const w = this.waiters.get(key)
    if (!w) return false
    const verdict = w.accept(text)
    if (verdict === "skip") return false
    w.finish(verdict === "take" ? {status: "reply", text, item} : {status: "cancel", text, item})
    return true
  }

  has(key: string): boolean {
    return this.waiters.has(key)
  }

  cancelAll(): void {
    for (const w of [...this.waiters.values()]) w.finish({status: "cancel"})
  }
}
