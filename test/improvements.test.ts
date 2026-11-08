import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {dm, groupMsg, makeHarness} from "./helpers/fake"

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
