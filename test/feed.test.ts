import assert from "node:assert/strict"
import {describe, it} from "node:test"
import type {T} from "@simplex-chat/types"
import {HttpError} from "../src/core/http"
import {forgetChat} from "../src/core/forget"
import {findFeedLink, parseFeed, xmlText} from "../src/services/feeds"
import {dm, groupMsg, makeHarness, type Harness} from "./helpers/fake"

const ADMIN = {role: "admin" as T.GroupMemberRole}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const RSS = (items: [string, string][]) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Dev &amp; Ops blog</title><link>https://blog.example</link>
${items.map(([id, title]) => `<item><title><![CDATA[${title}]]></title><link>https://blog.example/${id}</link><guid>${id}</guid><pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate></item>`).join("\n")}
</channel></rss>`

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Release notes from rubi</title>
<entry><id>tag:github.com,2008:Repository/1/v1.2.0</id><updated>2026-11-01T12:00:00Z</updated>
<link rel="alternate" type="text/html" href="https://github.com/x/rubi/releases/tag/v1.2.0"/>
<title type="html">v1.2.0 &lt;b&gt;stable&lt;/b&gt; &#x1F389;</title></entry></feed>`

function fakeText(h: Harness, routes: Record<string, string | (() => string)>): string[] {
  const calls: string[] = []
  const http = {
    withSignal: () => http,
    text: async (url: string) => {
      calls.push(url)
      const r = routes[url]
      if (r === undefined) throw new HttpError("Feed: not found", 404)
      return typeof r === "function" ? r() : r
    },
    json: async (url: string) => {
      calls.push(url)
      const r = routes[url]
      if (r === undefined) throw new HttpError("RDAP: not found", 404)
      return JSON.parse(typeof r === "function" ? r() : r)
    },
  }
  ;(h.rt as any).http = http
  return calls
}

async function runDueJobs(h: Harness): Promise<void> {
  for (const job of h.rt.scheduler.list()) job.at = Date.now() - 1
  h.rt.scheduler.start(h.rt)
  await sleep(80)
  h.rt.scheduler.stop()
}

describe("feed parsing", () => {
  it("reads RSS and Atom entries", () => {
    const rss = parseFeed(RSS([["b", "Second #post"], ["a", "First"]]))
    assert.equal(rss.title, "Dev & Ops blog")
    assert.deepEqual(rss.items.map((i) => [i.id, i.title, i.link]), [["b", "Second #post", "https://blog.example/b"], ["a", "First", "https://blog.example/a"]])
    assert.equal(rss.items[0]!.date, Date.UTC(2026, 10, 14, 10))

    const atom = parseFeed(ATOM)
    assert.equal(atom.title, "Release notes from rubi")
    assert.equal(atom.items[0]!.title, "v1.2.0 stable 🎉")
    assert.equal(atom.items[0]!.link, "https://github.com/x/rubi/releases/tag/v1.2.0")
    assert.equal(atom.items[0]!.id, "tag:github.com,2008:Repository/1/v1.2.0")
  })

  it("decodes entities but not inside CDATA, and finds a page's feed link", () => {
    assert.equal(xmlText("<![CDATA[a &amp; b]]> &amp; &#39;c&#39;"), "a &amp; b & 'c'")
    const html = `<html><head><link rel="stylesheet" href="/x.css"><link type="application/rss+xml" rel="alternate" title="RSS" href="/feed.xml"></head></html>`
    assert.equal(findFeedLink(html, "https://blog.example/post/1"), "https://blog.example/feed.xml")
    assert.equal(findFeedLink("<html></html>", "https://blog.example"), undefined)
  })
})

describe("/feed", () => {
  it("subscribes via a page's feed link, posts only new entries and survives failures", async () => {
    const h = makeHarness()
    let feed = RSS([["a", "First"]])
    let down = false
    fakeText(h, {
      "https://blog.example/": `<link rel="alternate" type="application/atom+xml" href="https://blog.example/feed.xml">`,
      "https://blog.example/feed.xml": () => {
        if (down) throw new HttpError("Feed is having problems right now (503).", 503)
        return feed
      },
    })
    await h.receive(groupMsg("/feed add blog.example"))
    assert.match(h.chat.last()!.text!, /Only group admins/)
    await h.receive(groupMsg("/feed add blog.example", ADMIN))
    assert.match(h.chat.last()!.text!, /Following \*Dev & Ops blog\*/)
    assert.match(h.chat.last()!.text!, /Latest: First/)
    const job = h.rt.scheduler.list<any>((j) => j.kind === "feed")[0]!
    assert.equal(job.payload.url, "https://blog.example/feed.xml")

    await h.receive(groupMsg("/feed add https://blog.example/feed.xml", ADMIN))
    assert.match(h.chat.last()!.text!, /already follows/)

    const sent = h.chat.sent.length
    await runDueJobs(h)
    assert.equal(h.chat.sent.length, sent, "nothing new, nothing posted")

    feed = RSS([["c", "Third #news"], ["b", "Second"], ["a", "First"]])
    await runDueJobs(h)
    const post = h.chat.last()!.text!
    assert.match(post, /📰 \*Dev & Ops blog\*\n• Second\n {2}https:\/\/blog.example\/b\n• Third #⁠news/, "oldest first, hashtags kept plain")
    assert.doesNotMatch(post, /First/)

    down = true
    await runDueJobs(h)
    const failing = h.rt.scheduler.get(job.id) as any
    assert.ok(failing, "a failing feed keeps its job")
    assert.equal(failing.payload.failures, 1)
    assert.ok(!failing.failedAt)
    await h.receive(groupMsg("/feed"))
    assert.match(h.chat.last()!.text!, /1 failed checks/)

    await h.receive(groupMsg(`/feed remove ${job.id}`, ADMIN))
    assert.match(h.chat.last()!.text!, /Removed/)
    assert.equal(h.rt.scheduler.list().length, 0)
  })

  it("rejects pages without a feed, and is dropped with the chat", async () => {
    const h = makeHarness()
    fakeText(h, {"https://nofeed.example/": "<html></html>", "https://ok.example/": ATOM})
    await h.receive(groupMsg("/feed add nofeed.example", ADMIN))
    assert.match(h.chat.last()!.text!, /isn't an RSS or Atom feed/)
    await h.receive(groupMsg("/feed add ok.example", ADMIN))
    assert.equal(h.rt.scheduler.list().length, 1)
    forgetChat(h.rt, {chatType: "group", chatId: 5} as any)
    assert.equal(h.rt.scheduler.list().length, 0)
  })
})

describe("/whois", () => {
  const domain = JSON.stringify({
    ldhName: "EXAMPLE.ORG",
    status: ["client transfer prohibited"],
    events: [
      {eventAction: "registration", eventDate: "1995-08-31T04:00:00Z"},
      {eventAction: "expiration", eventDate: "2030-08-30T04:00:00Z"},
    ],
    entities: [{roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar, Inc."]]]}],
    nameservers: [{ldhName: "A.IANA-SERVERS.NET"}, {ldhName: "B.IANA-SERVERS.NET"}],
    secureDNS: {delegationSigned: true},
  })

  it("looks up a domain, falling back from a subdomain", async () => {
    const h = makeHarness()
    const calls = fakeText(h, {"https://rdap.org/domain/example.org": domain})
    await h.receive(dm("/whois https://www.example.org/page"))
    const text = h.chat.last()!.text!
    assert.deepEqual(calls, ["https://rdap.org/domain/www.example.org", "https://rdap.org/domain/example.org"])
    assert.match(text, /🔎 \*example.org\*/)
    assert.match(text, /Registrar: Example Registrar, Inc./)
    assert.match(text, /Registered: 1995-08-31/)
    assert.match(text, /Expires: 2030-08-30/)
    assert.match(text, /Name servers: a.iana-servers.net, b.iana-servers.net/)
    assert.match(text, /DNSSEC: signed/)
  })

  it("looks up an IP and reports unknown domains", async () => {
    const h = makeHarness()
    fakeText(h, {"https://rdap.org/ip/1.1.1.1": JSON.stringify({name: "APNIC-LABS", handle: "1.1.1.0 - 1.1.1.255", startAddress: "1.1.1.0", endAddress: "1.1.1.255", country: "AU"})})
    await h.receive(dm("/whois 1.1.1.1"))
    assert.match(h.chat.last()!.text!, /Network: \*APNIC-LABS\*/)
    assert.match(h.chat.last()!.text!, /Country: AU/)
    await h.receive(dm("/whois nothing.invalid", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /No RDAP record/)
    await h.receive(dm("/whois not_a_domain", {contactId: 9}))
    assert.match(h.chat.last()!.text!, /isn't a domain name/)
  })
})
