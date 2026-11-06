import {defineCommand, fmt} from "../../../src/sdk"

export default defineCommand({
  name: "reload",
  description: "Reload command files and the app menu (no restart)",
  details: "Picks up edited/new files in data/commands. Event handlers and src/ changes still need a restart.",
  category: "Admin",
  permission: "botAdmin",
  live: "♻️ Reloading commands",
  async run(ctx) {
    const {loaded, errors} = await ctx.rt.reloadCommands()
    return fmt.lines(
      `♻️ Reloaded ${fmt.bold(fmt.plural(loaded, "command"))}.`,
      errors.length ? `\n⚠️ ${fmt.bold(`${errors.length} failed:`)}\n${fmt.codeBlock(errors.join("\n"))}` : undefined
    )
  },
})
