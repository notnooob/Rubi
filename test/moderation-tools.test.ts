import assert from "node:assert/strict"
import {describe, it} from "node:test"
import type {T} from "@simplex-chat/types"
import {groupMsg, makeHarness, member} from "./helpers/fake"
import {automod} from "../data/events/automod"
import {trackActivity} from "../data/events/activity"
import {findBlocked, matchesPattern, parseWordList} from "../src/util/wordfilter"

const ADMIN = {role: "admin" as T.GroupMemberRole, memberId: 9, name: "boss"}
const deletes = (h: ReturnType<typeof makeHarness>) => h.chat.calls.filter((c) => c[0] === "apiDeleteMemberChatItem")
const at = (item: T.AChatItem, ms: number) => {
  item.chatItem.meta.itemTs = new Date(ms).toISOString()
  return item
}

describe("word filter", () => {
  it("parses lists and matches whole words, phrases and wildcards", () => {
    assert.deepEqual(parseWordList(" Spam, buy   NOW; crypto*\n spam ,"), ["spam", "buy now", "crypto*"])
    const list = ["spam", "buy now", "crypto*"]
    assert.equal(findBlocked(list, "This is SPAM!"), "SPAM")
    assert.equal(findBlocked(list, "please buy  now"), "buy  now")
    assert.equal(findBlocked(list, "free cryptocoins"), "cryptocoins")
    assert.equal(findBlocked(list, "spammer and antispam"), undefined, "whole words only")
    assert.ok(matchesPattern("crypto*", "cryptocoin") && matchesPattern("buy now", "buy now") && !matchesPattern("buy", "buy now"))
  })

  it("/filter add, remove (with patterns), list and the automod delete", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/filter add spam", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /only for group admins/)

    await h.receive(groupMsg("/filter add spam, buy now, crypto*, cryptid", ADMIN))
    assert.match(h.chat.last()!.text!, /Added 4 banned words/)
    await h.receive(groupMsg("/filter add spam", ADMIN))
    assert.match(h.chat.last()!.text!, /already banned/)

    // /filter add|remove delete their own command message, so the words don't stay visible
    const base = deletes(h).length
    await automod(h.rt, groupMsg("hello there", {memberId: 2}))
    assert.equal(deletes(h).length, base)
    const bad = groupMsg("BUY NOW cheap", {memberId: 2})
    await automod(h.rt, bad)
    assert.deepEqual(deletes(h)[base], ["apiDeleteMemberChatItem", 5, [bad.chatItem.meta.itemId]])
    assert.match(h.chat.last()!.text!, /blocked word/)
    await automod(h.rt, groupMsg("spam", ADMIN))
    assert.equal(deletes(h).length, base + 1, "admins aren't filtered")

    await h.receive(groupMsg("/filter remove crypt*, spam", ADMIN))
    assert.match(h.chat.last()!.text!, /Removed 3 banned words/)
    await h.receive(groupMsg("/filter list", {...ADMIN, contactId: 42}))
    assert.match(h.chat.sent.find((s) => s.ref === "@42")!.text!, /\(1\)[\s\S]*`buy now`/)
  })
})

describe("slow mode", () => {
  it("deletes messages sent too soon, but not commands", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/slowmode 30s", ADMIN))
    assert.match(h.chat.last()!.text!, /one message every \*30s\*/)
    const t = Date.now()
    await automod(h.rt, at(groupMsg("one", {memberId: 2}), t))
    await automod(h.rt, at(groupMsg("/ping", {memberId: 2}), t + 1_000))
    const fast = at(groupMsg("two", {memberId: 2}), t + 5_000)
    await automod(h.rt, fast)
    await automod(h.rt, at(groupMsg("other member", {memberId: 3}), t + 5_000))
    await automod(h.rt, at(groupMsg("three", {memberId: 2}), t + 31_000))
    assert.deepEqual(deletes(h).map((c) => c[2]), [[fast.chatItem.meta.itemId]])
    assert.match(h.chat.texts().join("\n"), /slow mode is on/)

    await h.receive(groupMsg("/slowmode off", ADMIN))
    assert.match(h.chat.last()!.text!, /Slow mode off/)
    await h.receive(groupMsg("/slowmode 1s", ADMIN))
    assert.match(h.chat.last()!.text!, /5 seconds to 6 hours/)
  })
})

describe("/seen and /afk", () => {
  it("tracks last messages, answers mentions of AFK members and welcomes them back", async () => {
    const h = makeHarness()
    h.chat.members = [member(2, "bob"), member(3, "cy")]
    await trackActivity(h.rt, groupMsg("hi all", {memberId: 3, name: "cy"}))
    await h.receive(groupMsg("/seen @cy", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /cy\* last posted \*/)
    await h.receive(groupMsg("/seen @bob", {memberId: 3, name: "cy"}))
    assert.match(h.chat.last()!.text!, /haven't seen \*bob\*/)

    const afk = groupMsg("/afk lunch", {memberId: 2})
    await trackActivity(h.rt, afk)
    await h.receive(afk)
    assert.match(h.chat.last()!.text!, /bob\* is away: lunch/)

    const ping = groupMsg("@bob are you there?", {memberId: 3, name: "cy"})
    ;(ping.chatItem as any).mentions = {bob: {memberId: "mid-2", memberRef: {groupMemberId: 2, displayName: "bob"}}}
    await trackActivity(h.rt, ping)
    assert.match(h.chat.last()!.text!, /💤 \*bob\* is AFK: lunch/)
    assert.equal(h.chat.last()!.quote, ping.chatItem.meta.itemId)

    await trackActivity(h.rt, groupMsg("back!", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /Welcome back, @bob/)
    await h.receive(groupMsg("/seen @bob", {memberId: 3, name: "cy"}))
    assert.doesNotMatch(h.chat.last()!.text!, /Away/)
  })
})

describe("remind someone else", () => {
  it("/remind @member mentions them and says who set it", async () => {
    const h = makeHarness()
    h.chat.members = [member(3, "Jo Do")]
    await h.receive(groupMsg("/remind @'Jo Do' 10m check the PR", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /I'll remind @'Jo Do' \*in 10m\*/)
    const [job] = h.rt.scheduler.list<{name: string; memberId: number; by: string; userKey: string}>()
    assert.equal(job!.payload.name, "Jo Do")
    assert.equal(job!.payload.memberId, 3)
    assert.equal(job!.payload.by, "bob")

    await h.receive(groupMsg("/reminders", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /for \*Jo Do\*: check the PR/)

    job!.at = Date.now() - 1
    h.rt.scheduler.start(h.rt)
    await new Promise((r) => setTimeout(r, 50))
    h.rt.scheduler.stop()
    assert.match(h.chat.last()!.text!, /⏰ @'Jo Do', reminder from \*bob\*:\ncheck the PR/)

    await h.receive(groupMsg("/remind @Rubi 10m x", {memberId: 2}))
    assert.match(h.chat.last()!.text!, /don't need reminders/)
  })
})
