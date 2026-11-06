import assert from "node:assert/strict"
import {existsSync, writeFileSync} from "node:fs"
import {describe, it} from "node:test"
import sharp from "sharp"
import {HttpError} from "../src/core/http"
import {noteText, parseXLink, renderXPost, xMedia, xStats, type XPost} from "../src/services/x"
import {dm, groupMsg, makeHarness, type Harness} from "./helpers/fake"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const NOW = Date.UTC(2026, 10, 6, 12)

describe("X links", () => {
  it("takes the user and status id from x.com and twitter.com links", () => {
    assert.deepEqual(parseXLink("https://x.com/777pb_/status/2117568544523137264"), {user: "777pb_", id: "2117568544523137264"})
    assert.deepEqual(parseXLink("twitter.com/jack/status/20?s=46&t=abc"), {user: "jack", id: "20"})
    assert.deepEqual(parseXLink("https://mobile.twitter.com/jack/status/20/photo/1"), {user: "jack", id: "20"})
    assert.deepEqual(parseXLink("https://fxtwitter.com/jack/status/20"), {user: "jack", id: "20"})
    assert.deepEqual(parseXLink("https://x.com/i/web/status/20"), {user: undefined, id: "20"})
  })
  it("rejects everything else", () => {
    assert.equal(parseXLink("https://x.com/jack"), undefined)
    assert.equal(parseXLink("https://example.com/jack/status/20"), undefined)
    assert.equal(parseXLink("hello"), undefined)
  })
})

const author = (screen_name: string, name: string, verified = false) => ({screen_name, name, verification: {verified, type: verified ? "individual" : null}})

/** Like https://api.fxtwitter.com/777pb_/status/2116719195958210983: two photos, no text. */
const photos = (): XPost => ({
  id: "2116719195958210983",
  url: "https://x.com/777pb_/status/2116719195958210983",
  text: "",
  author: author("777pb_", "Sev"),
  created_timestamp: Math.floor(NOW / 1000) - 5 * 86400,
  replies: 26,
  retweets: 192,
  likes: 6723,
  bookmarks: 1690,
  quotes: 2,
  views: 92431,
  media: {
    all: [
      {type: "photo", url: "https://pbs.twimg.com/media/A.jpg?name=orig", width: 1536, height: 2048},
      {type: "photo", url: "https://pbs.twimg.com/media/B.jpg?name=orig", width: 1536, height: 2048},
    ],
  },
})

/** Like https://api.fxtwitter.com/777pb_/status/2117568544523137264: a quote of a reply. */
const quoting = (): XPost => ({
  id: "2117568544523137264",
  url: "https://x.com/777pb_/status/2117568544523137264",
  text: "Im never leaving this app",
  author: author("777pb_", "Sev"),
  created_timestamp: Math.floor(NOW / 1000) - 3 * 86400,
  replies: 4,
  retweets: 3,
  likes: 161,
  bookmarks: 16,
  quotes: 0,
  views: 39031,
  quote: {
    id: "2117460300735689069",
    url: "https://x.com/elonmusk/status/2117460300735689069",
    text: "@broudsov You are fully wrong",
    author: author("elonmusk", "Elon Musk", true),
    created_timestamp: Math.floor(NOW / 1000) - 3 * 86400,
    replying_to: "broudsov",
    replying_to_status: "2117232243907125289",
    media: {videos: [{type: "video", url: "https://video.twimg.com/q.mp4", thumbnail_url: "https://pbs.twimg.com/q.jpg", duration: 7.5}]},
  },
})

describe("X formatting", () => {
  it("shows a photo post with its stats", () => {
    const p = photos()
    assert.equal(renderXPost(p, {now: NOW}), "𝕏 *Sev* !3 @777pb_! · 5d ago")
    assert.equal(xStats(p), "💬 *26* · 🔁 *192* · ❝ *2* · ❤️ *6,723* · 🔖 *1,690* · 👁 *92.4K* views")
    assert.deepEqual(
      xMedia(p).map((m) => [m.kind, m.url, m.alts?.[0]?.url]),
      [
        ["image", "https://pbs.twimg.com/media/A.jpg?name=orig", "https://pbs.twimg.com/media/A.jpg?name=large"],
        ["image", "https://pbs.twimg.com/media/B.jpg?name=orig", "https://pbs.twimg.com/media/B.jpg?name=large"],
      ]
    )
  })
  it("shows the quoted post as a quote, with its reply context and media count", () => {
    const text = renderXPost(quoting(), {now: NOW})
    assert.equal(
      text,
      [
        "𝕏 *Sev* !3 @777pb_! · 3d ago",
        "",
        "Im never leaving this app",
        "",
        "> 🔁 *Elon Musk* ☑️ !3 @elonmusk! · 3d ago",
        "> _↩️ Replying to @broudsov_",
        ">",
        "> You are fully wrong",
        ">",
        "> _🖼 1 video_",
        "> 🌐 https://x.com/elonmusk/status/2117460300735689069",
      ].join("\n")
    )
    const media = xMedia(quoting())
    assert.deepEqual(media.map((m) => [m.kind, m.url, m.previewUrl, m.duration, m.caption]), [
      ["video", "https://video.twimg.com/q.mp4", "https://pbs.twimg.com/q.jpg", 7.5, "From @elonmusk's quoted post"],
    ])
  })
  it("shows replies under the post they answer, polls, community notes and hashtags", () => {
    const parent: XPost = {...photos(), text: "Original take", media: {}}
    const reply: XPost = {
      ...photos(),
      text: "@777pb_ Agreed #birds",
      media: {},
      replying_to: "777pb_",
      replying_to_status: parent.id,
      poll: {choices: [{label: "Yes", count: 30, percentage: 75}, {label: "No", count: 10, percentage: 25}], total_votes: 40, time_left_en: "Final results"},
      community_note: {text: "Context here example.com/a…", entities: [{fromIndex: 13, toIndex: 27, ref: {url: "https://t.co/x"}}]},
    }
    const text = renderXPost(reply, {parent, now: NOW})
    assert.match(text, /^> ↩️ \*Sev\* [^\n]+\n>\n> Original take\n> 🌐 https:\/\/x\.com\/777pb_\/status\/\d+\n\n𝕏 \*Sev\*/)
    assert.match(text, /_↩️ Replying to @777pb__\n\nAgreed #⁠birds/)
    assert.match(text, /▰+▱* \*Yes\* _75%_\n▰+▱* No _25%_\n_📊 40 votes · Final results_/)
    assert.match(text, /📝 \*Community note\*\nContext here https:\/\/t\.co\/x$/)
  })
  it("expands community note links from facets too", () => {
    assert.equal(noteText({text: "See exa.mple/…", facets: [{type: "url", indices: [4, 14], replacement: "https://exa.mple/full"}]}), "See https://exa.mple/full")
  })
})

/** Fake FxTwitter + media downloads. */
function fakeX(h: Harness, posts: Record<string, XPost | {code: number; message: string}>) {
  const urls: string[] = []
  const http = {
    withSignal: () => http,
    request: async (url: string) => {
      urls.push(url)
      const id = url.match(/status\/(\d+)/)?.[1] ?? ""
      const p = posts[id] ?? {code: 404, message: "NOT_FOUND"}
      const body = "code" in p ? p : {code: 200, message: "OK", tweet: p}
      return {status: body.code, ok: body.code === 200, body: Buffer.from(JSON.stringify(body)), json: () => body, text: () => JSON.stringify(body), headers: new Headers()}
    },
    download: async (url: string, file: string) => {
      if (url.includes("gone")) throw new HttpError("X media: nothing found.", 404)
      writeFileSync(file, await sharp({create: {width: 40, height: 30, channels: 3, background: "#808"}}).jpeg().toBuffer())
      return {bytes: 100, contentType: url.endsWith(".mp4") ? "video/mp4" : "image/jpeg", url}
    },
  }
  ;(h.rt as any).http = http
  return urls
}

async function untilFinal(h: Harness): Promise<void> {
  for (let i = 0; i < 200 && !h.chat.sent.some((s) => s.kind === "update" && !s.live); i++) await sleep(10)
  await sleep(30)
}

describe("/x", () => {
  it("asks FxTwitter for <user>/status/<id> and attaches the photos", async () => {
    const h = makeHarness()
    const urls = fakeX(h, {"2116719195958210983": photos()})
    await h.receive(dm("/x https://x.com/777pb_/status/2116719195958210983"))
    await untilFinal(h)
    assert.equal(urls[0], "https://api.fxtwitter.com/777pb_/status/2116719195958210983")
    const final = h.chat.sent.find((s) => s.kind === "update" && !s.live)!
    assert.equal(final.itemId, h.chat.sent[0]!.itemId, "the live placeholder becomes the post")
    assert.match(final.text!, /^𝕏 \*Sev\*[^\n]+\n\n💬 \*26\*[^\n]+views\n📎 2 images below\n\n🌐 https:\/\/x\.com\/777pb_\/status\/2116719195958210983$/)
    const images = h.chat.sent.filter((s) => s.type === "image")
    assert.equal(images.length, 2)
    assert.equal(images[0]!.quote, final.itemId)
    for (const id of images.map((i) => i.itemId)) h.rt.tempFiles.uploaded(id)
    await sleep(60)
    assert.ok(images.every((i) => !existsSync(i.file!)), "deleted once uploaded")
  })

  it("attaches the quoted post's video", async () => {
    const h = makeHarness()
    fakeX(h, {"2117568544523137264": quoting()})
    await h.receive(dm("/tweet https://twitter.com/777pb_/status/2117568544523137264"))
    await untilFinal(h)
    const video = h.chat.sent.find((s) => s.type === "video")!
    assert.equal(video.text, "From @elonmusk's quoted post")
    assert.match(video.image!, /^data:image\/jpg;base64,/)
  })

  it("doesn't send sensitive media in groups, and explains missing posts", async () => {
    const h = makeHarness()
    fakeX(h, {"1": {...photos(), id: "1", possibly_sensitive: true}})
    await h.receive(groupMsg("/x https://x.com/a/status/1"))
    await untilFinal(h)
    assert.match(h.chat.sent.find((s) => s.kind === "update" && !s.live)!.text!, /🔞 Media from sensitive posts is only sent in DMs\./)
    assert.equal(h.chat.sent.filter((s) => s.file).length, 0)

    await h.receive(dm("/x https://x.com/a/status/404"))
    await untilFinal(h)
    assert.match(h.chat.last()!.text!, /doesn't exist, or it was deleted/)
    await h.receive(dm("/x https://example.com/a", {contactId: 3}))
    assert.match(h.chat.last()!.text!, /isn't a link to a post on X/)
  })
})
