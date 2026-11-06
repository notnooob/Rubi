/**
 * TEMPLATE — not loaded (files and folders starting with "_" are skipped), but type-checked.
 * Copy to data/commands/<name>.ts (or data/commands/<category>/<name>.ts) and edit.
 *
 * Shows every option. Delete what you don't need — only name, description and run are required.
 */
import {defineCommand, fmt, T} from "../../src/sdk"

export default defineCommand({
  name: "example", // keyword: /example
  aliases: ["ex"], // also /ex
  description: "One line for /help and the app menu",
  details: "Longer text for /help example.",
  category: "Utility", // default: subfolder name, or "General"

  // Typed args → ctx.args.target: T.GroupMember, ctx.args.times: number | undefined, ctx.args.note: string | undefined
  args: [
    {name: "target", type: "member", description: "Who to poke", required: true},
    {name: "times", type: "integer", description: "How many times", min: 1, max: 5},
    {name: "note", type: "text", description: "Optional note (rest of the message)"},
  ],
  examples: ["example @alice 3 hello there"],

  scope: "group", // "any" | "direct" | "group"
  permission: "admin", // "everyone" | "moderator" | "admin" | "owner" | "botAdmin"
  botRole: T.GroupMemberRole.Member, // the bot's own minimum role in the group
  cooldown: 5, // seconds, per user
  timeout: 60, // seconds; ctx.signal aborts after this
  hidden: false, // hide from /help and the menu
  live: true, // post "⏳ Working on /example" instantly; the reply replaces it (no "…": the apps animate dots after live messages)

  async run(ctx) {
    const {target, times = 1, note} = ctx.args

    for (let i = 1; i <= times; i++) {
      ctx.progress(`👉 Poking ${target.memberProfile.displayName} (${i}/${times})`) // updates the live placeholder
      await new Promise((r) => setTimeout(r, 1000))
      if (ctx.signal.aborted) return
    }

    // Returning a string replies (here: finalizes the live placeholder). ctx.mention() makes a real @mention.
    return fmt.lines(`✅ Poked ${ctx.mention(target)} ${fmt.plural(times, "time")}.`, note && fmt.italic(note))

    // Other tools:
    //   await ctx.reply("text")              reply (or finalize the placeholder)
    //   await ctx.send("text")               message without quoting
    //   const m = await ctx.live("…")        extra live message → m.update("…"), await m.finish("done")
    //   await ctx.react("👍")                react to the command message
    //   return ctx.fail("nope")              user-facing ❌ error (`return` lets TypeScript narrow types after it)
    //   ctx.usageError("bad input")          ❌ error + usage hint
    //   ctx.isGroup / ctx.isDirect / ctx.isBusiness / ctx.group / ctx.contact
    //   ctx.sender.role / ctx.isGroupAdmin / ctx.hasRole(T.GroupMemberRole.Moderator) / ctx.isBotAdmin
    //   await ctx.members() / ctx.botHasRole(T.GroupMemberRole.Admin)
    //   ctx.chat.api*(...)                   any simplex-chat API call (see docs/api.Class.ChatApi.md)
  },
})
