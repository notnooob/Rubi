import assert from "node:assert/strict"
import {existsSync, writeFileSync} from "node:fs"
import {describe, it} from "node:test"
import sharp from "sharp"
import {HttpError} from "../src/core/http"
import {inlineToSimplex, parseRedditLink, postHeader, postMedia, postStats, redditToSimplex, type RedditPost} from "../src/services/reddit"
import {dm, groupMsg, makeHarness, type Harness} from "./helpers/fake"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("reddit links", () => {
  it("finds the post id in every link form", () => {
    const id = {postId: "17snc7e", commentId: undefined}
    assert.deepEqual(parseRedditLink("https://www.reddit.com/r/running/comments/17snc7e/achievements_for_saturday/"), id)
    assert.deepEqual(parseRedditLink("old.reddit.com/r/x/comments/17snc7e"), id)
    assert.deepEqual(parseRedditLink("https://reddit.com/comments/17snc7e/"), id)
    assert.deepEqual(parseRedditLink("https://redd.it/17snc7e"), {postId: "17snc7e"})
    assert.deepEqual(parseRedditLink("https://www.reddit.com/gallery/17snc7e"), {postId: "17snc7e"})
    assert.deepEqual(parseRedditLink("t3_17snc7e"), {postId: "17snc7e"})
    assert.deepEqual(parseRedditLink("17SNC7E"), {postId: "17snc7e"})
    assert.deepEqual(parseRedditLink("https://www.reddit.com/r/running/comments/17snc7d/achievements/k8so54m/?share_id=x"), {
      postId: "17snc7d",
      commentId: "k8so54m",
    })
  })
  it("recognizes share links and rejects other sites", () => {
    assert.deepEqual(parseRedditLink("https://www.reddit.com/r/SUB/s/TOKEN123"), {share: "https://www.reddit.com/r/SUB/s/TOKEN123"})
    assert.deepEqual(parseRedditLink("reddit.com/u/someone/s/AbC9/"), {share: "https://www.reddit.com/u/someone/s/AbC9"})
    assert.equal(parseRedditLink("https://example.com/r/x/comments/17snc7e"), undefined)
    assert.equal(parseRedditLink("https://www.reddit.com/r/pics/"), undefined)
    assert.equal(parseRedditLink("not a link"), undefined)
  })
})

describe("reddit markdown → SimpleX", () => {
  it("converts emphasis, spoilers, superscript and escapes", () => {
    assert.equal(inlineToSimplex("a **b** c *d* e ~~f~~ >!spoil me!< ^(tiny) x^2"), "a *b* c _d_ e ~f~ #spoil me# tiny x2")
    assert.equal(inlineToSimplex("***both*** and __bold__"), "*both* and *bold*")
    assert.equal(inlineToSimplex(String.raw`\*not italic\* and 1 \+ 1`), "*not italic* and 1 + 1")
    assert.equal(inlineToSimplex("snake_case_name stays"), "snake_case_name stays")
  })
  it("drops markers SimpleX can't render instead of showing them", () => {
    // SimpleX only formats from the start of a word, and doesn't nest
    assert.equal(inlineToSimplex('code "**SIGMA30**" now'), 'code "SIGMA30" now')
    assert.equal(inlineToSimplex("**bold *nested* here**"), "*bold nested here*")
  })
  it("keeps code and URLs literal", () => {
    assert.equal(inlineToSimplex("`a*b*c` and https://x.com/a_b_c_"), "`a*b*c` and https://x.com/a_b_c_")
  })
  it("converts links to SimpleX hyperlinks where it can", () => {
    assert.equal(inlineToSimplex("see [the page](https://a.com/x)"), "see [the page](https://a.com/x)")
    assert.equal(inlineToSimplex("[https://a.com](https://a.com)"), "https://a.com")
    // SimpleX link texts can't contain punctuation
    assert.equal(inlineToSimplex("[Link: here](https://a.com)"), "Link: here (https://a.com)")
    assert.equal(inlineToSimplex("[wiki](/r/pics/wiki)"), "[wiki](https://www.reddit.com/r/pics/wiki)")
  })
  it("converts blocks: headings, lists, quotes, rules, code", () => {
    const md = [
      "#Title with **bold**",
      "",
      "* one",
      "+ two",
      "1) first",
      "",
      "&gt; quoted *text*",
      "",
      "***",
      "",
      "    indented code",
      "    more",
      "",
      "```",
      "fenced **raw**",
      "```",
      "&amp;#x200B;",
    ].join("\n")
    assert.equal(
      redditToSimplex(md),
      ["# Title with bold", "", "- one", "- two", "1. first", "", "> quoted _text_", "", "──────────", "", "```", "indented code", "more", "```", "", "```", "fenced **raw**", "```", "&#x200B;"].join("\n")
    )
  })
})

const post = (p: Partial<RedditPost> = {}): RedditPost => ({
  id: "abc123",
  title: "A &amp; B",
  selftext: "",
  author: "alice",
  subreddit: "pics",
  score: 1234,
  upvote_ratio: 0.94,
  num_comments: 56,
  created_utc: Math.floor(Date.now() / 1000) - 3 * 86400,
  retrieved_on: Math.floor(Date.now() / 1000),
  _meta: {retrieved_2nd_on: 1},
  permalink: "/r/pics/comments/abc123/a_b/",
  url: "https://www.reddit.com/r/pics/comments/abc123/a_b/",
  is_self: true,
  ...p,
})

const gallery = (): Partial<RedditPost> => ({
  is_self: false,
  url: "https://www.reddit.com/gallery/abc123",
  gallery_data: {items: [{media_id: "m2", caption: "second"}, {media_id: "m1"}]},
  media_metadata: {
    m1: {status: "valid", e: "Image", m: "image/jpeg", id: "m1", s: {u: "https://i.redd.it/m1.jpeg"}},
    m2: {status: "valid", e: "Image", m: "image/png", id: "m2", s: {u: "https://preview.redd.it/m2.png?width=1&amp;s=x"}},
  },
})

describe("reddit media", () => {
  it("lists gallery items in order, with captions", () => {
    const m = postMedia(post(gallery()))
    assert.deepEqual(
      m.map((x) => [x.kind, x.url, x.caption]),
      [
        ["image", "https://preview.redd.it/m2.png?width=1&s=x", "second"],
        ["image", "https://i.redd.it/m1.jpeg", undefined],
      ]
    )
  })
  it("finds Reddit videos (with their audio playlist) and GIF fallbacks", () => {
    const v = postMedia(
      post({is_self: false, url: "https://v.redd.it/v1", media: {reddit_video: {fallback_url: "https://v.redd.it/v1/CMAF_720.mp4", dash_url: "https://v.redd.it/v1/DASHPlaylist.mpd", duration: 12}}})
    )
    assert.deepEqual(v.map((x) => [x.kind, x.url, x.dashUrl, x.duration]), [["video", "https://v.redd.it/v1/CMAF_720.mp4", "https://v.redd.it/v1/DASHPlaylist.mpd", 12]])
    const g = postMedia(
      post({is_self: false, url: "https://i.redd.it/g.gif", preview: {images: [{source: {url: "https://preview.redd.it/g.gif?s=1", width: 9, height: 9}, variants: {mp4: {source: {url: "https://preview.redd.it/g.gif?format=mp4"}}}}]}})
    )
    assert.equal(g[0]!.kind, "gif")
    assert.deepEqual(g[0]!.alts?.[0], {kind: "video", url: "https://preview.redd.it/g.gif?format=mp4"})
    assert.deepEqual(postMedia(post({is_self: false, url: "https://www.youtube.com/watch?v=x"})), [], "pages aren't attachments")
    assert.deepEqual(postMedia(post({is_self: false, url: "https://files.example.org/paper.pdf"})).map((x) => x.kind), ["file"])
  })
  it("puts subreddit, author, date and flair under the title, and the score in the stats", () => {
    const p = post({over_18: true, link_flair_text: "OC", upvote_ratio: 0.5, num_comments: 2290})
    assert.equal(postHeader(p), "# A & B\n!6 r/pics! · u/alice · 3d ago · 🏷 OC · !1 NSFW!")
    assert.equal(postStats(p), "⬆️ *1,234* upvotes · !1 50% upvoted! · 💬 2,290 comments")
  })
  it("keeps hashtags as plain text", () => {
    assert.equal(inlineToSimplex("love #birds and C#"), "love #⁠birds and C#")
  })
})

/** Fake HTTP for /reddit: JSON routes, and "downloads" that write a real little PNG. */
function fakeReddit(h: Harness, data: {posts: RedditPost[]; redirect?: string; shortLinks?: Record<string, string>}) {
  const downloads: string[] = []
  const requests: string[] = []
  const http = {
    withSignal: () => http,
    json: async (url: string) => {
      if (url.includes("/api/posts/ids")) return {data: data.posts}
      if (url.includes("/api/comments/ids")) return {data: []}
      if (url.includes("/api/short_links")) {
        const hit = Object.entries(data.shortLinks ?? {})[0]
        return {data: hit ? [{original_path: hit[0], resolved_path: hit[1]}] : []}
      }
      throw new HttpError(`no fake route for ${url}`)
    },
    text: async () => "",
    request: async (url: string) => {
      requests.push(url)
      if (url.includes("/s/") && data.redirect) return {status: 301, headers: new Headers({location: data.redirect}), body: Buffer.alloc(0)}
      throw new HttpError("not found", 404)
    },
    download: async (url: string, file: string) => {
      downloads.push(url)
      if (url.includes("gone")) throw new HttpError("Reddit media: nothing found.", 404)
      writeFileSync(file, await sharp({create: {width: 40, height: 30, channels: 3, background: "#808"}}).png().toBuffer())
      return {bytes: 100, contentType: "image/png", url}
    },
  }
  ;(h.rt as any).http = http
  return Object.assign(downloads, {requests})
}

async function untilFinal(h: Harness): Promise<void> {
  for (let i = 0; i < 200 && !h.chat.sent.some((s) => s.kind === "update" && !s.live); i++) await sleep(10)
  await sleep(30)
}

describe("/reddit", () => {
  it("replies live with the post, then attaches its images", async () => {
    const h = makeHarness()
    const downloads = fakeReddit(h, {posts: [post({...gallery(), selftext: "Hello **world**"})]})
    const item = dm("/r https://www.reddit.com/r/pics/comments/abc123/a_b/")
    await h.receive(item)
    await untilFinal(h)

    const placeholder = h.chat.sent[0]!
    assert.equal(placeholder.live, true, "starts as a live message")
    assert.equal(placeholder.quote, item.chatItem.meta.itemId)
    const final = h.chat.sent.find((s) => s.kind === "update" && !s.live)!
    assert.equal(final.itemId, placeholder.itemId, "the placeholder becomes the post")
    assert.match(final.text!, /^# A & B\n/)
    assert.match(final.text!, /Hello \*world\*/)
    assert.match(final.text!, /⬆️ \*1,234\* upvotes · !2 94% upvoted!/)
    assert.match(final.text!, /📎 2 images below/)
    assert.match(final.text!, /🌐 https:\/\/redd\.it\/abc123$/)
    for (const s of h.chat.sent.filter((s) => s.kind === "update" && s.live)) assert.doesNotMatch(s.text!, /(…|\.\.\.)$/)

    assert.deepEqual([...downloads], ["https://preview.redd.it/m2.png?width=1&s=x", "https://i.redd.it/m1.jpeg"])
    const images = h.chat.sent.filter((s) => s.type === "image")
    assert.equal(images.length, 2)
    assert.equal(images[0]!.quote, placeholder.itemId, "the first attachment quotes the post")
    assert.equal(images[0]!.text, "second", "gallery captions are kept")
    for (const img of images) {
      assert.match(img.image!, /^data:image\/jpg;base64,/)
      assert.match(img.file!, /reddit-abc123-[0-9a-f]+[\\/]\d\.png$/)
    }
    // the stats sit at the bottom: under the text, above the attachments line and the link
    assert.match(final.text!, /Hello \*world\*\n\n⬆️ [^\n]+\n📎 2 images below\n\n🌐/)

    // attachments are temporary: deleted shortly after SimpleX reports each upload as done
    assert.ok(images.every((i) => existsSync(i.file!)), "kept while uploading")
    h.rt.tempFiles.uploaded(images[0]!.itemId)
    await sleep(60)
    assert.ok(existsSync(images[1]!.file!), "the folder waits for every upload")
    h.rt.tempFiles.uploaded(images[1]!.itemId)
    await sleep(60)
    assert.ok(images.every((i) => !existsSync(i.file!)), "deleted after the last upload")
    assert.equal(h.rt.tempFiles.pending, 0)
  })

  it("resolves share links with Arctic Shift first", async () => {
    const h = makeHarness()
    const calls = fakeReddit(h, {posts: [post()], shortLinks: {"/r/pics/s/AbCdEf": "/r/pics/comments/abc123/a_b/?share_id=x"}})
    await h.receive(dm("/reddit https://www.reddit.com/r/pics/s/AbCdEf"))
    await untilFinal(h)
    assert.match(h.chat.sent.find((s) => s.kind === "update" && !s.live)!.text!, /# A & B/)
    assert.deepEqual(calls.requests, [], "no request to reddit.com")
  })

  it("falls back to following the share link's redirects, and notes deleted media", async () => {
    const h = makeHarness()
    const p = post({is_self: false, url: "https://i.redd.it/gone.jpeg", post_hint: "image"})
    fakeReddit(h, {posts: [p], redirect: "https://www.reddit.com/r/pics/comments/abc123/a_b/?share_id=x"})
    await h.receive(dm("/reddit https://www.reddit.com/r/pics/s/AbCdEf"))
    await untilFinal(h)
    const final = h.chat.sent.find((s) => s.kind === "update" && !s.live)!
    assert.match(final.text!, /# A & B/)
    assert.match(final.text!, /🗑 Some media has been deleted\./)
    assert.equal(h.chat.sent.filter((s) => s.file).length, 0)
  })

  it("doesn't send NSFW media in groups", async () => {
    const h = makeHarness()
    const downloads = fakeReddit(h, {posts: [post({...gallery(), over_18: true})]})
    await h.receive(groupMsg("/reddit abc123"))
    await untilFinal(h)
    const final = h.chat.sent.find((s) => s.kind === "update" && !s.live)!
    assert.match(final.text!, /🔞 Media from NSFW posts is only sent in DMs\./)
    assert.equal(downloads.length, 0)
  })

  it("explains bad links and missing posts", async () => {
    const h = makeHarness()
    fakeReddit(h, {posts: []})
    await h.receive(dm("/reddit https://example.com/x"))
    assert.match(h.chat.last()!.text!, /isn't a Reddit post link/)
    await h.receive(dm("/reddit zzzzzz", {contactId: 3}))
    await untilFinal(h)
    assert.match(h.chat.last()!.text!, /couldn't find post `zzzzzz`/)
  })
})
