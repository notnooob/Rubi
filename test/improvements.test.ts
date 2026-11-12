import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {dm, groupMsg, makeHarness, member} from "./helpers/fake"
import {Scheduler, type Job, type JobHandler} from "../src/core/scheduler"
import {forgetChat, T} from "../src/sdk"
import {describeRepeat, nextRepeat, parseRepeat} from "../src/util/time"

describe("new utility and organization commands", () => {
  it("stores DM defaults without applying them to groups", async () => {
    const h = makeHarness()
    await h.receive(dm("/prefs set currency EUR"))
    await h.receive(dm("/prefs"))
    assert.match(h.chat.last()!.text!, /Currency: `EUR`/)
    await h.receive(groupMsg("/prefs"))
    assert.match(h.chat.last()!.text!, /only works in a direct chat/)
  })

  it("cleans tracking links without making an HTTP request", async () => {
    const h = makeHarness()
    await h.receive(dm("/cleanlink https://example.org/article?id=7&utm_source=newsletter&fbclid=abc"))
    assert.match(h.chat.last()!.text!, /https:\/\/example\.org\/article\?id=7/)
    assert.doesNotMatch(h.chat.last()!.text!, /utm_source|fbclid/)
  })

  it("converts a future instant across time zones", async () => {
    const h = makeHarness()
    await h.receive(dm("/time at 2030-01-01T18:00:00Z | UTC | America\/New_York"))
    assert.match(h.chat.last()!.text!, /UTC/)
    assert.match(h.chat.last()!.text!, /America\/New_York/)
    assert.match(h.chat.last()!.text!, /13:00/)
  })

  it("keeps group tasks chat-local and creator-owned", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/todo add bring projector", {memberId: 2, name: "bob"}))
    const id = h.chat.last()!.text!.match(/`([0-9a-f]+)`/)![1]!
    await h.receive(groupMsg(`/todo done ${id}`, {memberId: 3, name: "carol"}))
    assert.match(h.chat.last()!.text!, /creator or assignee/)
    await h.receive(groupMsg(`/todo done ${id}`, {memberId: 2, name: "bob"}))
    assert.match(h.chat.last()!.text!, /Completed/)
  })
})

describe("event and health commands", () => {
  it("creates a scheduled group event", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/event new tomorrow 18:30 | UTC | Book club"))
    assert.match(h.chat.texts().at(-1)!, /Book club/)
    assert.equal(h.rt.scheduler.list().some((j) => j.kind === "event-reminder"), true)
  })

  it("reports bounded operator health", async () => {
    const h = makeHarness()
    await h.receive(dm("/stats health", {contactId: 99}))
    assert.match(h.chat.last()!.text!, /Health/)
    assert.match(h.chat.last()!.text!, /Jobs running/)
    assert.match(h.chat.last()!.text!, /Interactions/)
  })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Make every pending job due and let the scheduler run them. */
async function runDueJobs(h: ReturnType<typeof makeHarness>): Promise<void> {
  for (const job of h.rt.scheduler.list()) job.at = Date.now() - 1
  h.rt.scheduler.start(h.rt)
  await sleep(50)
  h.rt.scheduler.stop()
}

describe("scheduler: recurring and failed jobs", () => {
  function scheduler(handlers: Map<string, JobHandler>) {
    const h = makeHarness()
    const s = new Scheduler(h.rt.store, h.rt.log, handlers, 60_000)
    s.start(h.rt)
    return s
  }

  it("reschedules under the same id when the handler returns a time", async () => {
    const next = Date.now() + 3_600_000
    const s = scheduler(new Map([["again", () => next]]))
    const job = s.schedule("again", Date.now() - 1, {})
    await s.tick()
    await s.drain(500)
    assert.equal(s.get(job.id)?.at, next)
  })

  it("doesn't bring back a job cancelled while it ran", async () => {
    let s: Scheduler | undefined
    s = scheduler(
      new Map<string, JobHandler>([
        [
          "again",
          (job) => {
            s!.cancel(job.id)
            return Date.now() + 60_000
          },
        ],
      ])
    )
    const job = s.schedule("again", Date.now() - 1, {})
    await s.tick()
    await s.drain(500)
    assert.equal(s.get(job.id), undefined)
  })

  it("deletes permanently failed jobs after a week", async () => {
    const s = scheduler(new Map())
    const old = s.schedule("x", Date.now(), {})
    const recent = s.schedule("x", Date.now(), {})
    ;(s.get(old.id) as Job).failedAt = Date.now() - 8 * 86_400_000
    ;(s.get(recent.id) as Job).failedAt = Date.now() - 86_400_000
    await s.tick()
    assert.equal(s.get(old.id), undefined)
    assert.ok(s.get(recent.id))
  })
})

describe("forgetChat", () => {
  it("drops a chat's jobs and interactions, or only a member's reminders", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/remind 1h a", {memberId: 2}))
    await h.receive(groupMsg("/remind 1h b", {memberId: 3, name: "cy"}))
    await h.receive(groupMsg("/poll Lunch? | Pizza | Sushi"))
    await h.receive(dm("/remind 1h dm"))
    assert.equal(h.rt.scheduler.list().length, 3)
    assert.equal(h.rt.interactions.counts().poll, 1)

    const group = {chatType: T.ChatType.Group, chatId: 5}
    assert.equal(forgetChat(h.rt, group, 2), 1)
    assert.deepEqual(h.rt.scheduler.list<{text: string}>().map((j) => j.payload.text).sort(), ["b", "dm"])

    forgetChat(h.rt, group)
    assert.deepEqual(h.rt.scheduler.list<{text: string}>().map((j) => j.payload.text), ["dm"])
    assert.equal(h.rt.interactions.counts().poll, undefined)
  })
})

describe("recurring reminders", () => {
  const tz = "Europe/Berlin"
  const hm = (at: number) => new Intl.DateTimeFormat("en-GB", {timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23"}).format(at)

  it("parses intervals, days and weekdays", () => {
    const now = Date.UTC(2030, 0, 7, 12) // Monday 13:00 in Berlin
    assert.deepEqual(parseRepeat("every 2h drink water", now, tz), {at: now + 7_200_000, rest: "drink water", repeat: {ms: 7_200_000}})
    const daily = parseRepeat("every day 9:00 standup", now, tz)!
    assert.equal(hm(daily.at), "Tue 09:00")
    assert.equal(daily.rest, "standup")
    const weekly = parseRepeat("every fri 18:00 gym", now, tz)!
    assert.equal(hm(weekly.at), "Fri 18:00")
    assert.deepEqual(weekly.repeat, {clock: "18:00", weekday: 5})
    assert.equal(parseRepeat("every 10m spam", now, tz), undefined)
    assert.equal(parseRepeat("every day standup", now, tz), undefined)
    assert.equal(describeRepeat({clock: "9:00", weekday: 1}), "every Monday at 9:00")
  })

  it("skips missed runs and keeps the wall-clock time across DST", () => {
    const start = Date.UTC(2030, 0, 1)
    assert.equal(nextRepeat({ms: 3_600_000}, start, start + 5.5 * 3_600_000), start + 6 * 3_600_000)
    // Berlin switches to summer time on 31 March 2030
    const before = parseRepeat("every day 9:00 x", Date.UTC(2030, 2, 30, 6), tz)!
    assert.equal(hm(before.at), "Sat 09:00")
    const after = nextRepeat(before.repeat, before.at, before.at, tz)!
    assert.equal(hm(after), "Sun 09:00")
    assert.equal(after - before.at, 23 * 3_600_000)
  })

  it("/remind every … stores the repeat and runs again", async () => {
    const h = makeHarness()
    await h.receive(dm("/remind every 2h drink water"))
    assert.match(h.chat.last()!.text!, /🔁 every 2h/)
    const [job] = h.rt.scheduler.list()
    await runDueJobs(h)
    assert.match(h.chat.texts().at(-1)!, /Reminder:\ndrink water/)
    assert.ok(h.rt.scheduler.get(job!.id)!.at > Date.now() + 3_500_000, "rescheduled under the same id")
    await h.receive(dm("/reminders"))
    assert.match(h.chat.last()!.text!, /🔁 every 2h/)
    await h.receive(dm("/remind every 5m x"))
    assert.match(h.chat.last()!.text!, /an hour at least/)
  })
})

describe("timed blocks", () => {
  it("/block @x 10m unblocks later; /unblock cancels the timer", async () => {
    const h = makeHarness()
    h.chat.members = [member(3, "Jo")]
    await h.receive(groupMsg("/block @Jo 10m", {role: T.GroupMemberRole.Admin}))
    assert.match(h.chat.last()!.text!, /Jo\* is blocked for 10m/)
    assert.equal(h.rt.scheduler.list()[0]!.kind, "unblock")

    await runDueJobs(h)
    assert.deepEqual(h.chat.calls.filter((c) => c[0] === "apiBlockMembersForAll").at(-1), ["apiBlockMembersForAll", 5, [3], false])
    assert.match(h.chat.last()!.text!, /Jo\*'s block ended/)
    assert.equal(h.rt.scheduler.list().length, 0)

    await h.receive(groupMsg("/block @Jo 1h", {role: T.GroupMemberRole.Admin}))
    assert.equal(h.rt.scheduler.list().length, 1)
    h.chat.members = [{...member(3, "Jo"), blockedByAdmin: true}]
    await h.receive(groupMsg("/unblock @Jo", {role: T.GroupMemberRole.Admin}))
    assert.equal(h.rt.scheduler.list().length, 0)

    await h.receive(groupMsg("/block @Jo soon", {role: T.GroupMemberRole.Admin}))
    assert.match(h.chat.last()!.text!, /isn't a duration/)
  })
})

describe("/purge", () => {
  const item = (itemId: number, groupMember?: T.GroupMember) =>
    ({meta: {itemId}, chatDir: groupMember ? {type: "groupRcv", groupMember} : {type: "groupSnd"}, content: {}}) as unknown as T.ChatItem

  async function purge(h: ReturnType<typeof makeHarness>, text: string): Promise<string> {
    h.deliver(groupMsg(text, {role: T.GroupMemberRole.Moderator}))
    await sleep(40)
    const prompt = h.chat.last()!.text!
    const promptId = prompt.match(/`\/confirm ([0-9a-f]+)`/)?.[1]
    assert.ok(promptId, prompt)
    await h.receive(groupMsg(`/confirm ${promptId}`, {role: T.GroupMemberRole.Moderator}))
    return prompt
  }

  it("deletes the newest messages it may moderate, after confirming", async () => {
    const h = makeHarness()
    const jo = member(3, "Jo")
    h.chat.members = [jo]
    h.chat.chatItems = [item(10, jo), item(11, member(4, "Ann", "admin")), item(12), item(13, member(5, "Cy")), item(14, jo)]
    assert.match(await purge(h, "/purge 3"), /Delete the last 3 messages\?/)
    const deletes = h.chat.calls.filter((c) => c[0] === "apiDeleteMemberChatItem")
    assert.deepEqual(deletes[0], ["apiDeleteMemberChatItem", 5, [13, 14]], "the admin's message is skipped")
    assert.ok(h.chat.sent.some((s) => s.kind === "delete" && s.itemId === 12), "own message deleted")
    assert.match(h.chat.last()!.text!, /Deleted 3 messages/)
  })

  it("only takes one member's messages with @member", async () => {
    const h = makeHarness()
    const jo = member(3, "Jo")
    h.chat.members = [jo]
    h.chat.chatItems = [item(10, jo), item(11, member(5, "Cy")), item(12), item(14, jo)]
    await purge(h, "/purge 5 @Jo")
    assert.deepEqual(h.chat.calls.find((c) => c[0] === "apiDeleteMemberChatItem"), ["apiDeleteMemberChatItem", 5, [10, 14]])
  })
})
