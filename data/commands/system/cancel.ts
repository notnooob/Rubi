import {defineCommand} from "../../../src/sdk"

/**
 * /cancel is normally consumed by a command waiting in ctx.confirm() / ctx.awaitReply().
 * This only runs when nothing is waiting.
 */
export default defineCommand({
  name: "cancel",
  aliases: ["no"],
  description: "Cancel a pending action",
  category: "System",
  hidden: true,
  menu: false,
  cooldown: 0,
  args: [{name: "id", type: "string", description: "Interaction id", required: false}],
  async run(ctx) {
    if (ctx.args.id) return (await ctx.rt.interactions.cancel(ctx.args.id.toLowerCase(), ctx)) ?? "✅ Cancelled."
    return "🤷 There's nothing to cancel."
  },
})
