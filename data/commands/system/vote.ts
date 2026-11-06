import {defineCommand} from "../../../src/sdk"

/** Button handler: /vote <id> <choice…> — routes taps on poll/trivia/… buttons to their interaction. */
export default defineCommand({
  name: "vote",
  description: "Answer a poll or quiz button",
  category: "System",
  hidden: true,
  menu: false,
  cooldown: 0,
  args: [
    {name: "id", type: "string", description: "Interaction id (from the button)", required: true},
    {name: "choice", type: "text", description: "Your choice"},
  ],
  async run(ctx) {
    const args = (ctx.args.choice ?? "").split(/\s+/).filter(Boolean)
    return (await ctx.rt.interactions.button(ctx.args.id.toLowerCase(), args, ctx)) ?? undefined
  },
})
