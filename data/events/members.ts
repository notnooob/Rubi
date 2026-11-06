import {defineEvent, describeError, T, type Runtime} from "../../src/sdk"
import {renderWelcome} from "../commands/groups/welcome"

/**
 * Custom welcome messages for new group members (/welcome set …).
 *
 * - Member invited by someone else: they're announced (joinedGroupMemberConnecting) and greeted once Rubi is
 *   connected to them (connectedToGroupMember), so the greeting actually reaches them.
 * - Member who joined through Rubi (Rubi is the host): greeted on joinedGroupMember.
 * Members Rubi connects to when it joins a group itself are NOT greeted.
 */
const announced = new Map<string, number>()
const greeted = new Set<string>()
const key = (g: T.GroupInfo, m: T.GroupMember) => `${g.groupId}:${m.groupMemberId}`

async function greet(rt: Runtime, g: T.GroupInfo, m: T.GroupMember): Promise<void> {
  const k = key(g, m)
  if (greeted.has(k)) return
  greeted.add(k)
  if (greeted.size > 5000) greeted.clear()
  const {welcome} = await rt.data.group(g).get()
  if (!welcome) return
  const name = m.memberProfile.displayName
  await rt.messenger
    .send({chatType: T.ChatType.Group, chatId: g.groupId}, renderWelcome(welcome, name, g.groupProfile.displayName), {
      mentions: {[name]: m.groupMemberId},
    })
    .catch((e) => rt.log.warn(`welcome in #${g.groupProfile.displayName} failed: ${describeError(e)}`))
}

export default [
  defineEvent(
    "joinedGroupMemberConnecting",
    ({groupInfo, member}) => {
      announced.set(key(groupInfo, member), Date.now())
      // forget announcements that never connected (1 day)
      for (const [k, t] of announced) if (t < Date.now() - 86_400_000) announced.delete(k)
    },
    {name: "welcome:announced"}
  ),
  defineEvent(
    "connectedToGroupMember",
    async ({groupInfo, member}, rt) => {
      if (!announced.delete(key(groupInfo, member))) return
      await greet(rt, groupInfo, member)
    },
    {name: "welcome:connected"}
  ),
  defineEvent(
    "joinedGroupMember",
    async ({groupInfo, member}, rt) => {
      // announced by another host → wait until we're connected to them
      if (announced.has(key(groupInfo, member))) return
      await greet(rt, groupInfo, member)
    },
    {name: "welcome:joined"}
  ),
]
