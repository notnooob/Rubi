import {T} from "@simplex-chat/types"
import type {Runtime} from "../core/runtime"
import {roleAtLeast} from "../core/permissions"
import {describeError} from "../core/errors"
import {bold, truncate} from "./format"

/**
 * Moderation log: group admins who ran /modlog on get each moderation action by DM, never in the group
 * (it can contain deleted messages and banned words). Recipients must still be admins when a line is sent;
 * members who left are dropped from the list.
 *
 *   void modLog(rt, g, `${who} kicked ${target}`)   // fire and forget: never throws
 */
export async function modLog(rt: Runtime, g: T.GroupInfo, text: string): Promise<void> {
  try {
    const subs = (await rt.data.group(g).get()).modlog
    if (!subs || !Object.keys(subs).length) return
    const members = await rt.chat.apiListMembers(g.groupId)
    const line = `🛡 ${bold(g.groupProfile.displayName)}: ${truncate(text, 1500)}`
    const gone: string[] = []
    for (const [id, sub] of Object.entries(subs)) {
      const m = members.find((x) => x.groupMemberId === Number(id))
      if (!m) {
        gone.push(id)
        continue
      }
      if (!roleAtLeast(m.memberRole, T.GroupMemberRole.Admin)) continue
      await rt.messenger.send({chatType: T.ChatType.Direct, chatId: sub.contactId}, line).catch((e) => {
        rt.log.debug(`modlog DM to ${sub.name} (contact #${sub.contactId}) failed: ${describeError(e)}`)
      })
    }
    if (gone.length) {
      await rt.data.group(g).update((s) => {
        for (const id of gone) delete s.modlog?.[id]
      })
    }
  } catch (e) {
    rt.log.warn(`modlog for #${g.groupProfile.displayName} failed: ${describeError(e)}`)
  }
}

/** The DM contact an admin linked with /modlog on, or their existing contact with Rubi. */
export async function adminContact(rt: Runtime, g: T.GroupInfo, member: T.GroupMember): Promise<number | undefined> {
  return (await rt.data.group(g).get()).modlog?.[member.groupMemberId]?.contactId ?? member.memberContactId
}
