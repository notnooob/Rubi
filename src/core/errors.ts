import {randomBytes} from "node:crypto"

/**
 * Throw these from commands to show a friendly message to the user.
 * Anything else that escapes a command is treated as an internal error:
 * it is logged with a reference id and the user gets a generic message.
 */
export class CommandError extends Error {
  override name = "CommandError"
  /** Emoji shown before the message. */
  icon = "❌"
}

/** Wrong arguments — the reply also shows the command usage. */
export class UsageError extends CommandError {
  override name = "UsageError"
}

/** The user (or the bot) lacks the role required for the command. */
export class PermissionError extends CommandError {
  override name = "PermissionError"
  override icon = "🔒"
}

/** Command used in the wrong kind of chat (e.g. group-only command in a DM). */
export class ScopeError extends CommandError {
  override name = "ScopeError"
  override icon = "🚫"
}

/** Per-user cooldown / anti-flood. */
export class CooldownError extends CommandError {
  override name = "CooldownError"
  override icon = "⏱"
  constructor(
    message: string,
    public readonly retryAfterMs: number,
    /** When true, the dispatcher drops the command without replying (anti-flood). */
    public readonly silent = false
  ) {
    super(message)
  }
}

/** Command exceeded its timeout. */
export class TimeoutError extends CommandError {
  override name = "TimeoutError"
  override icon = "⌛"
}

/** Short random id to correlate a user-visible error with the log line. */
export function errorRef(): string {
  return randomBytes(3).toString("hex").toUpperCase()
}

/**
 * Human-readable summary of errors thrown by the simplex-chat library:
 * - `api.ChatCommandError` — unexpected response, has `.response`
 * - `core.ChatAPIError` — chat core error, has `.chatError`
 * - responses of type `chatCmdError`
 */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const anyE = e as any
  const parts = [e.message]
  const resp = anyE.response
  if (resp?.type) {
    parts.push(`response=${resp.type}`)
    if (resp.type === "chatCmdError" && resp.chatError) parts.push(describeChatError(resp.chatError))
  }
  if (anyE.chatError) parts.push(describeChatError(anyE.chatError))
  return parts.join(" | ")
}

export function describeChatError(ce: any): string {
  if (!ce || typeof ce !== "object") return String(ce)
  switch (ce.type) {
    case "error":
      return `chatError=${ce.errorType?.type ?? "?"}${extra(ce.errorType)}`
    case "errorStore":
      return `storeError=${ce.storeError?.type ?? "?"}${extra(ce.storeError)}`
    case "errorAgent":
      return `agentError=${ce.agentError?.type ?? "?"}${extra(ce.agentError)}`
    default:
      return `chatError=${JSON.stringify(ce).slice(0, 300)}`
  }
}

function extra(o: any): string {
  if (!o || typeof o !== "object") return ""
  const {type: _t, ...rest} = o
  const s = JSON.stringify(rest)
  return s === "{}" ? "" : ` ${s.slice(0, 300)}`
}

/** Tag of the chat core error (e.g. "groupUserRole", "contactNotReady"), if the error came from chat core. */
export function chatErrorType(e: unknown): string | undefined {
  const ce = (e as any)?.chatError ?? (e as any)?.response?.chatError
  return ce?.errorType?.type ?? ce?.storeError?.type ?? ce?.agentError?.type
}
