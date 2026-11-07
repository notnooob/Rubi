import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {dm, groupMsg, makeHarness, member} from "./helpers/fake"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const voteId = (text: string) => text.match(/\/'vote ([0-9a-f]+) /)?.[1]
const encoded = (s: string) => encodeURIComponent(s)
const question = (text: string, correct: string) => ({category: "General%20Knowledge", difficulty: "easy", question: encoded(text), correct_answer: encoded(correct), incorrect_answers: ["A", "B", "C"]})

function fakeQuestions(h: ReturnType<typeof makeHarness>, results: ReturnType<typeof question>[]): {calls: string[]} {
  const calls: string[] = []
  const http = {
    withSignal: () => http,
    json: async (url: string, opts: {query?: {amount?: number}}) => {
      calls.push(url)
      return {response_code: 0, results: results.slice(0, opts.query?.amount ?? 1)}
    },
  }
  ;(h.rt as any).http = http
  return {calls}
}

async function runDueJobs(h: ReturnType<typeof makeHarness>): Promise<void> {
  for (const job of h.rt.scheduler.list()) job.at = Date.now() - 1
  h.rt.scheduler.start(h.rt)
  await sleep(80)
  h.rt.scheduler.stop()
}

describe("would you rather", () => {
  it("starts custom and built-in questions and counts changing votes", async () => {
    const h = makeHarness()
    const item = groupMsg("/wyr Be able to fly | Be invisible", {menu: true})
    await h.receive(item)
    const msg = h.chat.sent.find((s) => s.kind === "send")!
    let text = h.chat.textOf(msg.itemId)!
    assert.match(text, /🤔 \*Would you rather…\*/)
    assert.match(text, /👍 \*Be able to fly\*/)
    assert.match(text, /❤ \*Be invisible\*/)
    const id = voteId(text)!

    await h.react(item.chatInfo, msg.itemId, "👍", {type: "groupRcv", groupMember: member(3, "carol")} as any)
    await h.react(item.chatInfo, msg.itemId, "❤️", {type: "groupRcv", groupMember: member(4, "dave")} as any)
    text = h.chat.textOf(msg.itemId)!
    assert.match(text, /Be able to fly\*[\s\S]*1 \(50%\)/)
    assert.match(text, /Be invisible\*[\s\S]*1 \(50%\)/)
    assert.match(text, /2 votes/)

    // Carol's new choice replaces her first vote instead of adding another.
    await h.receive(groupMsg(`/vote ${id} 2`, {memberId: 3, name: "carol"}))
    text = h.chat.textOf(msg.itemId)!
    assert.match(text, /Be able to fly\*[\s\S]*0 \(0%\)/)
    assert.match(text, /Be invisible\*[\s\S]*2 \(100%\)/)
    assert.match(text, /2 votes/)

    // A no-argument invocation chooses one of the built-in prompts.
    await h.receive(dm("/wouldyourather"))
    const builtIn = h.chat.last()!
    assert.match(h.chat.textOf(builtIn.itemId)!, /🤔 \*Would you rather…\*/)
    assert.deepEqual(h.chat.sent.filter((s) => s.kind === "react" && s.itemId === builtIn.itemId).map((s) => s.emoji), ["👍", "❤"])
  })

  it("validates custom options", async () => {
    const h = makeHarness()
    await h.receive(dm("/wyr only one option"))
    assert.match(h.chat.last()!.text!, /exactly two options/)
  })
})

describe("trivia tournament", () => {
  it("plays two rounds, keeps cumulative scores, and leaves no jobs after the final", async () => {
    const h = makeHarness()
    const {calls} = fakeQuestions(h, [question("First question?", "First correct"), question("Second question?", "Second correct")])
    await h.receive(groupMsg("/trivia tournament 2 easy", {menu: true}))
    assert.equal(calls.length, 1, "all tournament questions are fetched in one request")

    const first = h.chat.sent.find((s) => s.kind === "send")!
    const firstText = h.chat.textOf(first.itemId)!
    assert.match(firstText, /Trivia tournament\* · Round 1\/2/)
    assert.match(firstText, /First question\?/)
    const firstIx = h.rt.interactions.get<any>(voteId(firstText)!)!
    await h.receive(groupMsg(`/vote ${firstIx.id} ${firstIx.state.correct + 1}`, {memberId: 3, name: "carol"}))
    await h.receive(groupMsg(`/vote ${firstIx.id} ${((firstIx.state.correct + 1) % 4) + 1}`, {memberId: 4, name: "dave"}))

    await runDueJobs(h)
    const revealedFirst = h.chat.textOf(first.itemId)!
    assert.match(revealedFirst, /Scoreboard: 🏆 \*carol\*: 1 point · \*dave\*: 0 points/)
    assert.match(revealedFirst, /Next round in about 5 seconds/)
    const next = h.rt.scheduler.list().find((j) => j.kind === "tournament-next")!
    assert.ok(next, "the next round is scheduled")
    assert.equal((next.payload as any).tournament.questions.length, 1, "the remaining question is persisted for the next job")

    await runDueJobs(h)
    const second = h.chat.sent.filter((s) => s.kind === "send").at(-1)!
    assert.notEqual(second.itemId, first.itemId, "each round is a new message")
    const secondText = h.chat.textOf(second.itemId)!
    assert.match(secondText, /Round 2\/2/)
    assert.match(secondText, /Second question\?/)
    const secondIx = h.rt.interactions.get<any>(voteId(secondText)!)!
    await h.receive(groupMsg(`/vote ${secondIx.id} ${secondIx.state.correct + 1}`, {memberId: 4, name: "dave"}))

    await runDueJobs(h)
    const final = h.chat.textOf(second.itemId)!
    assert.match(final, /Final scoreboard: 🏆 \*carol\*: 1 point · \*dave\*: 1 point/)
    assert.match(final, /Tournament winners:\* \*carol\*, \*dave\*/)
    assert.doesNotMatch(final, /Next round/)
    assert.equal(h.rt.scheduler.list().length, 0, "no reveal or next-round job remains")
  })

  it("reports a failed next-round fetch without scheduling another round", async () => {
    const h = makeHarness()
    fakeQuestions(h, [question("Only round", "Correct")])
    await h.receive(groupMsg("/trivia tournament 2", {menu: true}))
    const next = h.rt.scheduler.schedule("tournament-next", Date.now() - 1, {
      ref: groupMsg("x").chatInfo.type === "group" ? {type: "group", chatId: 5} : {type: "direct", chatId: 7},
      prefix: "/",
      tappable: false,
      tournament: {round: 2, total: 2, scores: {}, names: {}},
    })
    assert.ok(next)
    ;(h.rt as any).http = {json: async () => { throw new Error("offline") }}
    await runDueJobs(h)
    assert.match(h.chat.last()!.text!, /Couldn't fetch round 2\/2; the tournament has ended/)
    assert.match(h.chat.last()!.text!, /Scores so far:/)
    assert.equal(h.rt.scheduler.list().length, 0)
  })
})
