import {defineCommand} from "../../../src/sdk"
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
    const id = ctx.args.id.toLowerCase()
    const ix = ctx.rt.interactions.get<PollState>(id)
    if (!ix || ix.kind !== "poll") return ctx.fail("No open poll with that id.")
    await ctx.rt.interactions.closeOwned<PollState>(id, ctx, (current) => {
      current.state.closed = true
      return renderPoll(current)
    })
    await ctx.react("✅")
  },
})
