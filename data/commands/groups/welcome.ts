import {defineCommand, fmt} from "../../../src/sdk"

export function renderWelcome(template: string, name: string, group: string): string {
  return template.replace(/\{name\}/gi, fmt.mention(name)).replace(/\{group\}/gi, group)
}

/** The member has left, so {name} is bold instead of an @mention. */
export function renderGoodbye(template: string, name: string, group: string): string {
  return template.replace(/\{name\}/gi, fmt.bold(name)).replace(/\{group\}/gi, group)
}

export default defineCommand({
  name: "welcome",
  description: "Greet new members (admins: /welcome set Hi {name}!)",
  details:
    "{name} becomes an @mention of the new member and {group} the group name. /welcome off disables it, /welcome test previews it. " +
    "/welcome goodbye <text> says goodbye to members who leave on their own ({name} in bold, {group}); /welcome goodbye off turns it off.",
  category: "Groups",
  scope: "group",
  permission: "admin",
  args: [
    {name: "action", type: "string", description: "set, off, test or goodbye", choices: ["set", "off", "test", "goodbye"]},
    {name: "text", type: "text", description: "Welcome message (for set), or the goodbye message"},
  ],
  examples: ["welcome set Welcome {name}! Read /rules please 🙂", "welcome test", "welcome off", "welcome goodbye Bye {name}, thanks for stopping by!", "welcome goodbye off"],
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
    if (action === "goodbye") {
      if (!text) {
        const {goodbye} = await ctx.groupData.get()
        return goodbye
          ? fmt.lines("👋 Current goodbye message:", "", goodbye)
          : `👋 No goodbye message. Set one: ${ctx.ui.cmd("welcome", "goodbye Bye {name}!")}`
      }
      if (text.trim().toLowerCase() === "off") {
        await ctx.groupData.update((s) => {
          delete s.goodbye
        })
        return "🔕 No goodbye messages."
      }
      await ctx.groupData.update((s) => {
        s.goodbye = text.slice(0, 1000)
      })
      return fmt.lines("✅ Goodbye message saved. Preview:", "", renderGoodbye(text, ctx.sender.displayName, group))
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
