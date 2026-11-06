import {defineCommand, fmt} from "../../../src/sdk"

export function renderWelcome(template: string, name: string, group: string): string {
  return template.replace(/\{name\}/gi, fmt.mention(name)).replace(/\{group\}/gi, group)
}

export default defineCommand({
  name: "welcome",
  description: "Greet new members (admins: /welcome set Hi {name}!)",
  details: "{name} becomes an @mention of the new member and {group} the group name. /welcome off disables it, /welcome test previews it.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [
    {name: "action", type: "string", description: "set, off or test", choices: ["set", "off", "test"]},
    {name: "text", type: "text", description: "Welcome message (for set)"},
  ],
  examples: ["welcome set Welcome {name}! Read /rules please 🙂", "welcome test", "welcome off"],
  async run(ctx) {
    const {action, text} = ctx.args
    const group = ctx.group!.groupProfile.displayName
    if (action === "set") {
      if (!text) return ctx.usageError("Write the message after /welcome set — use {name} for the new member.")
      await ctx.groupData.update((s) => {
        s.welcome = text.slice(0, 2000)
      })
      return fmt.lines("✅ Welcome message saved. Preview:", "", renderWelcome(text, ctx.sender.displayName, group))
    }
    if (action === "off") {
      await ctx.groupData.update((s) => {
        delete s.welcome
      })
      return "🔕 New members won't be greeted."
    }
    const {welcome} = await ctx.groupData.get()
    if (action === "test") {
      if (!welcome) return ctx.fail("No welcome message set.")
      return renderWelcome(welcome, ctx.sender.displayName, group)
    }
    return welcome
      ? fmt.lines("👋 Current welcome message:", "", welcome, ctx.ui.tappable ? "\n" + ctx.ui.buttons([ctx.ui.button("🧪", "welcome", "test"), ctx.ui.button("🔕", "welcome", "off")]) : undefined)
      : `👋 No welcome message. Set one: ${ctx.ui.cmd("welcome", "set Hi {name}!")}`
  },
})
