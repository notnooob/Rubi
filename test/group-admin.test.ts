import assert from "node:assert/strict"
import {describe, it} from "node:test"
import type {T} from "@simplex-chat/types"
import {dm, groupMsg, makeHarness, member} from "./helpers/fake"
import {automod} from "../data/events/automod"
import {antispam} from "../data/events/antispam"
import {findBlocked} from "../src/util/wordfilter"
import {parseWhen} from "../src/util/time"

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
