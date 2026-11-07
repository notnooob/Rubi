import assert from "node:assert/strict"
import {describe, it} from "node:test"
import sharp from "sharp"
import {HttpError} from "../src/core/http"
import {bestCurrentDeals, cheapSharkDealUrl, renderGameDeals, type CheapSharkGame} from "../src/services/cheapshark"
import {groupMsg, dm, makeHarness, type Harness} from "./helpers/fake"

const game = (): CheapSharkGame => ({
  info: {title: "LEGO Batman", steamAppID: "21000", thumb: "https://img.example/batman.jpg"},
  cheapestPriceEver: {price: "3.99", date: 1543028665},
  deals: [
    {storeID: "23", dealID: "deal-fanatical", price: "4.23", retailPrice: "19.99", savings: "78.839420"},
    {storeID: "21", dealID: "deal-gmg", price: "4.23", retailPrice: "19.99", savings: "78.839420"},
    {storeID: "1", dealID: "deal-steam", price: "19.99", retailPrice: "19.99", savings: "0.000000"},
  ],
})

const stores = [
  {storeID: "1", storeName: "Steam", isActive: 1 as const},
  {storeID: "21", storeName: "GreenManGaming", isActive: 1 as const},
  {storeID: "23", storeName: "Fanatical", isActive: 1 as const},
]

/** Canned search/lookup/stores responses and artwork; matches the Http surface this command uses. */
function fakeCheapShark(h: Harness, opts: {artwork?: Buffer; artworkFails?: boolean} = {}) {
  const urls: string[] = []
  const http = {
    withSignal: () => http,
    json: async (url: string, options: {query?: Record<string, unknown>}) => {
      urls.push(`${url}?${new URLSearchParams(Object.entries(options.query ?? {}).map(([k, v]) => [k, String(v)]))}`)
      if (url.endsWith("/stores")) return stores
      if (options.query?.id) return game()
      if (options.query?.title) return [{gameID: "612", external: "LEGO Batman", steamAppID: "21000", thumb: "https://img.example/batman.jpg"}]
      throw new HttpError(`no fake route for ${url}`)
    },
    request: async (url: string) => {
      urls.push(url)
      if (opts.artworkFails) throw new HttpError("artwork unavailable")
      const body = opts.artwork ?? await sharp({create: {width: 40, height: 30, channels: 3, background: "#808"}}).jpeg().toBuffer()
      return {status: 200, ok: true, url, headers: new Headers({"content-type": "image/jpeg"}), body, json: () => ({}), text: () => body.toString(), ms: 1}
    },
  }
  ;(h.rt as any).http = http
  return urls
}

describe("CheapShark deals", () => {
  it("renders every deal and marks all stores tied for best current price", () => {
    const g = game()
    const byId = new Map(stores.map((s) => [s.storeID, s.storeName]))
    assert.deepEqual(bestCurrentDeals(g.deals, byId).map((d) => d.storeID), ["23", "21"])
    const text = renderGameDeals(g, byId)
    assert.match(text, /🎮 \*LEGO Batman\*/)
    assert.match(text, /Steam app id: `21000`/)
    assert.match(text, /Historical low: \$3\.99 on Nov 24, 2018/)
    assert.match(text, /Best now: \$4\.23 at Fanatical \+ GreenManGaming/)
    for (const deal of g.deals) {
      assert.ok(text.includes(cheapSharkDealUrl(deal.dealID)))
      assert.ok(text.includes(`$${deal.price} / $${deal.retailPrice} retail`))
    }
    assert.match(text, /Fanatical — \$4\.23 \/ \$19\.99 retail · 78\.84% off/)
    assert.match(text, /GreenManGaming — \$4\.23 \/ \$19\.99 retail · 78\.84% off/)
    assert.match(text, /Steam — \$19\.99 \/ \$19\.99 retail · 0% off/)
  })

  it("starts live, deletes its placeholder, and sends thumbnail plus all details in one image message", async () => {
    const h = makeHarness()
    const urls = fakeCheapShark(h)
    await h.receive(dm("/deals LEGO Batman"))

    const live = h.chat.sent[0]!
    assert.equal(live.kind, "send")
    assert.equal(live.live, true)
    assert.equal(live.text, "💰 Finding game deals")
    assert.ok(h.chat.sent.some((s) => s.kind === "delete" && s.itemId === live.itemId), "live placeholder is deleted before the image")
    assert.ok(urls.some((u) => u.includes("/games?title=LEGO+Batman")))
    assert.ok(urls.some((u) => u.includes("/games?id=612")))
    assert.ok(urls.some((u) => u.endsWith("/stores?")))
    assert.ok(urls.includes("https://img.example/batman.jpg"))

    const images = h.chat.sent.filter((s) => s.type === "image")
    assert.equal(images.length, 1, "no separate text result or image")
    assert.match(images[0]!.image!, /^data:image\/jpg;base64,/, "thumbnail() made a small SimpleX JPEG data URI")
    assert.match(images[0]!.text!, /\*LEGO Batman\*[\s\S]*Steam app id: `21000`/)
    assert.match(images[0]!.text!, /Historical low: \$3\.99 on Nov 24, 2018/)
    assert.match(images[0]!.text!, /Best now: \$4\.23 at Fanatical \+ GreenManGaming/)
    for (const name of ["Fanatical", "GreenManGaming", "Steam"]) assert.ok(images[0]!.text!.includes(name))
    assert.equal(h.chat.sent.filter((s) => s.kind === "update" && !s.live).length, 0)
  })

  it("uses the same complete details as text when artwork download fails", async () => {
    const h = makeHarness()
    fakeCheapShark(h, {artworkFails: true})
    await h.receive(dm("/deals LEGO Batman"))
    const final = h.chat.sent.find((s) => s.kind === "update" && !s.live)!
    assert.match(final.text!, /Current deals \(3, USD\)/)
    assert.match(final.text!, /https:\/\/www\.cheapshark\.com\/redirect\?dealID=deal-steam/)
    assert.equal(h.chat.sent.filter((s) => s.type === "image").length, 0)
  })

  it("does not request artwork when group files are disabled", async () => {
    const h = makeHarness()
    const urls = fakeCheapShark(h)
    const item = groupMsg("/deals LEGO Batman")
    ;(item.chatInfo as any).groupInfo.fullGroupPreferences = {files: {enable: "off"}}
    await h.receive(item)
    assert.ok(!urls.includes("https://img.example/batman.jpg"))
    const final = h.chat.sent.find((s) => s.kind === "update" && !s.live)!
    assert.match(final.text!, /Best now: \$4\.23/)
    assert.equal(h.chat.sent.filter((s) => s.type === "image").length, 0)
  })
})
