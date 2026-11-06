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
  run: () => "🤷 There's nothing to cancel.",
})
