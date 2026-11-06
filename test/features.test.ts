import assert from "node:assert/strict"
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs"
import {createServer, type Server} from "node:http"
import {tmpdir} from "node:os"
import path from "node:path"
import {acquireLock, InstanceLockError} from "../src/core/lock"
import groupEvents, {GREET_DELAY_MS} from "../data/events/groups"
import type {AddressInfo} from "node:net"
import {after, before, describe, it, mock} from "node:test"
import {T} from "@simplex-chat/types"
import {Http, HttpError, isPrivateAddress} from "../src/core/http"
import {evaluate} from "../src/util/calc"
import * as fmt from "../src/util/format"
import {parseDuration, parseWhen} from "../src/util/time"
import {dm, groupMsg, makeHarness, member, settle, type Harness} from "./helpers/fake"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Find the interaction id in a message's /'vote <id> n' buttons. */
const voteId = (text: string) => text.match(/\/'vote ([0-9a-f]+) /)?.[1]

/** Swap the runtime's HTTP client for canned JSON responses by URL substring. */
function fakeHttp(h: Harness, routes: Record<string, unknown>): void {
  const http = {
    withSignal: () => http,
    json: async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) throw new HttpError(`no fake route for ${url}`)
      return routes[key]
    },
  }
  ;(h.rt as any).http = http
}

describe("time parsing", () => {
  it("parses durations", () => {
    assert.equal(parseDuration("10m"), 600_000)
    assert.equal(parseDuration("1h30m"), 5_400_000)
    assert.equal(parseDuration("2 days 3h"), 2 * 86_400_000 + 3 * 3_600_000)
    assert.equal(parseDuration("soon"), undefined)
    assert.equal(parseDuration("10 apples"), undefined)
  })
  it("splits when + text", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0)
    assert.deepEqual(parseWhen("10m stretch legs", now), {at: now + 600_000, rest: "stretch legs"})
    assert.deepEqual(parseWhen("in 2 hours call", now), {at: now + 7_200_000, rest: "call"})
    const clock = parseWhen("18:30 dinner", now, "UTC")!
    assert.equal(new Date(clock.at).toISOString(), "2026-01-01T18:30:00.000Z")
    assert.equal(clock.rest, "dinner")
    // a past clock time today rolls over to tomorrow
    assert.equal(new Date(parseWhen("9am x", now, "UTC")!.at).toISOString(), "2026-01-02T09:00:00.000Z")
    assert.equal(new Date(parseWhen("tomorrow 9:15 x", now, "Asia/Tokyo")!.at).toISOString(), "2026-01-02T00:15:00.000Z")
    assert.equal(parseWhen("hello there", now), undefined)
  })
})

describe("calculator", () => {
  it("evaluates safely", () => {
    assert.equal(evaluate("2+3*4"), 14)
    assert.equal(evaluate("(2+3)*4^2"), 80)
    assert.equal(evaluate("2^3^2"), 512)
    assert.equal(evaluate("-2^2"), -4)
    assert.equal(evaluate("sqrt(16) + max(1, 5, 3)"), 9)
    assert.throws(() => evaluate("1/0"), /Division by zero/)
    assert.throws(() => evaluate("process.exit()"), /Unknown name|Unexpected/)
    assert.throws(() => evaluate("2 +"), /Unexpected end/)
  })
})

describe("http helper", () => {
  let server: Server
  let base: string
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/json") return res.end(JSON.stringify({ok: 1, ua: req.headers["user-agent"]}))
      if (req.url === "/slow") return void setTimeout(() => res.end("late"), 2000)
      if (req.url === "/big") return res.end("x".repeat(5000))
      res.statusCode = 404
      res.end("nope")
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => server.close())

  it("fetches JSON with our user agent", async () => {
    const http = new Http("rubi-test-agent")
    assert.deepEqual(await http.json(`${base}/json`), {ok: 1, ua: "rubi-test-agent"})
  })
  it("turns failures into friendly HttpErrors", async () => {
    const http = new Http("t")
    await assert.rejects(http.json(`${base}/missing`, {service: "Tester"}), (e) => e instanceof HttpError && e.status === 404 && /Tester: nothing found/.test(e.message))
    await assert.rejects(http.text(`${base}/slow`, {service: "Tester", timeoutMs: 200}), /Tester didn't answer in time/)
    await assert.rejects(http.text(`${base}/big`, {maxBytes: 1000}), /too much data/)
    await assert.rejects(http.text("ftp://example.com"), /Only http/)
  })
  it("blocks private addresses with publicOnly", async () => {
    await assert.rejects(new Http("t").text(`${base}/json`, {publicOnly: true}), /isn't public/)
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip)
    for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip)
  })
})

describe("instance lock", () => {
  it("refuses a second live instance and takes over stale locks", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "rubi-lock-")), "rubi.lock")
    writeFileSync(file, String(process.ppid)) // a live process that isn't us
    assert.throws(() => acquireLock(file), InstanceLockError)
    writeFileSync(file, "999999") // a PID that's (almost certainly) gone
    const release = acquireLock(file)
    assert.equal(readFileSync(file, "utf8"), String(process.pid))
    release()
    assert.ok(!existsSync(file))
  })
})

describe("formatting helpers", () => {
  it("renders buttons and bars", () => {
    assert.equal(fmt.button("🎲", "roll", "2d6"), "🎲 /'roll 2d6'")
    assert.equal(fmt.buttons(["a", false, "b"]), "a  ·  b")
    assert.equal(fmt.bar(0.5, 4), "▰▰▱▱")
  })
})

describe("polls (reactions + buttons)", () => {
  it("counts reactions and /vote taps, one vote per person, and closes", async () => {
    const h = makeHarness()
    // a group with /groupmenu: buttons are tappable there
    const g = {menu: true}
    const item = groupMsg("/poll Lunch? | pizza | sushi | tacos", {...g, memberId: 2, name: "bob"})
    await h.receive(item)
    const pollMsg = h.chat.sent.find((s) => s.kind === "send")!
    const text = h.chat.textOf(pollMsg.itemId)!
    const id = voteId(text)!
    assert.ok(id, text)
    assert.match(text, /📊 \*Lunch\?\*/)
    assert.match(text, /👍 \*pizza\*/)
    assert.match(text, /❤ \*sushi\*/)
    // Rubi pre-adds the option reactions (≤ 3 options) so people can just tap them
    const seeded = h.chat.sent.filter((s) => s.kind === "react" && s.itemId === pollMsg.itemId).map((s) => s.emoji)
    assert.deepEqual(seeded, ["👍", "❤", "🚀"])
    assert.match(text, /0 votes/, "Rubi's own reactions are not votes")

    // Rubi's own reaction events never count; carol reacts ❤ (sushi), dave taps /vote <id> 1 (pizza)
    await h.react(item.chatInfo, pollMsg.itemId, "👍", {type: "groupSnd"} as any)
    assert.match(h.chat.textOf(pollMsg.itemId)!, /0 votes/)
    await h.react(item.chatInfo, pollMsg.itemId, "❤️", {type: "groupRcv", groupMember: member(3, "carol")} as any)
    assert.match(h.chat.textOf(pollMsg.itemId)!, /sushi\*\n▰+▱* 1 \(100%\)/)
    await h.receive(groupMsg(`/vote ${id} 1`, {...g, memberId: 4, name: "dave"}))
    assert.equal(h.chat.last()!.kind, "react", "button tap is acknowledged with a reaction")
    let now = h.chat.textOf(pollMsg.itemId)!
    assert.match(now, /pizza\*\n▰+▱* 1 \(50%\)/)
    assert.match(now, /2 votes/)

    // carol changes her mind via a button: still one vote each
    await h.receive(groupMsg(`/vote ${id} 3`, {...g, memberId: 3, name: "carol"}))
    now = h.chat.textOf(pollMsg.itemId)!
    assert.match(now, /tacos\*\n▰+▱* 1 \(50%\)/)
    assert.match(now, /sushi\*\n▱+ 0 \(0%\)/)

    // only the creator can close it — not even a group admin
    await h.receive(groupMsg(`/endpoll ${id}`, {...g, memberId: 4, name: "dave"}))
    assert.match(h.chat.last()!.text!, /Only the poll's creator \(bob\)/)
    await h.receive(groupMsg(`/endpoll ${id}`, {...g, memberId: 6, name: "olga", role: T.GroupMemberRole.Owner}))
    assert.match(h.chat.last()!.text!, /Only the poll's creator/, "group owners can't close someone else's poll")
    await h.receive(groupMsg(`/endpoll ${id}`, {...g, memberId: 2, name: "bob"}))
    now = h.chat.textOf(pollMsg.itemId)!
    assert.match(now, /Poll closed · 2 votes/)
    assert.match(now, /🏆/)
    assert.doesNotMatch(now, /\/'vote/, "buttons disappear when closed")
    await h.receive(groupMsg(`/vote ${id} 1`, {...g, memberId: 5, name: "erin"}))
    assert.match(h.chat.last()!.text!, /ended or expired/)
  })

  it("in groups without a command menu: no vote buttons, vote by reaction, close as code", async () => {
    const h = makeHarness()
    const item = groupMsg("/poll Pizza tonight?")
    await h.receive(item)
    const msg = h.chat.sent.find((s) => s.kind === "send")!
    const text = h.chat.textOf(msg.itemId)!
    assert.doesNotMatch(text, /\/'|\/vote/, "no untappable /'vote' buttons")
    assert.match(text, /react with an option's emoji to vote/)
    assert.match(text, /Close: `\/endpoll [0-9a-f]+`/)
    assert.deepEqual(
      h.chat.sent.filter((s) => s.kind === "react").map((s) => s.emoji),
      ["👍", "👎"],
      "👍/👎 added by Rubi"
    )
    await h.react(item.chatInfo, msg.itemId, "👎", {type: "groupRcv", groupMember: member(3, "carol")} as any)
    assert.match(h.chat.textOf(msg.itemId)!, /No\*\n▰+ 1 \(100%\)/)
  })

  it("defaults to a 👍/👎 poll with buttons in DMs, and validates options", async () => {
    const h = makeHarness()
    await h.receive(dm("/poll Coffee?"))
    const msg = h.chat.sent.find((s) => s.kind === "send")!
    assert.match(h.chat.textOf(msg.itemId)!, /👍 \*Yes\*[\s\S]*\/'vote [0-9a-f]+ 1'[\s\S]*👎 \*No\*/)
    await h.receive(dm("/poll Q | only one", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /at least 2 options/)
  })

  it("doesn't pre-add reactions for polls with more than 3 options (SimpleX allows 3 per participant)", async () => {
    const h = makeHarness()
    await h.receive(dm("/poll Day? | mon | tue | wed | thu"))
    assert.equal(h.chat.sent.filter((s) => s.kind === "react").length, 0)
  })
})

describe("confirmations", () => {
  function kickHarness() {
    const h = makeHarness()
    h.chat.members = [member(3, "Jo Do"), member(9, "Boss", "owner")]
    return h
  }

  it("/kick asks first, and only the asker can confirm", async () => {
    const h = kickHarness()
    h.deliver(groupMsg("/kick @'Jo Do' spam", {role: T.GroupMemberRole.Admin, memberId: 2}))
    await sleep(40)
    // in a group without a command menu the important buttons show as code
    assert.match(h.chat.last()!.text!, /Remove @'Jo Do' from the group\?[\s\S]*✅ `\/confirm` {4}✖ `\/cancel`/)
    // someone else's /confirm doesn't count (deliver, not receive: /kick is still running, waiting)
    h.deliver(groupMsg("/confirm", {memberId: 7, name: "eve"}))
    await sleep(60)
    assert.match(h.chat.last()!.text!, /nothing waiting/)
    assert.equal(h.chat.calls.filter((c) => c[0] === "apiRemoveMembers").length, 0)
    // the asker confirms
    await h.receive(groupMsg("/confirm", {role: T.GroupMemberRole.Admin, memberId: 2}))
    assert.deepEqual(h.chat.calls.find((c) => c[0] === "apiRemoveMembers"), ["apiRemoveMembers", 5, [3]])
    assert.match(h.chat.last()!.text!, /Jo Do\* was removed by bob/)
    assert.ok(h.chat.texts().some((t) => /✅ Confirmed/.test(t)), "question is edited with the outcome")
  })

  it("/cancel aborts, and role rules are enforced", async () => {
    const h = kickHarness()
    h.deliver(groupMsg("/kick @'Jo Do'", {role: T.GroupMemberRole.Admin, memberId: 2}))
    await sleep(40)
    await h.receive(groupMsg("/cancel", {role: T.GroupMemberRole.Admin, memberId: 2}))
    await settle(h.dispatcher)
    assert.equal(h.chat.calls.filter((c) => c[0] === "apiRemoveMembers").length, 0)
    assert.ok(h.chat.texts().some((t) => /✖ Cancelled/.test(t)))

    // (different senders: /kick has a 3s per-user cooldown)
    await h.receive(groupMsg("/kick Boss", {role: T.GroupMemberRole.Admin, memberId: 20, name: "ann"}))
    assert.match(h.chat.last()!.text!, /^🔒 You can't remove Boss/)
    h.chat.members.push(member(21, "ben", "admin"))
    await h.receive(groupMsg("/kick ben", {role: T.GroupMemberRole.Admin, memberId: 21, name: "ben"}))
    assert.match(h.chat.last()!.text!, /You can't remove yourself/)
    await h.receive(groupMsg("/kick Rubi", {role: T.GroupMemberRole.Admin, memberId: 22, name: "cat"}))
    assert.match(h.chat.last()!.text!, /I can't remove myself/)
    await h.receive(groupMsg("/role @'Jo Do' owner", {role: T.GroupMemberRole.Admin, memberId: 2}))
    assert.match(h.chat.last()!.text!, /can't give a role above your own/)
    await h.receive(groupMsg("/role @'Jo Do' moderator", {role: T.GroupMemberRole.Admin, memberId: 2}))
    assert.deepEqual(h.chat.calls.find((c) => c[0] === "apiSetMembersRole"), ["apiSetMembersRole", 5, [3], "moderator"])
  })
})

describe("reminders (scheduler)", () => {
  it("schedules, lists, fires and cancels", async () => {
    const h = makeHarness()
    const item = dm("/remind 10m stretch")
    await h.receive(item)
    assert.match(h.chat.last()!.text!, /I'll remind you \*in 10m\*/)
    const jobs = h.rt.scheduler.list()
    assert.equal(jobs.length, 1)

    await h.receive(dm("/reminders"))
    assert.match(h.chat.last()!.text!, new RegExp(`stretch.*/'unremind ${jobs[0]!.id}'`))

    // make it due and run the scheduler
    jobs[0]!.at = Date.now() - 1
    h.rt.scheduler.start(h.rt)
    await sleep(50)
    h.rt.scheduler.stop()
    const fired = h.chat.last()!
    assert.match(fired.text!, /⏰ Reminder:\nstretch/)
    assert.equal(fired.quote, item.chatItem.meta.itemId)
    assert.equal(h.rt.scheduler.list().length, 0)

    await h.receive(dm("/remind 1h a"))
    const id = h.rt.scheduler.list()[0]!.id
    await h.receive(dm(`/unremind ${id}`, {contactId: 8}))
    assert.match(h.chat.last()!.text!, /No reminder of yours/, "can't cancel someone else's")
    await h.receive(dm(`/unremind ${id}`))
    assert.equal(h.rt.scheduler.list().length, 0)
    await h.receive(dm("/remind whenever"))
    assert.match(h.chat.last()!.text!, /Start with when/)
  })
})

describe("group settings (stored in chat custom data)", () => {
  it("/rules: admins set, everyone reads", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/rules set Be kind.", {role: T.GroupMemberRole.Member}))
    assert.match(h.chat.last()!.text!, /^🔒 Only group admins/)
    await h.receive(groupMsg("/rules set Be kind.", {role: T.GroupMemberRole.Admin, memberId: 3}))
    assert.deepEqual(h.chat.groupCustom.get(5), {rubi: {rules: "Be kind."}})
    await h.receive(groupMsg("/rules", {memberId: 4}))
    assert.match(h.chat.last()!.text!, /Rules of Club\*\n\nBe kind\./)
  })

  it("/warn counts up and removes at the limit", async () => {
    const h = makeHarness()
    h.chat.members = [member(3, "troll")]
    for (let i = 1; i <= 2; i++) {
      await h.receive(groupMsg(`/warn troll rude ${i}`, {role: T.GroupMemberRole.Moderator, memberId: 2}))
      assert.match(h.chat.last()!.text!, new RegExp(`warned \\(${i}/3\\)`))
    }
    await h.receive(groupMsg("/warnings troll", {role: T.GroupMemberRole.Moderator, memberId: 2}))
    assert.match(h.chat.last()!.text!, /2\/3 warnings[\s\S]*rude 1[\s\S]*rude 2/)
    await h.receive(groupMsg("/warn troll last straw", {role: T.GroupMemberRole.Moderator, memberId: 2}))
    assert.match(h.chat.last()!.text!, /Limit reached — \*troll\* was removed/)
    assert.deepEqual(h.chat.calls.find((c) => c[0] === "apiRemoveMembers"), ["apiRemoveMembers", 5, [3]])
  })

  it("/delete removes the quoted message", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/delete", {role: T.GroupMemberRole.Moderator}))
    assert.match(h.chat.last()!.text!, /Reply to \(quote\) the message/)
    await h.receive(groupMsg("/delete", {role: T.GroupMemberRole.Moderator, quote: {itemId: 555}}))
    assert.deepEqual(h.chat.calls.find((c) => c[0] === "apiDeleteMemberChatItem"), ["apiDeleteMemberChatItem", 5, [555]])
  })
})

describe("pagination", () => {
  it("/members pages with ◀ ▶ buttons", async () => {
    const h = makeHarness()
    h.chat.members = Array.from({length: 30}, (_, i) => member(10 + i, `user${String(i).padStart(2, "0")}`))
    await h.receive(groupMsg("/members"))
    const first = h.chat.last()!.text!
    assert.match(first, /31 members/)
    assert.match(first, /page 1\/2/)
    // group without a menu: paging buttons are kept (important) but shown as code
    const id = first.match(/`\/page ([0-9a-f]+) 2`/)?.[1]
    assert.ok(id, first)
    await h.receive(groupMsg(`/page ${id} 2`))
    assert.match(h.chat.last()!.text!, /page 2\/2/)
    assert.match(h.chat.last()!.text!, /◀ `\/page [0-9a-f]+ 1`/)
    await h.receive(dm(`/page ${id} 2`))
    assert.match(h.chat.last()!.text!, /expired/, "pages belong to their chat")
  })
})

describe("simple commands", () => {
  it("/calc, /roll, /rps, /whoami, /invite", async () => {
    const h = makeHarness()
    await h.receive(dm("/calc 15% * 80"))
    assert.match(h.chat.last()!.text!, /= \*12\*/)
    await h.receive(dm("/calc 2 +"))
    assert.match(h.chat.last()!.text!, /^❌ Unexpected end/)
    await h.receive(dm("/roll 3d6"))
    const total = Number(h.chat.last()!.text!.match(/→ \*(\d+)\*/)?.[1])
    assert.ok(total >= 3 && total <= 18)
    assert.match(h.chat.last()!.text!, /🔁 Again \/'roll 3d6'/)
    await h.receive(dm("/rps"))
    assert.match(h.chat.last()!.text!, /🪨 \/'rps rock'/)
    await h.receive(dm("/whoami", {contactId: 42}))
    assert.match(h.chat.last()!.text!, /Contact id: `42`[\s\S]*RUBI_BOT_ADMINS=42/)
    await h.receive(dm("/invite"))
    assert.match(h.chat.last()!.image!, /^data:image\/png;base64,/)
    assert.match(h.chat.last()!.text!, /smp\.example\/a#rubi/)
  })

  it("/weather formats Open-Meteo data (fake HTTP)", async () => {
    const h = makeHarness()
    fakeHttp(h, {
      "geocoding-api": {results: [{name: "Oslo", country: "Norway", latitude: 59.9, longitude: 10.7, timezone: "Europe/Oslo"}]},
      "api.open-meteo.com": {
        current: {temperature_2m: 3.4, apparent_temperature: 0.1, relative_humidity_2m: 80, wind_speed_10m: 12, weather_code: 3, is_day: 1},
        daily: {
          time: ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"],
          weather_code: [3, 61, 0, 71],
          temperature_2m_max: [5, 6, 7, 1],
          temperature_2m_min: [1, 2, 3, -2],
          precipitation_probability_max: [10, 80, 0, 60],
        },
      },
    })
    await h.receive(dm("/weather oslo"))
    const t = h.chat.last()!.text!
    assert.match(t, /☁️ \*Oslo, Norway\*/)
    assert.match(t, /3°C _38°F_ · Overcast/)
    assert.match(t, /🌦 \*Sat\* 2…6°C · 💧80%/)
  })
})

describe("trivia (interaction + scheduled reveal)", () => {
  it("records first answers and reveals winners", async () => {
    const h = makeHarness()
    fakeHttp(h, {
      opentdb: {
        response_code: 0,
        results: [{category: "Science%3A%20Computers", difficulty: "easy", question: "What%20does%20E2EE%20stand%20for%3F", correct_answer: "End-to-end%20encryption", incorrect_answers: ["A", "B", "C"]}],
      },
    })
    const item = groupMsg("/trivia", {menu: true})
    await h.receive(item)
    const msg = h.chat.sent.find((s) => s.kind === "send")!
    const q = h.chat.textOf(msg.itemId)!
    assert.match(q, /What does E2EE stand for\?/)
    const id = voteId(q)!
    const ix = h.rt.interactions.get<any>(id)!
    const correct = ix.state.correct as number

    await h.receive(groupMsg(`/vote ${id} ${correct + 1}`, {memberId: 3, name: "carol"}))
    await h.receive(groupMsg(`/vote ${id} ${((correct + 1) % 4) + 1}`, {memberId: 4, name: "dave"}))
    await h.receive(groupMsg(`/vote ${id} ${correct + 1}`, {memberId: 4, name: "dave"}))
    assert.match(h.chat.last()!.text!, /already answered/)
    assert.match(h.chat.textOf(msg.itemId)!, /2 answers so far/)

    const job = h.rt.scheduler.list()[0]!
    assert.equal(job.kind, "trivia-reveal")
    job.at = Date.now() - 1
    h.rt.scheduler.start(h.rt)
    await sleep(50)
    h.rt.scheduler.stop()
    const revealed = h.chat.textOf(msg.itemId)!
    assert.match(revealed, /✅ \*End-to-end encryption\*/)
    assert.match(revealed, /🏆 \*Right:\* carol/)
    assert.match(revealed, /1 wrong/)
  })
})

describe("/groupmenu (tappable commands in groups)", () => {
  it("sets the group's command menu when Rubi and the sender are owners", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/groupmenu", {role: T.GroupMemberRole.Admin}))
    assert.match(h.chat.last()!.text!, /^🔒/)
    await h.receive(groupMsg("/groupmenu", {role: T.GroupMemberRole.Owner, botRole: T.GroupMemberRole.Admin, memberId: 3}))
    assert.match(h.chat.last()!.text!, /I need to be a group \*owner\*/)
    await h.receive(groupMsg("/groupmenu", {role: T.GroupMemberRole.Owner, botRole: T.GroupMemberRole.Owner, memberId: 4}))
    const call = h.chat.calls.find((c) => c[0] === "apiUpdateGroupProfile")!
    const profile = call[2] as T.GroupProfile
    const keywords = JSON.stringify(profile.groupPreferences?.commands)
    assert.equal(profile.displayName, "Club", "the rest of the profile is kept")
    assert.match(keywords, /"keyword":"poll"/)
    assert.match(keywords, /"keyword":"rules"/, "group-only commands are in the group menu")
    assert.doesNotMatch(keywords, /"keyword":"password"/, "DM-only commands aren't")
    assert.match(h.chat.last()!.text!, /now tappable/)
  })
})

describe("live messages", () => {
  it("no live text ends with an ellipsis (the apps animate dots themselves)", () => {
    const h = makeHarness()
    for (const c of h.rt.commands.all()) if (c.live) assert.ok(!/(…|\.\.\.)$/.test(c.live), `/${c.name}: "${c.live}"`)
  })
})

describe("new utility & web commands", () => {
  it("/uuid, /hash, /base64, /timestamp", async () => {
    const h = makeHarness()
    await h.receive(dm("/uuid 20 v7"))
    const ids = h.chat.last()!.text!.match(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g)!
    assert.equal(ids.length, 20)
    assert.deepEqual([...ids].sort(), ids, "v7 ids made in one burst still sort in creation order")
    assert.equal(new Set(ids).size, 20)
    await h.receive(dm("/uuid", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/)
    await h.receive(dm("/hash sha256 hello"))
    assert.match(h.chat.last()!.text!, /2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/)
    await h.receive(dm("/base64 encode héllo"))
    assert.match(h.chat.last()!.text!, /aMOpbGxv/)
    await h.receive(dm("/base64 decode aMOpbGxv"))
    assert.match(h.chat.last()!.text!, /héllo/)
    await h.receive(dm("/base64 decode !!!"))
    assert.match(h.chat.last()!.text!, /isn't valid Base64/)
    await h.receive(dm("/timestamp 1700000000"))
    assert.match(h.chat.last()!.text!, /2023-11-14T22:13:20\.000Z/)
    await h.receive(dm("/timestamp 2030-01-01T00:00:00Z"))
    assert.match(h.chat.last()!.text!, /Unix: `1893456000`/)
  })

  it("/password is DM-only and random", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/password"))
    assert.match(h.chat.last()!.text!, /only works in a direct chat/)
    await h.receive(dm("/password 32"))
    const pw = h.chat.last()!.text!.match(/🔑 `([^`]+)`/)![1]!
    assert.equal(pw.length, 32)
    await h.receive(dm("/password 6 pin", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /🔑 `\d{6}`/)
  })

  it("/country works offline, by name, code or alias", async () => {
    const h = makeHarness()
    await h.receive(dm("/country UK"))
    assert.match(h.chat.last()!.text!, /🇬🇧 \*United Kingdom\*/)
    assert.match(h.chat.last()!.text!, /Capital:\* London/)
    await h.receive(dm("/country de", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /Germany/)
    await h.receive(dm("/country Atlantis", {contactId: 9}))
    assert.match(h.chat.last()!.text!, /don't know a country/)
  })

  it("/dns and /joke (fake HTTP; the joke's punchline is revealed live)", async () => {
    const h = makeHarness()
    fakeHttp(h, {
      "cloudflare-dns": {Status: 0, Answer: [{name: "simplex.chat", type: 15, TTL: 300, data: "10 mail.example.com."}]},
      jokeapi: {error: false, type: "twopart", setup: "Why do programmers prefer dark mode?", delivery: "Because light attracts bugs."},
    })
    await h.receive(dm("/dns simplex.chat MX"))
    assert.match(h.chat.last()!.text!, /simplex\.chat\* · MX[\s\S]*10 mail\.example\.com\. {2}\(TTL 300s\)/)
    await h.receive(dm("/dns not..valid", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /isn't a domain name/)

    h.chat.sent = []
    const done = h.receive(dm("/joke", {contactId: 9}))
    await sleep(300)
    assert.ok(h.chat.sent.some((s) => s.live && s.text === "😄 Why do programmers prefer dark mode?"), "setup shown live first")
    await done
    const last = h.chat.last()!
    assert.equal(last.live, false)
    assert.match(last.text!, /Why do programmers[\s\S]*👉 \*Because light attracts bugs\.\*/)
  })
})

describe("joining a group", () => {
  async function join(h: Harness, groupInfo: T.GroupInfo): Promise<string[]> {
    const onJoin = groupEvents.find((d) => d.event === "userJoinedGroup")!
    mock.timers.enable({apis: ["setTimeout"]})
    try {
      await onJoin.run({type: "userJoinedGroup", user: h.rt.user, groupInfo, hostMember: member(2, "bob")} as any, h.rt)
      assert.equal(h.chat.sent.length, 0, "waits a moment before greeting")
      mock.timers.tick(GREET_DELAY_MS)
    } finally {
      mock.timers.reset()
    }
    await sleep(30)
    return h.chat.texts()
  }
  const groupInfoOf = (opts: Parameters<typeof groupMsg>[1]) => (groupMsg("x", opts).chatInfo as T.ChatInfo.Group).groupInfo

  it("sends the welcome, then (groups only) how to enable the command menu", async () => {
    const h = makeHarness()
    const texts = await join(h, groupInfoOf({botRole: T.GroupMemberRole.Member}))
    assert.equal(texts[0], "Hi, I'm Rubi. Send /help.", "the welcome message itself is unchanged")
    assert.match(texts[1]!, /Tip for group owners/)
    assert.match(texts[1]!, /Make me a group \*owner\*[\s\S]*Send `\/groupmenu`/)
    assert.equal(texts.length, 2)
  })

  it("adapts when Rubi is already owner, and stays quiet if the menu is already set", async () => {
    let h = makeHarness()
    let texts = await join(h, groupInfoOf({botRole: T.GroupMemberRole.Owner}))
    assert.match(texts[1]!, /send `\/groupmenu`/)
    assert.doesNotMatch(texts[1]!, /Make me a group/)

    h = makeHarness()
    texts = await join(h, groupInfoOf({menu: true}))
    assert.deepEqual(texts, ["Hi, I'm Rubi. Send /help."])
  })
})
