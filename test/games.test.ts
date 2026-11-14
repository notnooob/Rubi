import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {winner} from "../data/commands/fun/ttt"
import {ANSWERS, wordFor, wordMarks} from "../data/commands/fun/word"
import {dm, groupMsg, makeHarness, member} from "./helpers/fake"

describe("hangman", () => {
  it("plays a game to a win and refuses a second game", async () => {
    const h = makeHarness()
    await h.receive(dm("/hangman"))
    const ix = h.rt.interactions.find<any>((i) => i.kind === "hangman")!
    const board = h.chat.textOf(ix.itemId)!
    assert.match(board, /Hangman/)
    assert.match(board, /6 wrong guesses left/)
    assert.match(board, /_ \/'hangman e' _/, "commands inside italics aren't tappable, so it stays outside the markers")

    await h.receive(dm("/hangman"))
    assert.match(h.chat.last()!.text!, /already running/)

    const word: string = ix.state.word
    const miss = [..."qxzjvkwy"].find((c) => !word.includes(c))!
    await h.receive(dm(`/hangman ${miss}`))
    assert.match(h.chat.textOf(ix.itemId)!, /Wrong: [a-z]/)
    assert.match(h.chat.textOf(ix.itemId)!, /5 wrong guesses left/)
    await h.receive(dm(`/hangman ${miss}`))
    assert.match(h.chat.last()!.text!, /already tried/)

    for (const c of new Set(word)) await h.receive(dm(`/hangman ${c}`))
    assert.match(h.chat.last()!.text!, new RegExp(`got it: \\*${word.toUpperCase()}\\*`))
    assert.equal(h.rt.interactions.find((i) => i.kind === "hangman"), undefined)
    await h.receive(dm("/hangman a"))
    assert.match(h.chat.last()!.text!, /No game is running/)
  })

  it("ends after six wrong guesses", async () => {
    const h = makeHarness()
    await h.receive(dm("/hangman"))
    const ix = h.rt.interactions.find<any>((i) => i.kind === "hangman")!
    for (let i = 0; i < 6; i++) await h.receive(dm(`/hangman wrongword${"abcdef"[i]}`))
    assert.match(h.chat.last()!.text!, /Out of guesses. The word was/)
    assert.match(h.chat.textOf(ix.itemId)!, /💀/)
  })
})

describe("tic-tac-toe", () => {
  it("detects wins and draws", () => {
    assert.equal(winner(["X", "X", "X", "", "O", "O", "", "", ""]), "X")
    assert.equal(winner(["O", "X", "", "X", "O", "", "", "X", "O"]), "O")
    assert.equal(winner(["X", "O", "X", "X", "O", "O", "O", "X", "X"]), "draw")
    assert.equal(winner(["X", "", "", "", "", "", "", "", ""]), undefined)
  })

  it("plays a game between two members with turn checks", async () => {
    const h = makeHarness()
    h.chat.members = [member(2, "bob"), member(3, "carol")]
    const bob = (t: string) => groupMsg(t, {memberId: 2, name: "bob", menu: true})
    const carol = (t: string) => groupMsg(t, {memberId: 3, name: "carol", menu: true})

    await h.receive(bob("/ttt @bob"))
    assert.match(h.chat.last()!.text!, /against yourself/)
    await h.receive(bob("/ttt @carol"))
    const ix = h.rt.interactions.find<any>((i) => i.kind === "ttt")!
    assert.match(h.chat.textOf(ix.itemId)!, /❌ \*bob\* vs ⭕ \*carol\*/)
    assert.match(h.chat.textOf(ix.itemId)!, /\/'ttt 5'/, "free cells are buttons where commands are tappable")

    await h.receive(carol("/ttt 5"))
    assert.match(h.chat.last()!.text!, /bob's turn/)
    await h.receive(bob("/ttt 1"))
    await h.receive(carol("/ttt 1"))
    assert.match(h.chat.last()!.text!, /free cell/)
    for (const [who, cell] of [[carol, 4], [bob, 2], [carol, 5], [bob, 3]] as const) await h.receive(who(`/ttt ${cell}`))
    assert.match(h.chat.last()!.text!, /🏆 \*bob\* wins!/)
    assert.match(h.chat.textOf(ix.itemId)!, /❌❌❌/)
    assert.equal(h.rt.interactions.find((i) => i.kind === "ttt"), undefined)
  })

  it("lets either player stop", async () => {
    const h = makeHarness()
    h.chat.members = [member(3, "carol")]
    await h.receive(groupMsg("/ttt @carol"))
    await h.receive(groupMsg("/ttt stop", {memberId: 3, name: "carol"}))
    assert.match(h.chat.last()!.text!, /Game stopped/)
    await h.receive(groupMsg("/ttt 5"))
    assert.match(h.chat.last()!.text!, /not in a game/)
  })
})

describe("daily word", () => {
  it("marks repeated letters only as often as the answer has them", () => {
    assert.equal(wordMarks("crane", "crane"), "🟩🟩🟩🟩🟩")
    assert.equal(wordMarks("eerie", "there"), "🟨⬜🟨⬜🟩")
    assert.equal(wordMarks("speed", "abide"), "⬜⬜🟨⬜🟨")
    assert.equal(wordMarks("lolly", "hello"), "⬜🟨🟩🟩⬜")
  })

  it("has only 5-letter answers and picks a stable word per day", () => {
    assert.ok(ANSWERS.every((w) => /^[a-z]{5}$/.test(w)), ANSWERS.filter((w) => !/^[a-z]{5}$/.test(w)).join(","))
    assert.equal(wordFor("2026-11-14"), wordFor("2026-11-14"))
  })

  it("shares guesses in a group, limits guesses per player and scores the solver", async () => {
    const h = makeHarness()
    const answer = wordFor(new Date().toISOString().slice(0, 10))
    const wrong = ANSWERS.find((w) => w !== answer)!
    await h.receive(groupMsg("/word abc"))
    assert.match(h.chat.last()!.text!, /exactly 5 letters/)
    for (let i = 0; i < 6; i++) await h.receive(groupMsg(`/word ${wrong}`))
    assert.match(h.chat.last()!.text!, /0 guesses left for bob/)
    await h.receive(groupMsg(`/word ${answer}`))
    assert.match(h.chat.last()!.text!, /used your 6 guesses/)

    await h.receive(groupMsg(`/word ${answer}`, {memberId: 3, name: "carol"}))
    assert.match(h.chat.last()!.text!, /🎉 \*carol\* solved it in 1 guess!/)
    assert.match(h.chat.last()!.text!, new RegExp(`\`${wrong.toUpperCase()}\` bob`), "the group sees everyone's guesses")
    await h.receive(groupMsg(`/word ${wrong}`, {memberId: 4, name: "dave"}))
    assert.match(h.chat.last()!.text!, /was solved by \*carol\*/)
    await h.receive(groupMsg("/word scores"))
    assert.match(h.chat.last()!.text!, /🏆 \*carol\*: 1 win/)
    await h.receive(dm("/word scores"))
    assert.match(h.chat.last()!.text!, /No wins yet/, "scores are per chat")
  })
})
