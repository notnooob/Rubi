import {defineCommand} from "../../../src/sdk"

/** Button handler for paginated lists: /page <id> <n>. */
export default defineCommand({
  name: "page",
  description: "Show another page of a list",
  category: "System",
  hidden: true,
  menu: false,
  cooldown: 0,
  args: [
    {name: "id", type: "string", description: "List id (from the button)", required: true},
    {name: "n", type: "integer", description: "Page number", required: true, min: 1},
  ],
  run(ctx) {
    const set = ctx.rt.pages.get(ctx.args.id.toLowerCase(), ctx.ref)
    if (!set) return ctx.fail("That list has expired — run the command again.")
    return ctx.rt.pages.render(set, ctx.args.n)
  },
})
