import {defineEvent, forgetChat, T, type Runtime} from "../../src/sdk"

/**
 * Forget polls, games and scheduled jobs of chats Rubi can't reach anymore, and the reminders of members who left
 * a group (so nobody keeps posting through Rubi after leaving). /leave calls forgetChat itself (no event fires).
 */
const group = (g: T.GroupInfo): T.ChatRef => ({chatType: T.ChatType.Group, chatId: g.groupId})

function forget(rt: Runtime, what: string, ref: T.ChatRef, memberId?: number): void {
  const n = forgetChat(rt, ref, memberId)
  if (n) rt.log.info(`${what}: removed ${n} scheduled job(s)/interaction(s)`)
}

export default [
  defineEvent("deletedMemberUser", ({groupInfo}, rt) => forget(rt, `removed from #${groupInfo.groupProfile.displayName}`, group(groupInfo))),
  defineEvent("groupDeleted", ({groupInfo}, rt) => forget(rt, `#${groupInfo.groupProfile.displayName} deleted`, group(groupInfo))),
  defineEvent("contactDeletedByContact", ({contact}, rt) =>
    forget(rt, `contact #${contact.contactId} deleted`, {chatType: T.ChatType.Direct, chatId: contact.contactId})
  ),
  defineEvent("leftMember", ({groupInfo, member}, rt) => forget(rt, `member left #${groupInfo.groupProfile.displayName}`, group(groupInfo), member.groupMemberId)),
  defineEvent("deletedMember", ({groupInfo, deletedMember}, rt) =>
    forget(rt, `member removed from #${groupInfo.groupProfile.displayName}`, group(groupInfo), deletedMember.groupMemberId)
  ),
]
