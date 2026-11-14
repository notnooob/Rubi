import {randomInt} from "node:crypto"
import {chatUtil, defineCommand, defineInteraction, fmt, makeUi, type Interaction} from "../../../src/sdk"

const MAX_WRONG = 6

const WORDS = (
  "anchor badger balloon banana basket blanket bottle bridge bubble button cactus camera candle canyon carpet castle " +
  "cherry circus cobweb comet compass cookie copper cotton crayon dragon drawer eagle engine falcon feather forest " +
  "fossil garden garlic ginger giraffe glacier goblin guitar hammer harbor helmet hockey island jacket jigsaw jungle " +
  "kettle kitten ladder lantern lemon lizard magnet mammoth marble meadow mirror monkey mosaic muffin needle noodle " +
  "orange orchid oyster paddle parrot peanut pencil pepper pickle pillow pirate planet pocket potato puzzle pyramid " +
  "rabbit raccoon radish rocket saddle salmon sandal scooter shadow silver spider spiral squirrel sunset teapot " +
  "thunder ticket tomato tunnel turtle umbrella unicorn velvet violin volcano walnut wizard window winter yogurt zipper"
).split(" ")

interface HangmanState {
  word: string
  guessed: string[]
  wrong: number
  ownerName: string
  prefix: string
  tappable: boolean
  result?: "won" | "lost" | "stopped"
}

function gallows(n: number): string {
  const p = (i: number, ch: string) => (n >= i ? ch : " ")
  return ["  +---+", "  |   |", `  ${p(1, "O")}   |`, ` ${p(3, "/")}${p(2, "|")}${p(4, "\\")}  |`, ` ${p(5, "/")} ${p(6, "\\")}  |`, "      |", "========="].join("\n")
}

const solved = (s: HangmanState) => [...s.word].every((c) => s.guessed.includes(c))

function render(ix: Interaction<HangmanState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const shown = s.result ? s.word : s.word.replace(/./g, (c) => (s.guessed.includes(c) ? c : "_"))
  const misses = s.guessed.filter((c) => c.length === 1 && !s.word.includes(c))
  return fmt.lines(
    `🪢 ${fmt.bold("Hangman")}`,
    fmt.codeBlock(gallows(s.wrong)),
    fmt.code([...shown.toUpperCase()].join(" ")),
    misses.length ? `Wrong: ${misses.join(", ")}` : undefined,
    s.result === "won"
      ? "🎉 Solved!"
      : s.result === "lost"
        ? "💀 Out of guesses."
        : s.result === "stopped"
          ? fmt.italic("Stopped.")
          : // the command stays outside the italics: SimpleX doesn't parse commands inside formatting
            `${fmt.italic(`${MAX_WRONG - s.wrong} wrong guesses left · anyone can guess:`)} ${ui.cmd("hangman", "e")} ${fmt.italic(`or the whole word · by ${s.ownerName}`)}`,
    !s.result ? ui.button("✖ Stop", "cancel", ix.id, {important: true}) : ui.button("🔁 New game", "hangman")
  )
}

defineInteraction<HangmanState>("hangman", {
  onCancel(ix) {
    ix.state.result = "stopped"
    return {text: render(ix), done: true, reply: "✅ Hangman stopped."}
  },
})

export default defineCommand({
  name: "hangman",
  description: "Play hangman together",
  details: `Start with /hangman, then anyone guesses with /hangman <letter> or /hangman <word>. ${MAX_WRONG} wrong guesses and it's over. One game per chat; the starter can stop it.`,
  category: "Fun",
  args: [{name: "guess", type: "string", description: "A letter or the whole word"}],
  examples: ["hangman", "hangman e", "hangman rocket"],
  cooldown: 0,
  async run(ctx) {
    const key = chatUtil.chatKey(ctx.ref)
    const active = ctx.rt.interactions.find<HangmanState>((ix) => ix.kind === "hangman" && chatUtil.chatKey(ix.ref) === key)
    const guess = ctx.args.guess?.toLowerCase()
    if (!guess) {
      if (active) return ctx.fail(`A game is already running here. Guess with ${ctx.ui.cmd("hangman", "<letter>")}.`)
      const state: HangmanState = {word: WORDS[randomInt(WORDS.length)]!, guessed: [], wrong: 0, ownerName: ctx.sender.displayName, prefix: ctx.config.prefix, tappable: ctx.ui.tappable}
      const msg = await ctx.reply(`🪢 ${fmt.bold("Hangman")}`)
      const ix = ctx.rt.interactions.create("hangman", msg, state, {ownerKey: ctx.sender.key, ttlMs: 86_400_000})
      await msg.edit(render(ix))
      return
    }
    if (!active) return ctx.fail(`No game is running here. Start one with ${ctx.ui.cmd("hangman")}.`)
    if (!/^\p{L}+$/u.test(guess)) return ctx.usageError("Guess one letter or the whole word.")
    const outcome = await ctx.rt.interactions.mutate<HangmanState, string>(active.id, async (ix) => {
      const s = ix.state
      if (s.guessed.includes(guess)) return `You already tried ${fmt.bold(guess)}.`
      s.guessed.push(guess)
      const hit = guess.length === 1 ? s.word.includes(guess) : guess === s.word
      if (!hit) s.wrong++
      if (guess === s.word || solved(s)) s.result = "won"
      else if (s.wrong >= MAX_WRONG) s.result = "lost"
      await ctx.rt.messenger.update(ix.ref, ix.itemId, render(ix))
      if (s.result) ctx.rt.interactions.end(ix.id)
      else ctx.rt.interactions.save(ix)
      if (s.result === "won") return `🎉 ${fmt.bold(ctx.sender.displayName)} got it: ${fmt.bold(s.word.toUpperCase())}!`
      if (s.result === "lost") return `💀 Out of guesses. The word was ${fmt.bold(s.word.toUpperCase())}.`
      await ctx.react(hit ? "✅" : "👎")
      return ""
    })
    if (outcome === undefined) return ctx.fail("That game has just ended.")
    return outcome || undefined
  },
})
