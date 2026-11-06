import type {T} from "@simplex-chat/types"
import * as fmt from "./format"

/**
 * Chat-aware rendering of commands and buttons.
 *
 * The SimpleX apps make `/commands` in messages tappable only when the chat "uses commands"
 * (apps' ChatInfo.useCommands, Android/desktop and iOS alike):
 *   - direct chats with a bot (peerType = bot) → always, so DMs with Rubi
 *   - groups → only when the group profile has a bot command menu (groupPreferences.commands),
 *     which only group owners can set — see /groupmenu
 * Elsewhere `/'cmd params'` shows as raw text with quotes. So:
 *   - tappable chats: real buttons
 *   - other chats: commands as `code`, and only *important* buttons (help, confirm, paging…) are shown at all
 */
export interface Ui {
  /** Commands are tappable in this chat. */
  readonly tappable: boolean
  readonly prefix: string
  /** A command reference: tappable `/'help ping'`, or `` `/help ping` `` where it can't be tapped. */
  cmd(name: string, params?: string): string
  /**
   * A button: `🔁 /'roll 2d6'`. Where commands can't be tapped, non-important buttons are omitted ("")
   * and important ones render as `` 🔁 `/roll 2d6` `` so people can type them.
   */
  button(label: string, name: string, params?: string, opts?: {important?: boolean}): string
  /** A row of buttons; empty ones are dropped (returns "" if none are left). */
  buttons(items: (string | false | undefined)[], sep?: string): string
}

export function commandsTappable(cInfo: T.ChatInfo): boolean {
  switch (cInfo.type) {
    case "direct":
      // DMs with Rubi: the contact sees Rubi as a bot
      return true
    case "group":
      return (cInfo.groupInfo.groupProfile.groupPreferences?.commands?.length ?? 0) > 0
    default:
      return false
  }
}

export function makeUi(tappable: boolean, prefix = "/"): Ui {
  const plain = (name: string, params?: string) => `${prefix}${name}${params?.trim() ? ` ${params.trim()}` : ""}`
  const cmd = (name: string, params?: string) => (tappable ? fmt.command(name, params, prefix) : fmt.code(plain(name, params)))
  return {
    tappable,
    prefix,
    cmd,
    button(label, name, params, opts) {
      if (!tappable && !opts?.important) return ""
      return label ? `${label} ${cmd(name, params)}` : cmd(name, params)
    },
    buttons(items, sep = "  ·  ") {
      return fmt.buttons(items.filter((s) => !!s), sep)
    },
  }
}

export function uiFor(cInfo: T.ChatInfo, prefix = "/"): Ui {
  return makeUi(commandsTappable(cInfo), prefix)
}
