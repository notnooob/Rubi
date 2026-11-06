import {T} from "@simplex-chat/types"

/**
 * Small, dependency-free helpers for chat core types.
 * (Equivalent helpers exist in `simplex-chat`'s `util` namespace, but importing that
 * package at runtime loads the native library — these keep core modules testable without it.)
 */

/** ChatRef used to send/edit/react in a chat. Keeps the group "member support" scope, if any. */
export function chatRefOf(cInfo: T.ChatInfo): T.ChatRef | undefined {
  switch (cInfo.type) {
    case "direct":
      return {chatType: T.ChatType.Direct, chatId: cInfo.contact.contactId}
    case "group": {
      const scope = cInfo.groupChatScope
      const chatScope: T.GroupChatScope | undefined =
        scope?.type === "memberSupport" ? {type: "memberSupport", groupMemberId_: scope.groupMember_?.groupMemberId} : undefined
      return {chatType: T.ChatType.Group, chatId: cInfo.groupInfo.groupId, chatScope}
    }
    default:
      return undefined
  }
}

/** Stable string key for a chat, e.g. "direct:12" or "group:4". */
export function chatKey(ref: T.ChatRef): string {
  const scope = ref.chatScope?.type === "memberSupport" ? `:support:${ref.chatScope.groupMemberId_ ?? "self"}` : ""
  return `${ref.chatType}:${ref.chatId}${scope}`
}

/** Text of a message item (sent or received), if it has message content. */
export function itemText(ci: T.ChatItem): string | undefined {
  const c = ci.content
  return c.type === "rcvMsgContent" || c.type === "sndMsgContent" ? c.msgContent.text : undefined
}

/** "@Alice", "#Group", "#Group (support Bob)", ... */
export function chatName(cInfo: T.ChatInfo): string {
  switch (cInfo.type) {
    case "direct":
      return `@${cInfo.contact.profile.displayName}`
    case "group": {
      const scope = cInfo.groupChatScope
      const s = scope?.type === "memberSupport" ? ` (support${scope.groupMember_ ? ` ${scope.groupMember_.memberProfile.displayName}` : ""})` : ""
      return `#${cInfo.groupInfo.groupProfile.displayName}${s}`
    }
    case "local":
      return "private notes"
    case "contactRequest":
      return `request from @${cInfo.contactRequest.profile.displayName}`
    case "contactConnection":
      return "pending connection"
  }
}

export function contactLinkStr(link: T.CreatedConnLink): string {
  return link.connShortLink || link.connFullLink
}

export function textContent(text: string): T.MsgContent {
  return {type: "text", text}
}
