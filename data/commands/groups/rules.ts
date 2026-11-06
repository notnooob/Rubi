import {defineCommand, fmt, PermissionError} from "../../../src/sdk"

export default defineCommand({
  name: "rules",
  description: "Show the group rules (admins: /rules set …, /rules clear)",
  category: "Groups",
  scope: "group",
  args: [
    {name: "action", type: "string", description: "set or clear (admins)", choices: ["set", "clear"]},
    {name: "text", type: "text", description: "The rules (for set)"},
  ],
  examples: ["rules", "rules set 1. Be kind. 2. No spam."],
  async run(ctx) {
    const {action, text} = ctx.args
    const name = ctx.group!.groupProfile.displayName
    if (action) {
      if (!ctx.can("admin")) throw new PermissionError("Only group admins can change the rules.")
      if (action === "set") {
        if (!text) return ctx.usageError("Write the rules after /rules set.")
        await ctx.groupData.update((s) => {
          s.rules = text.slice(0, 3000)
        })
        return `✅ Rules saved. Members can read them with ${ctx.ui.cmd("rules")}.`
      }
      await ctx.groupData.update((s) => {
        delete s.rules
      })
      return "🗑 Rules cleared."
    }
    const {rules} = await ctx.groupData.get()
    if (!rules) {
      return ctx.can("admin")
        ? `📜 No rules yet. Set them: ${ctx.ui.cmd("rules", "set <rules>")}`
        : "📜 This group has no rules set yet."
    }
    return `📜 ${fmt.bold(`Rules of ${name}`)}\n\n${rules}`
  },
})
