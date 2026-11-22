import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {languageCode, parseLanguages} from "../data/commands/web/translate"
import {HttpError} from "../src/core/http"
import {dm, makeHarness, type Harness} from "./helpers/fake"

/** Swap the runtime's HTTP client for one canned MyMemory answer, recording the requests. */
function fakeMyMemory(h: Harness, answer: unknown): {url: string; query: Record<string, unknown>}[] {
  const calls: {url: string; query: Record<string, unknown>}[] = []
  const http = {
    withSignal: () => http,
    json: async (url: string, opts: {query?: Record<string, unknown>}) => {
      calls.push({url, query: opts.query ?? {}})
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  ;(h.rt as any).http = http
  return calls
}

const ok = (text: string, extra: object = {}) => ({responseData: {translatedText: text, ...extra}, responseStatus: 200, responseDetails: "", quotaFinished: false})

describe("/translate", () => {
  it("parses languages: codes, regions, names and source>target", () => {
    assert.equal(languageCode("DE"), "de")
    assert.equal(languageCode("pt-br"), "pt-BR")
    assert.equal(languageCode("German"), "de")
    assert.equal(languageCode("chinese"), "zh-CN")
    assert.equal(languageCode("klingonese"), undefined)
    assert.deepEqual(parseLanguages("fr>en"), {from: "fr", to: "en"})
    assert.deepEqual(parseLanguages("de"), {to: "de"})
    assert.equal(parseLanguages("fr>xx>en"), undefined)
  })

  it("translates text with the source detected", async () => {
    const h = makeHarness()
    const calls = fakeMyMemory(h, ok("Guten Morgen", {detectedLanguage: "en"}))
    await h.receive(dm("/translate german good morning"))
    assert.deepEqual(calls[0]!.query, {q: "good morning", langpair: "Autodetect|de", de: undefined})
    assert.equal(h.chat.last()!.text, "🌍 *en → de*\nGuten Morgen\n_via MyMemory_")
  })

  it("translates the replied-to message, decoding HTML entities", async () => {
    const h = makeHarness()
    const calls = fakeMyMemory(h, ok("It&#39;s raining"))
    await h.receive(dm("/tr fr>en", {quotedText: "Il pleut"}))
    assert.equal(calls[0]!.query.langpair, "fr|en")
    assert.equal(calls[0]!.query.q, "Il pleut")
    assert.match(h.chat.last()!.text!, /fr → en\*\nIt's raining/)
  })

  it("explains bad input, quota and service errors", async () => {
    const h = makeHarness()
    fakeMyMemory(h, ok("x"))
    await h.receive(dm("/translate xx-yyyyy hi"))
    assert.match(h.chat.last()!.text!, /isn't a language I know/)
    await h.receive(dm("/translate de"))
    assert.match(h.chat.last()!.text!, /or reply to a message/)
    await h.receive(dm(`/translate de ${"a".repeat(501)}`))
    assert.match(h.chat.last()!.text!, /too long to translate at once \(501 characters/)
    await h.receive(dm("/translate en>en hi"))
    assert.match(h.chat.last()!.text!, /two different languages/)

    fakeMyMemory(h, {...ok("MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"), quotaFinished: true})
    await h.receive(dm("/translate de hi"))
    assert.match(h.chat.last()!.text!, /free daily quota is used up/)

    fakeMyMemory(h, {responseData: {translatedText: "'AUTODETECT' IS AN INVALID SOURCE LANGUAGE"}, responseStatus: "403", responseDetails: "'AUTODETECT' IS AN INVALID SOURCE LANGUAGE"})
    await h.receive(dm("/translate de hi", {contactId: 8}))
    assert.match(h.chat.last()!.text!, /couldn't translate that \('autodetect' is an invalid source language\)\. If it couldn't tell the language, name it/)

    fakeMyMemory(h, new HttpError("The translation service timed out."))
    await h.receive(dm("/translate de hi", {contactId: 9}))
    assert.match(h.chat.last()!.text!, /timed out/)
  })

  it("sends the operator's email only when configured", async () => {
    const h = makeHarness((cfg) => {
      cfg.http.translateEmail = "ops@example.org"
    })
    const calls = fakeMyMemory(h, ok("Hallo"))
    await h.receive(dm("/translate de hello"))
    assert.equal(calls[0]!.query.de, "ops@example.org")
  })
})

describe("replies as input", () => {
  it("/qr and /hash use the replied-to message", async () => {
    const h = makeHarness()
    await h.receive(dm("/hash sha256", {quotedText: "hello"}))
    assert.match(h.chat.last()!.text!, /2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/)
    await h.receive(dm("/hash sha256"))
    assert.match(h.chat.last()!.text!, /reply to a message/)
    await h.receive(dm("/qr", {quotedText: "https://simplex.chat"}))
    assert.equal(h.chat.last()!.type, "image")
    await h.receive(dm("/base64 encode", {quotedText: "hello"}))
    assert.match(h.chat.last()!.text!, /aGVsbG8=/)
  })
})
