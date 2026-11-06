import {chatUtil, commandsTappable, defineEvent, describeError, fmt, T, uiFor} from "../../src/sdk"

/** Wait after joining before greeting: the connection to the group may need a moment. */
export const GREET_DELAY_MS = 1500

/**
 * Shown right after the welcome message when Rubi joins a group (not in DMs): how to make Rubi's commands
 * tappable for every member and add them to the group's "/" menu. SimpleX apps only do that for groups whose
 * profile has a bot command menu, which only owners can set — so Rubi must be made owner, then /groupmenu.
 * Returns undefined when the group already has the menu.
 */
export function groupMenuTip(groupInfo: T.GroupInfo, prefix = "/"): string | undefined {
  const chatInfo: T.ChatInfo = {type: "group", groupInfo}
  if (commandsTappable(chatInfo)) return undefined
  const ui = uiFor(chatInfo, prefix)
  return groupInfo.membership.memberRole === T.GroupMemberRole.Owner
    ? `💡 To make my commands tappable for everyone here and add them to the ${fmt.code("/")} menu, send ${ui.cmd("groupmenu")}.`
    : fmt.lines(
        `💡 ${fmt.bold("Tip for group owners:")} make my commands tappable for everyone here and add them to the ${fmt.code("/")} menu:`,
        `1. Make me a group ${fmt.bold("owner")} (member list → my name → role)`,
        `2. Send ${ui.cmd("groupmenu")}`
      )
}

/**
 * Group lifecycle:
 * - accept group invitations automatically (RUBI_AUTO_JOIN_GROUPS, default on)
 * - once joined, say hello, then explain /groupmenu (RUBI_GREET_ON_JOIN, default on)
 */
export default [
  defineEvent(
    "receivedGroupInvitation",
    async ({groupInfo}, rt) => {
      if (!rt.config.groups.autoJoin) return
      try {
        await rt.chat.apiJoinGroup(groupInfo.groupId)
        rt.log.info(`accepted invitation to #${groupInfo.groupProfile.displayName}`)
      } catch (e) {
        rt.log.warn(`could not join #${groupInfo.groupProfile.displayName}: ${describeError(e)}`)
      }
    },
    {name: "auto-join"}
  ),

  defineEvent(
    "userJoinedGroup",
    async ({groupInfo}, rt) => {
      if (!rt.config.groups.greetOnJoin) return
      const ref: T.ChatRef = {chatType: T.ChatType.Group, chatId: groupInfo.groupId}
      const tip = groupMenuTip(groupInfo, rt.config.prefix)
      // don't block the event loop while waiting
      setTimeout(() => {
        void (async () => {
          // the welcome stays exactly as configured; the tip is its own message below it
          await rt.messenger.send(ref, chatUtil.textContent(rt.config.welcomeMessage))
          if (tip) await rt.messenger.send(ref, tip)
        })().catch((e) => rt.log.warn(`could not greet #${groupInfo.groupProfile.displayName}: ${describeError(e)}`))
      }, GREET_DELAY_MS)
    },
    {name: "greet-on-join"}
  ),
]
