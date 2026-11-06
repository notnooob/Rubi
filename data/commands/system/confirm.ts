import {defineCommand} from "../../../src/sdk"

/**
 * /confirm is normally consumed by a command waiting in ctx.confirm() before it reaches the dispatcher.
 * This only runs when nothing is waiting.
 */
export default defineCommand({
  name: "confirm",
  aliases: ["yes"],
  description: "Confirm a pending action",
  category: "System",
  hidden: true,
  menu: false,
  cooldown: 0,
  run: () => "🤷 There's nothing waiting for your confirmation (it may have timed out).",
})
