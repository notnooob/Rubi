import {setTimeout as sleep} from "node:timers/promises"
import {defineCommand, fmt} from "../../../src/sdk"

type Joke = {error: boolean; type: "single"; joke: string} | {error: boolean; type: "twopart"; setup: string; delivery: string}

export default defineCommand({
  name: "joke",
  description: "A joke — the punchline arrives live",
  details: "From JokeAPI in safe mode (no NSFW, religious, political, racist, sexist or explicit jokes).",
  category: "Fun",
  args: [{name: "topic", type: "string", description: "programming, pun, misc or spooky", choices: ["programming", "pun", "misc", "spooky"]}],
  examples: ["joke", "joke programming"],
  live: "😄 Thinking of one",
  cooldown: 5,
  async run(ctx) {
    const category = ctx.args.topic ? ctx.args.topic[0]!.toUpperCase() + ctx.args.topic.slice(1) : "Any"
    const j = await ctx.http.json<Joke>(`https://v2.jokeapi.dev/joke/${category}`, {
      service: "JokeAPI",
      query: {"safe-mode": "", blacklistFlags: "nsfw,religious,political,racist,sexist,explicit"},
    })
    if (j.error) return ctx.fail("I'm all out of jokes right now.")
    if (j.type === "single") return `😄 ${j.joke}`
    // live reveal: show the setup, pause, then the punchline in the same message
    ctx.progress(`😄 ${j.setup}`)
    await sleep(3500, undefined, {signal: ctx.signal})
    return fmt.lines(`😄 ${j.setup}`, "", `👉 ${fmt.bold(j.delivery)}`)
  },
})
