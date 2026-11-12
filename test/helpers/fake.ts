/**
 * Test harness: a fake chat core that records commands sent by the bot, plus chat item builders.
 * Lets the dispatcher, context, live messages and commands run end-to-end without the native library.
 */
import {mkdtempSync} from "node:fs"
import {tmpdir} from "node:os"
import path from "node:path"
import type {CEvt, T} from "@simplex-chat/types"
import {loadConfig, type RubiConfig} from "../../src/config"
import {RateLimiter} from "../../src/core/cooldowns"
import {ChatData} from "../../src/core/data"
import {Dispatcher} from "../../src/core/dispatcher"
import {Http} from "../../src/core/http"
import {Interactions} from "../../src/core/interactions"
import {createLogger, setLogLevel} from "../../src/core/logger"
import {Messenger} from "../../src/core/messages"
import {Pages} from "../../src/core/pages"
import {TempFiles} from "../../src/core/files"
import {Prompts} from "../../src/core/prompts"
import {CommandRegistry} from "../../src/core/registry"
import type {Runtime} from "../../src/core/runtime"
import {Scheduler} from "../../src/core/scheduler"
import {Store} from "../../src/core/store"
import {COMMANDS_DIR} from "../../src/paths"

export interface Sent {
  kind: "send" | "update" | "react" | "delete"
  ref: string
  live: boolean
  itemId: number
  text?: string
  quote?: number
  image?: string
  emoji?: string
  /** msgContent type of a sent message ("text", "image", "video", "file"…) */
  type?: string
  /** attached file path */
  file?: string
}

/** API calls other than messaging, for assertions: [method, ...args] */
export type Call = [string, ...unknown[]]

export class FakeChat {
  sent: Sent[] = []
  calls: Call[] = []
  members: T.GroupMember[] = []
  contacts: T.Contact[] = []
  groups: T.GroupInfo[] = []
  groupCustom = new Map<number, object | undefined>()
  contactCustom = new Map<number, object | undefined>()
  groupLink: string | undefined
  /** Chat history returned by apiGetChat (oldest first). */
  chatItems: T.ChatItem[] = []
  private nextId = 1000

  async sendChatCmd(cmd: string): Promise<any> {
    let m: RegExpMatchArray | null
    if ((m = cmd.match(/^\/_send (\S+)( live=on)?(?: ttl=\d+)?(?: sign=on)? json ([\s\S]*)$/))) {
      const msgs = JSON.parse(m[3]!) as T.ComposedMessage[]
      const chatItems = msgs.map((msg) => {
        const itemId = this.nextId++
        const mc = msg.msgContent as any
        this.sent.push({kind: "send", ref: m![1]!, live: !!m![2], itemId, text: mc.text, quote: msg.quotedItemId, image: mc.image, type: mc.type, file: msg.fileSource?.filePath})
        return {chatInfo: {}, chatItem: {meta: {itemId}}}
      })
      return {type: "newChatItems", chatItems}
    }
    if ((m = cmd.match(/^\/_update item (\S+) (\d+)( live=on)? json ([\s\S]*)$/))) {
      const upd = JSON.parse(m[4]!) as T.UpdatedMessage
      this.sent.push({kind: "update", ref: m[1]!, itemId: Number(m[2]), live: !!m[3], text: upd.msgContent.text})
      return {type: "chatItemUpdated"}
    }
    if ((m = cmd.match(/^\/_reaction (\S+) (\d+) (on|off) (.*)$/))) {
      const r = JSON.parse(m[4]!) as {emoji?: string}
      this.sent.push({kind: "react", ref: m[1]!, itemId: Number(m[2]), live: false, emoji: r.emoji})
      return {type: "chatItemReaction"}
    }
    if ((m = cmd.match(/^\/_delete item (\S+) (\S+)/))) {
      this.sent.push({kind: "delete", ref: m[1]!, itemId: Number(m[2]!.split(",")[0]), live: false})
      return {type: "chatItemsDeleted", chatItemDeletions: []}
    }
    throw new Error(`FakeChat: unexpected command ${cmd}`)
  }

  private call(name: string, ...args: unknown[]): void {
    this.calls.push([name, ...args])
  }

  async apiListMembers(): Promise<T.GroupMember[]> {
    return this.members
  }
  async apiListContacts(): Promise<T.Contact[]> {
    return this.contacts
  }
  async apiListGroups(): Promise<T.GroupInfo[]> {
    return this.groups
  }
  async apiGetActiveUser(): Promise<any> {
    return {userId: 1}
  }
  async apiSetGroupCustomData(groupId: number, data?: object): Promise<void> {
    this.call("apiSetGroupCustomData", groupId, data)
    this.groupCustom.set(groupId, data)
  }
  async apiSetContactCustomData(contactId: number, data?: object): Promise<void> {
    this.call("apiSetContactCustomData", contactId, data)
    this.contactCustom.set(contactId, data)
  }
  async apiRemoveMembers(groupId: number, ids: number[]): Promise<T.GroupMember[]> {
    this.call("apiRemoveMembers", groupId, ids)
    return []
  }
  async apiSetMembersRole(groupId: number, ids: number[], role: string): Promise<void> {
    this.call("apiSetMembersRole", groupId, ids, role)
  }
  async apiBlockMembersForAll(groupId: number, ids: number[], blocked: boolean): Promise<void> {
    this.call("apiBlockMembersForAll", groupId, ids, blocked)
  }
  async apiDeleteMemberChatItem(groupId: number, ids: number[]): Promise<[]> {
    this.call("apiDeleteMemberChatItem", groupId, ids)
    return []
  }
  async apiGetChat(chatType: string, chatId: number, count: number): Promise<any> {
    this.call("apiGetChat", chatType, chatId, count)
    return {chatInfo: {}, chatItems: this.chatItems.slice(-count), chatStats: {}}
  }
  async apiGetGroupLinkStr(groupId: number): Promise<string> {
    if (!this.groupLink) throw new Error("no group link")
    return this.groupLink
  }
  async apiCreateGroupLink(groupId: number): Promise<string> {
    this.call("apiCreateGroupLink", groupId)
    return (this.groupLink = "https://smp.example/g#fake")
  }
  async apiDeleteGroupLink(groupId: number): Promise<void> {
    this.call("apiDeleteGroupLink", groupId)
    this.groupLink = undefined
  }
  async apiLeaveGroup(groupId: number): Promise<void> {
    this.call("apiLeaveGroup", groupId)
  }
  async apiUpdateGroupProfile(groupId: number, profile: T.GroupProfile): Promise<any> {
    this.call("apiUpdateGroupProfile", groupId, profile)
    return {groupId, groupProfile: profile}
  }

  /** Messages/edits as plain texts, in order. */
  texts(): string[] {
    return this.sent.filter((s) => s.text !== undefined).map((s) => s.text!)
  }

  last(): Sent | undefined {
    return this.sent[this.sent.length - 1]
  }

  /** Latest text of a message (after edits). */
  textOf(itemId: number): string | undefined {
    return [...this.sent].reverse().find((s) => s.itemId === itemId && s.text !== undefined)?.text
  }
}

export interface Harness {
  rt: Runtime
  chat: FakeChat
  dispatcher: Dispatcher
  config: RubiConfig
  /** Deliver an incoming chat item and wait until the bot is done reacting to it. */
  receive(item: T.AChatItem): Promise<void>
  /** Deliver an item without waiting (for commands that wait for a follow-up message). */
  deliver(item: T.AChatItem): void
  /** Simulate a user reacting to one of the bot's messages. */
  react(chatInfo: T.ChatInfo, itemId: number, emoji: string, from: T.CIDirection, added?: boolean): Promise<void>
}

export function makeHarness(patch: (cfg: RubiConfig) => void = () => undefined): Harness {
  setLogLevel("error")
  const config = loadConfig()
  config.botAdmins = [99]
  config.live = {minUpdateIntervalMs: 5, tickerIntervalMs: 0, tickerMaxMs: 0}
  config.limits = {...config.limits, defaultCooldown: 0, floodMax: 100}
  const tmp = mkdtempSync(path.join(tmpdir(), "rubi-test-"))
  config.stateFile = path.join(tmp, "state.json")
  config.media = {...config.media, dir: path.join(tmp, "media"), ffmpeg: ""}
  patch(config)
  const log = createLogger("test")
  const chat = new FakeChat()
  const commands = new CommandRegistry(COMMANDS_DIR, log)
  commands.load()
  const store = new Store(config.stateFile, log)
  const rt: Runtime = {
    config,
    chat: chat as any,
    user: {userId: 1, profile: {displayName: "Rubi"}} as any,
    address: undefined,
    addressLink: "https://smp.example/a#rubi",
    messenger: new Messenger(chat as any, config.live, log),
    commands,
    limiter: new RateLimiter(),
    log,
    startedAt: new Date(),
    stats: {commandsRun: 0, commandsFailed: 0, perCommand: new Map()},
    http: new Http("rubi-test"),
    data: new ChatData(chat as any),
    store,
    scheduler: new Scheduler(store, log, undefined, 60_000),
    interactions: new Interactions(store, log),
    pages: new Pages(),
    tempFiles: new TempFiles(log, 20, 60_000),
    prompts: new Prompts(),
    versions: {rubi: "test", simplex: "test", node: process.versions.node},
    reloadCommands: async () => commands.load(),
  }
  const dispatcher = new Dispatcher(rt)
  return {
    rt,
    chat,
    dispatcher,
    config,
    async receive(item) {
      dispatcher.onNewChatItems({type: "newChatItems", user: rt.user, chatItems: [item]})
      await settle(dispatcher)
    },
    deliver(item) {
      dispatcher.onNewChatItems({type: "newChatItems", user: rt.user, chatItems: [item]})
    },
    async react(chatInfo, itemId, emoji, from, added = true) {
      const evt = {
        type: "chatItemReaction",
        user: rt.user,
        added,
        reaction: {chatInfo, chatReaction: {chatDir: from, chatItem: {meta: {itemId}}, sentAt: "", reaction: {type: "emoji", emoji}}},
      } as unknown as CEvt.ChatItemReaction
      await rt.interactions.onReaction(evt, rt)
      await new Promise((r) => setTimeout(r, 20))
    },
  }
}

export async function settle(dispatcher: Dispatcher): Promise<void> {
  await new Promise((r) => setTimeout(r, 15))
  while (dispatcher.activeCount > 0) await new Promise((r) => setTimeout(r, 5))
  await new Promise((r) => setTimeout(r, 15))
}

let itemSeq = 1

export function dm(text: string, opts: {contactId?: number; name?: string; live?: boolean; quotedText?: string} = {}): T.AChatItem {
  const contactId = opts.contactId ?? 7
  const item = msgItem(text, {type: "directRcv"}, opts.live)
  if (opts.quotedText !== undefined) {
    ;(item as any).quotedItem = {itemId: 500, chatDir: {type: "directRcv"}, sentAt: "", content: {type: "text", text: opts.quotedText}}
  }
  return {
    chatInfo: {type: "direct", contact: {contactId, profile: {displayName: opts.name ?? "alice"}}},
    chatItem: item,
  } as any
}

export interface GroupOpts {
  role?: T.GroupMemberRole
  botRole?: T.GroupMemberRole
  memberId?: number
  contactId?: number
  name?: string
  /** The message @mentions Rubi. */
  mention?: boolean
  /** The message is a reply to one of Rubi's messages (chat core flags it as userMention too). */
  replyToBot?: boolean
  quote?: {itemId: number; chatDir?: T.CIDirection; text?: string}
  /** The group has a bot command menu (/groupmenu) → commands are tappable there. */
  menu?: boolean
}

export function member(groupMemberId: number, name: string, role: string = "member"): T.GroupMember {
  return {
    groupMemberId,
    memberId: `mid-${groupMemberId}`,
    memberRole: role,
    memberStatus: "connected",
    memberProfile: {displayName: name},
    localDisplayName: name,
    blockedByAdmin: false,
    createdAt: new Date(0).toISOString(),
  } as any
}

export function groupMsg(text: string, opts: GroupOpts = {}): T.AChatItem {
  const m = {...member(opts.memberId ?? 2, opts.name ?? "bob", opts.role ?? "member"), memberContactId: opts.contactId}
  const item = msgItem(text, {type: "groupRcv", groupMember: m})
  ;(item.meta as any).userMention = !!opts.mention || !!opts.replyToBot
  if (opts.mention) (item as any).mentions = {Rubi: {memberId: "mid-1", memberRef: {groupMemberId: 1, displayName: "Rubi", memberRole: "admin"}}}
  if (opts.quote) (item as any).quotedItem = {itemId: opts.quote.itemId, chatDir: opts.quote.chatDir ?? {type: "groupRcv"}, sentAt: "", content: {type: "text", text: opts.quote.text ?? ""}}
  return {
    chatInfo: {
      type: "group",
      groupInfo: {
        groupId: 5,
        groupProfile: {
          displayName: "Club",
          fullName: "",
          ...(opts.menu ? {groupPreferences: {commands: [{type: "command", keyword: "help", label: "help"}]}} : {}),
        },
        membership: {...member(1, "Rubi", opts.botRole ?? "admin")},
        groupSummary: {currentMembers: 3},
      },
    },
    chatItem: item,
  } as any
}

function msgItem(text: string, chatDir: unknown, live = false): T.ChatItem {
  return {
    chatDir,
    meta: {itemId: itemSeq++, itemLive: live, userMention: false, itemTs: new Date().toISOString()},
    content: {type: "rcvMsgContent", msgContent: {type: "text", text}},
    mentions: {},
    reactions: [],
  } as any
}
