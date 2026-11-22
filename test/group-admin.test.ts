import assert from "node:assert/strict"
import {describe, it} from "node:test"
import type {T} from "@simplex-chat/types"
import {dm, groupMsg, makeHarness, member} from "./helpers/fake"
import {automod} from "../data/events/automod"
import {antispam} from "../data/events/antispam"
import {findBlocked} from "../src/util/wordfilter"
import {parseWhen} from "../src/util/time"
import memberEvents from "../data/events/members"

const ADMIN = {role: "admin" as T.GroupMemberRole, memberId: 9, name: "boss"}
const deletes = (h: ReturnType<typeof makeHarness>) => h.chat.calls.filter((c) => c[0] === "apiDeleteMemberChatItem")
const settings = (h: ReturnType<typeof makeHarness>) => h.rt.data.group((groupMsg("x").chatInfo as any).groupInfo).get()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("filter: edits, actions and levels", () => {
  it("checks edited messages (and live messages' final text)", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/filter add spam", ADMIN))
    const edited = groupMsg("now it says spam", {memberId: 2})
    await automod(h.rt, edited, {edited: true})
    assert.deepEqual(deletes(h).at(-1), ["apiDeleteMemberChatItem", 5, [edited.chatItem.meta.itemId]])
  })

  it("anti-spam checks edits too", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/antispam on", ADMIN))
    const item = groupMsg("edited in https://spam.example", {memberId: 2})
    const m = (item.chatItem.chatDir as any).groupMember
    m.createdAt = new Date().toISOString()
    ;(item.chatInfo as any).groupInfo.membership.createdAt = new Date(0).toISOString()
    await antispam(h.rt, item)
    assert.deepEqual(deletes(h).at(-1), ["apiDeleteMemberChatItem", 5, [item.chatItem.meta.itemId]])
  })

  it("warns or blocks the author when configured", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/filter add spam", ADMIN))
    await h.receive(groupMsg("/filter action warn", ADMIN))
    assert.match(h.chat.last()!.text!, /delete \+ warn/)
    await automod(h.rt, groupMsg("spam", {memberId: 2}))
    assert.equal((await settings(h)).warnings?.["2"]?.count, 1)

    await h.receive(groupMsg("/filter action block 1h", ADMIN))
    assert.match(h.chat.last()!.text!, /block for 1h/)
    await automod(h.rt, groupMsg("spam again", {memberId: 3, name: "cy"}))
    assert.deepEqual(h.chat.calls.filter((c) => c[0] === "apiBlockMembersForAll").at(-1), ["apiBlockMembersForAll", 5, [3], true])
    assert.ok(h.rt.scheduler.list().find((j) => j.kind === "unblock")!.at > Date.now() + 3_500_000)
  })

  it("strict and max levels see through disguises", () => {
    const list = ["spam", "ass"]
    assert.equal(findBlocked(list, "sp4m and $pam", "normal"), undefined)
    assert.equal(findBlocked(list, "sp4m", "strict"), "spam")
    assert.equal(findBlocked(list, "ѕраm"), undefined, "Cyrillic look-alikes pass the normal level")
    assert.equal(findBlocked(list, "ѕраm", "strict"), "spam")
    assert.equal(findBlocked(list, "SPAAAAM", "strict"), "spam")
    assert.equal(findBlocked(list, "s\u200Bpam", "strict"), "spam")
    assert.equal(findBlocked(list, "s p a m", "strict"), undefined)
    assert.equal(findBlocked(list, "s p a m", "max"), "spam")
    assert.equal(findBlocked(list, "s.p.a.m!", "max"), "spam")
    assert.equal(findBlocked(list, "first class", "strict"), undefined)
    assert.equal(findBlocked(list, "first class", "max"), "ass", "max also matches inside words")
  })

  it("/filter level, private list and no words echoed in the group", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/filter add secretword", ADMIN))
    assert.doesNotMatch(h.chat.last()!.text!, /secretword/)
    await h.receive(groupMsg("/filter level strict", ADMIN))
    assert.match(h.chat.last()!.text!, /Filter level: \*strict\*/)
    await h.receive(groupMsg("/filter level extreme", ADMIN))
    assert.match(h.chat.last()!.text!, /Choose a level/)

    await h.receive(groupMsg("/filter list", ADMIN))
    assert.match(h.chat.last()!.text!, /can't DM you yet/)
    await h.receive(groupMsg("/filter list", {...ADMIN, contactId: 42}))
    assert.match(h.chat.last()!.text!, /sent you the list by DM/)
    assert.match(h.chat.sent.find((s) => s.ref === "@42")!.text!, /`secretword`/)
    assert.ok(!h.chat.sent.some((s) => s.ref !== "@42" && s.text?.includes("secretword")), "never in the group")
  })
})

describe("/toggle", () => {
  it("turns commands and categories off for everyone, and hides them from /help", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/toggle off fun", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /only for group admins/)
    await h.receive(groupMsg("/toggle off fun, wiki, help, nope", ADMIN))
    const reply = h.chat.last()!.text!
    assert.match(reply, /Turned \*off\*:.*`8ball`.*`trivia`/s)
    assert.match(reply, /Unknown: `nope`/)
    assert.match(reply, /Always on: `help`/)

    const before = h.chat.sent.length
    await h.receive(groupMsg("/8ball will it work?", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /\/8ball is turned off in this group/)
    await h.receive(groupMsg("/8ball again?", {memberId: 2}))
    assert.equal(h.chat.sent.length, before + 1, "told once, then quiet")
    await h.receive(groupMsg("/8ball as admin", ADMIN))
    assert.match(h.chat.last()!.text!, /turned off/)

    await h.receive(groupMsg("/help", {memberId: 2}))
    assert.doesNotMatch(h.chat.last()!.text!, /8ball|\/wiki/)
    assert.match(h.chat.last()!.text!, /turned off in this group/)

    await h.receive(groupMsg("/toggle on 8ball", ADMIN))
    await h.receive(groupMsg("/8ball now?", {memberId: 3, name: "cy"}))
    assert.doesNotMatch(h.chat.last()!.text!, /turned off/)
    await h.receive(groupMsg("/toggle", ADMIN))
    assert.match(h.chat.last()!.text!, /turned off here/)
  })
})

describe("/modlog", () => {
  it("links admins' DMs (existing contact or a one-time code) and only sends there", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/modlog on", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /for group admins/)

    h.chat.members = [{...member(9, "boss", "admin"), memberContactId: 42} as T.GroupMember, member(3, "Jo")]
    const boss = groupMsg("/modlog on", ADMIN)
    ;(boss.chatItem.chatDir as any).groupMember.memberContactId = 42
    await h.receive(boss)
    assert.match(h.chat.last()!.text!, /Moderation log on/)
    await h.receive(groupMsg("/warn @Jo be nice", ADMIN))
    await sleep(30)
    const toBoss = () => h.chat.sent.filter((s) => s.ref === "@42")
    assert.match(toBoss().map((s) => s.text).join("\n"), /boss warned Jo \(1\/3\): be nice/)

    // demoted admins stop getting it
    h.chat.members = [{...member(9, "boss", "member"), memberContactId: 42} as T.GroupMember, member(3, "Jo")]
    const count = toBoss().length
    await h.receive(groupMsg("/warn @Jo again", {role: "owner" as T.GroupMemberRole, memberId: 8, name: "own"}))
    await sleep(30)
    assert.equal(toBoss().length, count)

    // a one-time code from a DM links another profile
    h.chat.members.push(member(11, "ann", "admin"), member(12, "eve", "admin"))
    await h.receive(dm("/modlog link", {contactId: 77}))
    const code = h.chat.last()!.text!.match(/`([0-9a-f]{6})`/)![1]
    await h.receive(groupMsg(`/modlog on ${code}`, {role: "admin" as T.GroupMemberRole, memberId: 11, name: "ann"}))
    assert.match(h.chat.last()!.text!, /linked to your DM profile/)
    assert.equal((await settings(h)).modlog?.["11"]?.contactId, 77)
    await h.receive(groupMsg(`/modlog on ${code}`, {role: "admin" as T.GroupMemberRole, memberId: 12, name: "eve"}))
    assert.match(h.chat.last()!.text!, /unknown or expired/, "codes work once")
  })

  it("sends a contact request when there's no DM yet", async () => {
    const h = makeHarness()
    h.chat.members = [member(9, "boss", "admin")]
    ;(h.chat as any).apiCreateMemberContact = async (groupId: number, gmId: number) => {
      h.chat.calls.push(["apiCreateMemberContact", groupId, gmId])
      return {contactId: 500}
    }
    ;(h.chat as any).apiSendMemberContactInvitation = async (contactId: number) => ({contactId})
    await h.receive(groupMsg("/modlog on", ADMIN))
    assert.match(h.chat.last()!.text!, /sent you a contact request/)
    assert.deepEqual(h.chat.calls.find((c) => c[0] === "apiCreateMemberContact"), ["apiCreateMemberContact", 5, 9])
    assert.deepEqual((await settings(h)).modlog?.["9"], {contactId: 500, name: "boss"})
  })

  it("falls back to the code when the group doesn't allow DMs", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/modlog on", ADMIN))
    assert.match(h.chat.last()!.text!, /\/modlog link/)
  })
})

describe("reminders on dates", () => {
  const tz = "Europe/Berlin"
  const show = (at: number) => new Intl.DateTimeFormat("en-GB", {timeZone: tz, dateStyle: "medium", timeStyle: "short"}).format(at)
  const now = Date.UTC(2030, 5, 10, 10) // Mon 10 Jun 2030, 12:00 in Berlin

  it("parses month names, ISO dates and weekdays, with or without a time", () => {
    assert.equal(show(parseWhen("dec 24 18:00 presents", now, tz)!.at), "24 Dec 2030, 18:00")
    assert.equal(parseWhen("dec 24 18:00 presents", now, tz)!.rest, "presents")
    assert.equal(show(parseWhen("24th december x", now, tz)!.at), "24 Dec 2030, 09:00")
    assert.equal(show(parseWhen("on 2031-01-02 8am x", now, tz)!.at), "2 Jan 2031, 08:00")
    assert.equal(show(parseWhen("jan 5 x", now, tz)!.at), "5 Jan 2031, 09:00", "a passed date means next year")
    assert.equal(show(parseWhen("friday 9:00 x", now, tz)!.at), "14 Jun 2030, 09:00")
    assert.equal(show(parseWhen("monday 9:00 x", now, tz)!.at), "17 Jun 2030, 09:00", "today's time passed: next week")
    assert.equal(show(parseWhen("monday 18:00 x", now, tz)!.at), "10 Jun 2030, 18:00")
    assert.equal(parseWhen("2029-01-01 x", now, tz), undefined, "an explicit past year")
    assert.equal(parseWhen("feb 30 x", now, tz), undefined)
    assert.equal(parseWhen("may the force", now, tz), undefined)
    assert.equal(parseWhen("2 days later", now, tz)!.at, now + 2 * 86_400_000)
  })

  it("/remind takes a date", async () => {
    const h = makeHarness()
    await h.receive(dm("/remind dec 24 18:00 wrap presents"))
    assert.match(h.chat.last()!.text!, /I'll remind you/)
    assert.equal(h.rt.scheduler.list<{text: string}>()[0]!.payload.text, "wrap presents")
  })
})

/** Make every scheduled job due and run them once. */
async function runDue(h: ReturnType<typeof makeHarness>): Promise<void> {
  for (const job of h.rt.scheduler.list()) job.at = Date.now() - 1
  h.rt.scheduler.start(h.rt)
  await sleep(20)
  await h.rt.scheduler.drain(500)
  h.rt.scheduler.stop()
}

const GROUP_INFO = () => (groupMsg("x").chatInfo as any).groupInfo as T.GroupInfo
const UNBLOCK = {ref: {chatType: "group", chatId: 5}, groupId: 5, groupMemberId: 3, name: "cy"}

describe("timed unblock", () => {
  it("retries every 10 minutes, then tells the group (and the moderation log)", async () => {
    const h = makeHarness()
    h.chat.members = [member(3, "cy")]
    h.chat.groups = [GROUP_INFO()]
    let tries = 0
    h.chat.apiBlockMembersForAll = async () => {
      tries++
      throw Object.assign(new Error("Chat command error"), {chatError: {type: "error", errorType: {type: "groupUserRole"}}})
    }
    h.rt.scheduler.schedule("unblock", Date.now() - 1, UNBLOCK)
    for (let i = 1; i < 6; i++) {
      await runDue(h)
      const job = h.rt.scheduler.list<{tries?: number}>()[0]!
      assert.equal(job.payload.tries, i)
      assert.ok(job.at > Date.now() + 9 * 60_000, "next try in 10 minutes")
    }
    assert.equal(h.chat.texts().length, 0, "quiet while retrying")
    await runDue(h)
    assert.equal(tries, 6)
    assert.equal(h.rt.scheduler.list().length, 0)
    assert.match(h.chat.last()!.text!, /couldn't end \*cy\*'s block; an admin can use \/unblock/)
  })

  it("gives up quietly when the member has left", async () => {
    const h = makeHarness()
    h.chat.members = [{...member(3, "cy"), memberStatus: "left"} as T.GroupMember]
    h.chat.apiBlockMembersForAll = async () => {
      throw new Error("nope")
    }
    h.rt.scheduler.schedule("unblock", Date.now() - 1, UNBLOCK)
    await runDue(h)
    assert.equal(h.rt.scheduler.list().length, 0)
    assert.equal(h.chat.texts().length, 0)
  })
})

describe("/report", () => {
  const spam = {itemId: 77, chatDir: {type: "groupRcv", groupMember: member(4, "spammer")} as unknown as T.CIDirection, text: "buy cheap stuff"}
  const subscribe = (h: ReturnType<typeof makeHarness>) => {
    h.chat.members = [{...member(9, "boss", "admin"), memberContactId: 42} as T.GroupMember, member(3, "cy"), member(4, "spammer")]
    return h.rt.data.group(GROUP_INFO()).update((s) => {
      s.modlog = {"9": {contactId: 42, name: "boss"}}
    })
  }

  it("needs a reply to someone else's message and admins who get reports", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/report", {memberId: 3, name: "cy"}))
    assert.match(h.chat.last()!.text!, /Reply to the message you want to report/)
    await h.receive(groupMsg("/report", {memberId: 3, name: "cy", quote: {itemId: 70, chatDir: {type: "groupSnd"} as T.CIDirection}}))
    assert.match(h.chat.last()!.text!, /my own message/)
    await h.receive(groupMsg("/report spam", {memberId: 3, name: "cy", quote: spam}))
    assert.match(h.chat.last()!.text!, /No admins receive reports here yet/)
    await h.receive(groupMsg("/report", {memberId: 4, name: "spammer", quote: spam}))
    assert.match(h.chat.last()!.text!, /your own message/)
  })

  it("DMs the admins, removes the /report message and confirms privately", async () => {
    const h = makeHarness()
    await subscribe(h)
    const report = groupMsg("/report spam", {memberId: 3, name: "cy", contactId: 50, quote: spam})
    await h.receive(report)
    await sleep(30)
    assert.match(h.chat.sent.find((s) => s.ref === "@42")!.text!, /cy reported a message from spammer \(spam\): buy cheap stuff/)
    assert.deepEqual(deletes(h).at(-1), ["apiDeleteMemberChatItem", 5, [report.chatItem.meta.itemId]])
    assert.match(h.chat.sent.find((s) => s.ref === "@50")!.text!, /Your report in \*Club\* was sent to the admins/)
    assert.ok(!h.chat.sent.some((s) => s.ref === "#5"), "nothing in the group")
  })

  it("replies in the group when I can't delete messages", async () => {
    const h = makeHarness()
    await subscribe(h)
    await h.receive(groupMsg("/report", {memberId: 3, name: "cy", quote: spam, botRole: "member" as T.GroupMemberRole}))
    assert.equal(h.chat.sent.find((s) => s.ref === "#5")?.text, "✅ Reported to the admins.")
    await h.receive(groupMsg("/report", {memberId: 3, name: "cy", quote: spam, botRole: "member" as T.GroupMemberRole}))
    assert.match(h.chat.sent.filter((s) => s.ref === "#5").at(-1)!.text!, /another in a minute/)
  })
})

describe("goodbye messages", () => {
  type Handler = {event: string; name?: string; run: (evt: unknown, rt: unknown) => unknown}
  const handlers = memberEvents as unknown as Handler[]
  const left = handlers.find((e) => e.name === "goodbye")!
  const leave = (h: ReturnType<typeof makeHarness>, id: number, name: string) =>
    left.run({type: "leftMember", user: h.rt.user, groupInfo: GROUP_INFO(), member: member(id, name)}, h.rt)

  it("/welcome goodbye sets it; it's sent when someone leaves, at most every 10 seconds", async () => {
    const h = makeHarness()
    await leave(h, 3, "cy")
    assert.equal(h.chat.texts().length, 0, "no goodbye message set")
    await h.receive(groupMsg("/welcome goodbye Bye {name}, from {group}!", ADMIN))
    assert.match(h.chat.last()!.text!, /Goodbye message saved/)
    await leave(h, 3, "cy")
    assert.equal(h.chat.last()!.text, "Bye *cy*, from Club!")
    const count = h.chat.texts().length
    await leave(h, 4, "dee")
    assert.equal(h.chat.texts().length, count, "throttled")
    await h.receive(groupMsg("/welcome goodbye off", ADMIN))
    assert.equal((await settings(h)).goodbye, undefined)
  })

  it("isn't sent for removed members", () => {
    assert.ok(!handlers.some((e) => e.event === "deletedMember"))
  })
})

describe("warning expiry", () => {
  it("/warn expire resets old warnings and hides them in /warnings", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/warn expire 5m", ADMIN))
    assert.match(h.chat.last()!.text!, /Usage|1h to 365d/)
    await h.receive(groupMsg("/warn expire 30d", {memberId: 2, role: "moderator" as T.GroupMemberRole}))
    assert.match(h.chat.last()!.text!, /Only admins/)
    await h.receive(groupMsg("/warn expire 30d", ADMIN))
    assert.match(h.chat.last()!.text!, /reset after \*30d\*/)
    h.chat.members = [member(3, "Jo")]
    await h.receive(groupMsg("/warn @Jo one", ADMIN))
    await h.receive(groupMsg("/warn @Jo two", ADMIN))
    assert.equal((await settings(h)).warnings?.["3"]?.count, 2)

    // 31 days later
    await h.rt.data.group(GROUP_INFO()).update((s) => {
      s.warnings!["3"]!.last = Date.now() - 31 * 86_400_000
    })
    await h.receive(groupMsg("/warnings", ADMIN))
    assert.match(h.chat.last()!.text!, /Nobody has warnings/)
    await h.receive(groupMsg("/warn @Jo three", ADMIN))
    assert.match(h.chat.last()!.text!, /\(1\/3\)/, "counting starts over")

    await h.receive(groupMsg("/warn expire off", ADMIN))
    assert.equal((await settings(h)).warnExpireMs, undefined)
  })
})
