import {defineCommand, type Interaction} from "../../../src/sdk"
import {renderPoll, type PollState} from "./poll"

export default defineCommand({
  name: "endpoll",
  aliases: ["closepoll"],
  description: "Close a poll and show the result",
  category: "Utility",
  menu: false,
  hidden: true, // shown on the poll message itself
  cooldown: 0,
  args: [{name: "id", type: "string", description: "Poll id (from the poll message)", required: true}],
  async run(ctx) {
    const ix = ctx.rt.interactions.get<PollState>(ctx.args.id.toLowerCase()) as Interaction<PollState> | undefined
    if (!ix || ix.kind !== "poll") return ctx.fail("No open poll with that id.")
    if (ix.ownerKey !== ctx.sender.key) return ctx.fail(`Only the poll's creator (${ix.state.ownerName}) can close it.`)
    ix.state.closed = true
    ctx.rt.interactions.end(ix.id)
    await ctx.rt.messenger.update(ix.ref, ix.itemId, renderPoll(ix))
    await ctx.react("✅")
  },
})
