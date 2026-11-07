import type {T} from "@simplex-chat/types"
import type {api} from "simplex-chat"
import type {RubiConfig} from "../config"
import {readFileSync} from "node:fs"
import path from "node:path"
import {COMMANDS_DIR, EVENTS_DIR, ROOT_DIR} from "../paths"
import {chatName, contactLinkStr} from "../util/chat"
import {RateLimiter} from "./cooldowns"
import {ChatData} from "./data"
import {Http} from "./http"
import {Interactions} from "./interactions"
import {acquireLock} from "./lock"
import {Pages} from "./pages"
import {Prompts} from "./prompts"
import {Scheduler} from "./scheduler"
import {Store} from "./store"
import {Dispatcher} from "./dispatcher"
import {describeChatError, describeError} from "./errors"
import {EventBus} from "./events"
import {TempFiles} from "./files"
import {botMenuBudget, groupMenuBudget} from "./profile"
import {sweepMedia} from "../util/media"
import {logger as rootLogger, type Logger} from "./logger"
import {Messenger} from "./messages"
import {CommandRegistry} from "./registry"
import type {Runtime, Stats} from "./runtime"

type SimplexModule = typeof import("simplex-chat")

/** Raised when the native SimpleX library can't be loaded (package not built for this platform). */
export class NativeLibraryError extends Error {
  override name = "NativeLibraryError"
}

/**
 * The bot. Wires the chat core (via `bot.run`), the command registry, event handlers and the dispatcher.
 *
 *   const rubi = new Rubi(loadConfig()); await rubi.start(); ... await rubi.stop()
 */
export class Rubi implements Runtime {
  readonly log: Logger = rootLogger
  readonly commands: CommandRegistry
  readonly events: EventBus
  readonly limiter = new RateLimiter()
  readonly stats: Stats = {commandsRun: 0, commandsFailed: 0, perCommand: new Map()}
  readonly startedAt = new Date()
  readonly http: Http
  readonly store: Store
  readonly scheduler: Scheduler
  readonly interactions: Interactions
  readonly tempFiles: TempFiles
  readonly pages = new Pages()
  readonly prompts = new Prompts()
  readonly versions = {rubi: readVersion(ROOT_DIR), simplex: "?", node: process.versions.node}

  private _chat: api.ChatApi | undefined
  private _user: T.User | undefined
  private _address: T.UserContactLink | undefined
  private _messenger: Messenger | undefined
  private _data: ChatData | undefined
  private dispatcher: Dispatcher | undefined
  private stopping: Promise<void> | undefined
  private releaseLock: (() => void) | undefined

  constructor(readonly config: RubiConfig) {
    this.commands = new CommandRegistry(COMMANDS_DIR, this.log.child("commands"))
    this.events = new EventBus(this.log.child("events"))
    this.http = new Http(config.http.userAgent, config.http.proxy)
    this.store = new Store(path.resolve(config.stateFile), this.log.child("store"))
    this.scheduler = new Scheduler(this.store, this.log.child("scheduler"))
    this.interactions = new Interactions(this.store, this.log.child("interactions"))
    this.tempFiles = new TempFiles(this.log.child("files"))
  }

  get chat(): api.ChatApi {
    if (!this._chat) throw new Error("Rubi is not started")
    return this._chat
  }
  get user(): T.User {
    if (!this._user) throw new Error("Rubi is not started")
    return this._user
  }
  get address(): T.UserContactLink | undefined {
    return this._address
  }
  get addressLink(): string | undefined {
    return this._address ? contactLinkStr(this._address.connLinkContact) : undefined
  }
  get messenger(): Messenger {
    if (!this._messenger) throw new Error("Rubi is not started")
    return this._messenger
  }
  get data(): ChatData {
    if (!this._data) throw new Error("Rubi is not started")
    return this._data
  }

  async start(): Promise<void> {
    const cfg = this.config
    // one instance per database (SQLite: next to the DB files; Postgres: next to the state file)
    const lockBase = cfg.db.type === "sqlite" ? cfg.db.filePrefix : cfg.stateFile
    this.releaseLock = acquireLock(path.resolve(`${lockBase}.lock`))
    const {bot} = loadSimplex()
    this.versions.simplex = readVersion(path.dirname(require.resolve("simplex-chat/package.json")))
    if (cfg.http.proxy) this.log.info(`HTTP requests go through proxy ${cfg.http.proxy.replace(/\/\/[^@]*@/, "//***@")}`)

    this.commands.load()
    this.registerCoreEvents()
    this.events.loadDir(EVENTS_DIR)

    const [chat, user, address] = await bot.run({
      profile: {...cfg.profile},
      dbOpts: cfg.db,
      options: {
        createAddress: cfg.address.create,
        updateAddress: true,
        updateProfile: true,
        addressSettings: {autoAccept: true, welcomeMessage: cfg.welcomeMessage, businessAddress: cfg.address.business},
        allowFiles: cfg.allowFiles,
        commands: this.botMenu(this.store.collection<string>("profile").get("contactLink")),
        useBotProfile: true,
        logContacts: cfg.log.contacts,
        logNetwork: cfg.log.network,
      },
      events: this.events.subscribers(),
    })

    this._chat = chat
    this._user = user
    this._address = address
    // remember the address link: next start, the menu budget can use its real length instead of a reserve
    if (this.addressLink) this.store.collection<string>("profile").set("contactLink", this.addressLink)
    this._messenger = new Messenger(chat, cfg.live, this.log.child("messages"))
    this._data = new ChatData(chat)
    this.events.setReady(this)
    this.scheduler.start(this)
    // attachments left over from a previous run (their uploads are done or gone by now)
    void sweepMedia(cfg.media.dir, 0)
    void this.syncGroupMenus().catch((e) => this.log.warn("group menu sync failed:", describeError(e)))

    this.log.info(`${user.profile.displayName} is online (user #${user.userId}) — ${this.commands.all().length} command(s).`)
    if (this.addressLink) this.log.info(`Connect: ${this.addressLink}`)
    if (cfg.botAdmins.length === 0) {
      this.log.info("No bot admins configured. Set RUBI_BOT_ADMINS=<contactId,...> — contact ids are logged as `contact #<id>` when users connect.")
    }
  }

  /** Graceful shutdown: finish/interrupt running commands, stop chat core, close the database. */
  stop(reason = "shutdown"): Promise<void> {
    this.stopping ??= (async () => {
      this.log.info(`stopping (${reason})…`)
      await this.dispatcher?.drain(10_000)
      this.scheduler.stop()
      this.store.flush()
      this.releaseLock?.()
      if (this._chat) {
        try {
          await this._chat.stopChat()
        } catch (e) {
          this.log.warn("stopChat failed:", describeError(e))
        }
        try {
          await this._chat.close()
        } catch (e) {
          this.log.warn("close failed:", describeError(e))
        }
      }
      this.log.info("stopped.")
    })()
    return this.stopping
  }

  /** Reload commands and the app command menu without restarting. */
  async reloadCommands(): Promise<{loaded: number; errors: string[]}> {
    const result = this.commands.load()
    try {
      await this.updateMenu()
      await this.syncGroupMenus()
    } catch (e) {
      this.log.warn("could not update command menu:", describeError(e))
    }
    return result
  }

  /**
   * Refresh the command menu of groups that enabled /groupmenu (where Rubi is owner), so it matches the
   * current commands. Only updates groups whose menu actually changed.
   */
  async syncGroupMenus(): Promise<void> {
    const groups = await this.chat.apiListGroups(this.user.userId)
    for (const g of groups) {
      const current = g.groupProfile.groupPreferences?.commands
      if (!current?.length || g.membership.memberRole !== "owner") continue
      const menu = this.commands.menu({forGroup: true, maxBytes: groupMenuBudget(g.groupProfile)})
      if (JSON.stringify(current) === JSON.stringify(menu)) continue
      try {
        await this.chat.apiUpdateGroupProfile(g.groupId, {...g.groupProfile, groupPreferences: {...g.groupProfile.groupPreferences, commands: menu}})
        this.log.info(`updated command menu of #${g.groupProfile.displayName}`)
      } catch (e) {
        this.log.warn(`could not update command menu of #${g.groupProfile.displayName}: ${describeError(e)}`)
      }
    }
  }

  /** Push the current command list to the bot profile (shown in the app's "/" menu). */
  /**
   * The bot's command menu, shrunk if needed so the whole profile (avatar, address link, menu) stays under
   * SimpleX's profile size limit. Logs a warning when it had to shrink.
   */
  private botMenu(contactLink: string | undefined): T.ChatBotCommand[] {
    const budget = botMenuBudget(this.config.profile, {allowFiles: this.config.allowFiles, contactLink})
    const {menu, level, dropped} = this.commands.menuWithin({maxBytes: budget})
    if (dropped) this.log.warn(`the profile is too full for the whole command menu: ${dropped} command(s) left out. Use a smaller RUBI_AVATAR.`)
    else if (level !== "full") this.log.info(`command menu shortened (${level}) to fit the profile size limit`)
    return menu
  }

  async updateMenu(): Promise<void> {
    const prefs = {...(this.user.profile.preferences ?? {}), commands: this.botMenu(this.addressLink)}
    const profile: T.Profile = {...this.config.profile, contactLink: this.addressLink, peerType: this.user.profile.peerType, preferences: prefs}
    const summary = await this.chat.apiUpdateProfile(this.user.userId, profile)
    if (summary) this.log.info(`command menu updated for ${summary.updateSuccesses} contact(s)`)
    const u = await this.chat.apiGetActiveUser()
    if (u) this._user = u
  }

  private registerCoreEvents(): void {
    const dispatcher = new Dispatcher(this)
    this.dispatcher = dispatcher
    const log = this.log.child("core")

    this.events.on("newChatItems", "core:dispatch", (e) => dispatcher.onNewChatItems(e))
    this.events.on("chatItemUpdated", "core:live-messages", (e) => dispatcher.onChatItemUpdated(e))
    this.events.on("chatItemReaction", "core:interactions", (e, rt) => this.interactions.onReaction(e, rt))
    // temporary attachments are deleted once SimpleX has uploaded them
    this.events.on("sndFileCompleteXFTP", "core:temp-files", ({chatItem}) => this.tempFiles.uploaded(chatItem.chatItem.meta.itemId))
    this.events.on("sndFileError", "core:temp-files", ({chatItem_, errorMessage}) => {
      if (chatItem_) this.tempFiles.failed(chatItem_.chatItem.meta.itemId)
      log.warn(`file upload failed: ${errorMessage}`)
    })

    // contact ids are what RUBI_BOT_ADMINS takes
    this.events.on("contactConnected", "core:log", ({contact}) => log.info(`contact #${contact.contactId} @${contact.profile.displayName} connected`))
    this.events.on("receivedGroupInvitation", "core:log", ({groupInfo, contact, memberRole}) =>
      log.info(`invited to #${groupInfo.groupProfile.displayName} as ${memberRole} by @${contact.profile.displayName} (contact #${contact.contactId})`)
    )
    this.events.on("userJoinedGroup", "core:log", ({groupInfo}) => log.info(`joined #${groupInfo.groupProfile.displayName} (group #${groupInfo.groupId})`))
    this.events.on("deletedMemberUser", "core:log", ({groupInfo, member}) =>
      log.info(`removed from #${groupInfo.groupProfile.displayName} by @${member.memberProfile.displayName}`)
    )
    this.events.on("memberRole", "core:log", ({groupInfo, member, toRole}) => {
      if (member.groupMemberId === groupInfo.membership.groupMemberId) log.info(`my role in #${groupInfo.groupProfile.displayName} is now ${toRole}`)
    })
    this.events.on("messageError", "core:log", ({severity, errorMessage}) => log.warn(`message error (${severity}): ${errorMessage}`))
    this.events.on("chatError", "core:log", ({chatError}) => log.warn(`chat error: ${describeChatError(chatError)}`))
    this.events.on("chatErrors", "core:log", ({chatErrors}) => log.warn(`${chatErrors.length} chat error(s): ${chatErrors.map(describeChatError).join("; ")}`))
    this.events.on("chatItemReaction", "core:log", ({added, reaction}) =>
      log.debug(`${added ? "+" : "-"}reaction in ${chatName(reaction.chatInfo)}`)
    )
  }
}

function readVersion(dir: string): string {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version ?? "?"
  } catch {
    return "?"
  }
}

/** Load the simplex-chat package (which loads the native library) with a friendly error. */
function loadSimplex(): SimplexModule {
  try {
    return require("simplex-chat") as SimplexModule
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === "MODULE_NOT_FOUND" || /simplex\.node|build[\\/]Release|libsimplex|dlopen|\.dll|\.so|\.dylib/i.test(err.message)) {
      throw new NativeLibraryError(
        [
          "The SimpleX native library is not built/installed for this platform.",
          `  Cause: ${err.message.split("\n")[0]}`,
          "  Fix: reinstall the package with its install scripts enabled:",
          "       npm rebuild simplex-chat   (or: npm install)",
          "  On Windows this needs the Visual Studio Build Tools with the 'Desktop development with C++' workload",
          "  (and Python) for node-gyp. Alternatively run the bot under WSL/Linux or macOS.",
        ].join("\n")
      )
    }
    throw e
  }
}
