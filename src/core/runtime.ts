import type {T} from "@simplex-chat/types"
import type {api} from "simplex-chat"
import type {RubiConfig} from "../config"
import type {RateLimiter} from "./cooldowns"
import type {ChatData} from "./data"
import type {TempFiles} from "./files"
import type {Http} from "./http"
import type {Interactions} from "./interactions"
import type {Logger} from "./logger"
import type {Messenger} from "./messages"
import type {Pages} from "./pages"
import type {Prompts} from "./prompts"
import type {CommandRegistry} from "./registry"
import type {Scheduler} from "./scheduler"
import type {Store} from "./store"

export interface Stats {
  commandsRun: number
  commandsFailed: number
  perCommand: Map<string, number>
}

/**
 * Everything a command or event handler can reach. Implemented by the `Rubi` class.
 * (An interface so modules can depend on it without import cycles.)
 */
export interface Runtime {
  readonly config: RubiConfig
  /** Raw chat API — every `api*` method of the simplex-chat library, plus `sendChatCmd` for anything else. */
  readonly chat: api.ChatApi
  /** The bot's own user profile in chat core. */
  readonly user: T.User
  /** The bot's long-term SimpleX address (if created). */
  readonly address: T.UserContactLink | undefined
  /** Bot address as a link string, if any. */
  readonly addressLink: string | undefined
  readonly messenger: Messenger
  readonly commands: CommandRegistry
  readonly limiter: RateLimiter
  readonly log: Logger
  readonly startedAt: Date
  readonly stats: Stats
  /** HTTP client (prefer `ctx.http` in commands — it's cancelled with the command). */
  readonly http: Http
  /** Per-group / per-contact settings stored in the chat database. */
  readonly data: ChatData
  /** Persistent JSON key-value store (storage/rubi-state.json). */
  readonly store: Store
  /** Persistent scheduled jobs. */
  readonly scheduler: Scheduler
  /** Reaction / button interactive messages. */
  readonly interactions: Interactions
  /** Temporary attachment files, deleted once uploaded. */
  readonly tempFiles: TempFiles
  /** Paginated lists. */
  readonly pages: Pages
  /** Waiting for a user's next message (`ctx.awaitReply`, `ctx.confirm`). */
  readonly prompts: Prompts
  /** Versions shown in /about. */
  readonly versions: {rubi: string; simplex: string; node: string}
  /** Reload command files and push the new menu (bot admins: /reload). */
  reloadCommands(): Promise<{loaded: number; errors: string[]}>
}
