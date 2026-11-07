import {randomInt} from "node:crypto"
import {defineCommand, defineInteraction, describeError, fmt, makeUi, normalizeReaction, type Interaction} from "../../../src/sdk"

const EMOJI = ["👍", "❤"] as const

const PROMPTS: readonly (readonly [string, string])[] = [
  ["Explore outer space", "Explore the deepest oceans"],
  ["Always be 10 minutes late", "Always be 20 minutes early"],
  ["Be able to fly", "Be able to turn invisible"],
  ["Live without music", "Live without films"],
  ["Have unlimited books", "Have unlimited games"],
  ["Travel to the past", "Travel to the future"],
  ["Speak every language", "Talk to animals"],
  ["Never need sleep", "Never need food"],
  ["Live in the mountains", "Live by the sea"],
  ["Have a personal chef", "Have a personal chauffeur"],
  ["Only whisper", "Only shout"],
  ["Be famously funny", "Be famously wise"],
  ["Live one 1,000-year life", "Live ten 100-year lives"],
  ["Always have a full battery", "Always have free Wi-Fi"],
  ["Give up coffee forever", "Give up chocolate forever"],
  ["Be able to rewind time", "Be able to pause time"],
  ["Have a robot clean your home", "Have a robot cook your meals"],
  ["Spend a year aboard a spaceship", "Spend a year aboard a submarine"],
  ["Find a hidden treasure", "Discover a new species"],
  ["Have perfect pitch", "Have a photographic memory"],
]

interface WyrState {
  options: [string, string]
  /** userKey → option index; each person's latest choice replaces their previous one. */
  votes: Record<string, number>
  ownerName: string
  prefix: string
  tappable: boolean
  reactionsOff?: boolean
}

function render(ix: Interaction<WyrState>): string {
  const s = ix.state
  const ui = makeUi(s.tappable, s.prefix)
  const counts = s.options.map((_, i) => Object.values(s.votes).filter((v) => v === i).length)
  const total = counts[0]! + counts[1]!
  const rows = s.options.map((option, i) => {
    const n = counts[i]!
    const pct = total ? Math.round((n / total) * 100) : 0
    const button = s.tappable ? `  ${ui.button("", "vote", `${ix.id} ${i + 1}`)}` : ""
    return `${EMOJI[i]} ${fmt.bold(option)}\n${fmt.bar(total ? n / total : 0)} ${n} (${pct}%)${button}`
  })
  const how = s.reactionsOff
    ? s.tappable
      ? "tap a button to vote"
      : `vote with ${ui.cmd("vote", `${ix.id} <1|2>`)}`
    : s.tappable
      ? "react or tap to vote"
      : "react with an option's emoji to vote"
  return fmt.lines(
    `🤔 ${fmt.bold("Would you rather…")}`,
    "",
    rows.join("\n\n"),
    "",
    fmt.italic(`${fmt.plural(total, "vote")} · ${how} · you can change your vote · by ${s.ownerName}`)
  )
}

defineInteraction<WyrState>("wyr", {
  onReaction(ix, r) {
    const i = EMOJI.indexOf(normalizeReaction(r.emoji) as (typeof EMOJI)[number])
    if (i < 0) return
    if (r.added) ix.state.votes[r.userKey] = i
    else if (ix.state.votes[r.userKey] === i) delete ix.state.votes[r.userKey]
    else return
    return render(ix)
  },
  onButton(ix, args, ctx) {
    const i = Number(args[0]?.replace(/,/g, "")) - 1
    if (i !== 0 && i !== 1) return {reply: "Pick option 1 or 2."}
    const key = ctx.sender.key
    if (ix.state.votes[key] === i) delete ix.state.votes[key]
    else ix.state.votes[key] = i
    return {text: render(ix), ack: "👍"}
  },
})

export default defineCommand({
  name: "wyr",
  aliases: ["wouldyourather"],
  description: "Would you rather? Vote for one of two choices",
  details: "Give two options separated by |, or leave it blank for a random question. One vote per person; changing your reaction or tapping the other option changes your vote.",
  category: "Fun",
  args: [{name: "options", type: "text", description: "Option A | option B"}],
  examples: ["wyr", "wyr Explore space | Explore the ocean"],
  cooldown: 10,
  async run(ctx) {
    let options: [string, string]
    if (!ctx.args.options) {
      options = [...PROMPTS[randomInt(PROMPTS.length)]!] as [string, string]
    } else {
      const parts = ctx.args.options.split("|").map((s) => s.trim())
      if (parts.length !== 2 || !parts[0] || !parts[1]) return ctx.usageError("Give exactly two options separated by |, or leave it blank for a random question.")
      options = [fmt.truncate(parts[0], 100), fmt.truncate(parts[1], 100)]
    }
    const state: WyrState = {
      options,
      votes: {},
      ownerName: ctx.sender.displayName,
      prefix: ctx.config.prefix,
      tappable: ctx.ui.tappable,
    }
    const msg = await ctx.send(`🤔 ${fmt.bold("Would you rather…")}`)
    const ix = ctx.rt.interactions.create("wyr", msg, state, {ownerKey: ctx.sender.key, ttlMs: 30 * 86_400_000})
    for (const emoji of EMOJI) {
      try {
        await msg.react(emoji)
      } catch (err) {
        ctx.log.debug(`wyr: can't add reaction ${emoji}: ${describeError(err)}`)
        state.reactionsOff = true
        break
      }
    }
    await msg.edit(render(ix))
    ctx.rt.interactions.save(ix)
  },
})
