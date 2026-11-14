import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {T} from "@simplex-chat/types"
import {defineCommand} from "../src/core/command"
import {dm, groupMsg, makeHarness, settle} from "./helpers/fake"

describe("registry", () => {
  it("loads data/commands (skipping _template) and builds the app menu", () => {
    const {rt} = makeHarness()
    assert.ok(rt.commands.get("help"))
    assert.ok(rt.commands.get("H"), "aliases are case-insensitive")
    assert.equal(rt.commands.get("example"), undefined, "_template.ts must not load")
    const flat = (items: T.ChatBotCommand[]): T.ChatBotCommand[] => items.flatMap((m) => (m.type === "menu" ? flat(m.commands) : [m]))
    const menu = flat(rt.commands.menu())
    assert.ok(rt.commands.menu().some((m) => m.type === "menu"), "many commands → category submenus")
    const keywords = menu.map((m) => (m.type === "command" ? m.keyword : ""))
    for (const k of ["vote", "page", "confirm", "kick", "reload", "rules"]) assert.ok(!keywords.includes(k), `/${k} stays out of the DM menu`)
    assert.deepEqual(menu.find((m) => m.type === "command" && m.keyword === "help"), {
      type: "command",
      keyword: "help",
      label: "List commands, or show details for one",
    })
  })
  it("rejects keyword clashes", () => {
    const {rt} = makeHarness()
    assert.throws(() => rt.commands.register(defineCommand({name: "x", aliases: ["help"], description: "d", run: () => "x"})), /already used/)
  })
})

describe("/help", () => {
  it("lists categories and commands in a DM (tappable), quoting the request", async () => {
    const h = makeHarness()
    const item = dm("/help")
    await h.receive(item)
    const s = h.chat.last()!
    assert.equal(s.kind, "send")
    assert.equal(s.ref, "@7")
    assert.equal(s.quote, item.chatItem.meta.itemId)
    assert.match(s.text!, /\*Rubi\* — commands/)
    assert.match(s.text!, /📖 \*General\* · \/'help general'\n\/about {2}\/help {2}\/invite/)
    assert.match(s.text!, /🌐 \*Web\* · \/'help web'/)
    assert.doesNotMatch(s.text!, /`/, "no code formatting in DMs — commands are tappable there")
  })

  it("shows categories with descriptions, command details and suggestions", async () => {
    const h = makeHarness()
    await h.receive(dm("/help help"))
    assert.match(h.chat.last()!.text!, /\*Usage:\* `\/help \[command\]`/)
    assert.match(h.chat.last()!.text!, /\*Aliases:\* `\/h`, `\/commands`, `\/start`/)
    await h.receive(dm("/help hepl", {contactId: 11}))
    assert.match(h.chat.last()!.text!, /Did you mean \/'help help'\?/)
    await h.receive(dm("/help general", {contactId: 12}))
    assert.match(h.chat.last()!.text!, /📖 \*General\* — _Basics and bot info_/)
    assert.match(h.chat.last()!.text!, /\/help — List commands, or show details for one/)
  })

  it("renders commands as code in groups without a command menu", async () => {
    const h = makeHarness()
    await h.receive(groupMsg("/help"))
    let text = h.chat.last()!.text!
    assert.doesNotMatch(text, /\/'/, "no /'quoted' commands where they can't be tapped")
    assert.match(text, /📖 \*General\* · `\/help general`\n`\/about` `\/help` `\/invite`/)
    await h.receive(groupMsg("/help remind", {memberId: 3}))
    text = h.chat.last()!.text!
    assert.doesNotMatch(text, /\/'/)
    assert.match(text, /\*Examples:\* `\/remind 10m stretch`/)
    // owners get a tip about /groupmenu; with a menu, commands are tappable again
    await h.receive(groupMsg("/help", {role: T.GroupMemberRole.Owner, memberId: 4}))
    assert.match(h.chat.last()!.text!, /make me a group owner and send_ `\/groupmenu` _to make/)
    await h.receive(groupMsg("/help", {menu: true, memberId: 5}))
    assert.match(h.chat.last()!.text!, /📖 \*General\* · \/'help general'/)
  })

  it("hides commands the sender can't use, and says so", async () => {
    const h = makeHarness()
    h.rt.commands.register(defineCommand({name: "zkick", description: "Remove a member", category: "Moderation", scope: "group", permission: "admin", run: () => "ok"}))
    await h.receive(groupMsg("/help", {role: T.GroupMemberRole.Member}))
    let text = h.chat.last()!.text!
    assert.doesNotMatch(text, /\/zkick/)
    assert.match(text, /more need a group role/)
    assert.match(text, /You're a \*member\* in \*Club\*/)

    await h.receive(groupMsg("/help moderation", {role: T.GroupMemberRole.Admin, memberId: 4}))
    text = h.chat.last()!.text!
    assert.match(text, /🛡 \*Moderation\*/)
    assert.match(text, /`\/zkick` — Remove a member · _group admins_/)
  })
})

describe("dispatcher", () => {
  it("suggests close matches for unknown commands in DMs only", async () => {
    const h = makeHarness()
    await h.receive(dm("/hepl"))
    assert.match(h.chat.last()!.text!, /Did you mean \/help\?/)
    const before = h.chat.sent.length
    await h.receive(groupMsg("/hepl"))
    assert.equal(h.chat.sent.length, before, "no reply to unknown commands in groups by default")
  })

  it("hints on plain DMs and on @mentions in groups", async () => {
    const h = makeHarness()
    await h.receive(dm("hello there"))
    assert.match(h.chat.last()!.text!, /I only understand commands/)
    await h.receive(groupMsg("hey @Rubi", {mention: true}))
    assert.match(h.chat.last()!.text!, /Hi! Send `\/help`/, "groups without a menu: code, not a tappable command")
  })

  it("ignores replies to its messages (chat core flags them as mentions) and can turn the hint off", async () => {
    let h = makeHarness()
    await h.receive(groupMsg("nice answer, thanks", {replyToBot: true}))
    assert.equal(h.chat.sent.length, 0, "a reply to Rubi is not a mention")
    h = makeHarness((c) => (c.replies.mentionHintInGroups = false))
    await h.receive(groupMsg("hey @Rubi", {mention: true}))
    assert.equal(h.chat.sent.length, 0, "RUBI_MENTION_HINT=false")
  })

  it("limits admin commands to group admins", async () => {
    const h = makeHarness()
    let ran = 0
    h.rt.commands.register(defineCommand({name: "wipeall", description: "d", permission: "admin", run: () => (ran++, "wiped")}))

    await h.receive(groupMsg("/wipeall", {role: T.GroupMemberRole.Moderator}))
    assert.match(h.chat.last()!.text!, /^🔒 \/wipeall is only for group admins\./)
    await h.receive(dm("/wipeall"))
    assert.match(h.chat.last()!.text!, /use it in a group where you have that role/)
    await h.receive(groupMsg("/wipeall", {role: T.GroupMemberRole.Owner}))
    assert.equal(h.chat.last()!.text, "wiped")
    await h.receive(dm("/wipeall", {contactId: 99}))
    assert.equal(h.chat.last()!.text, "wiped", "bot admins bypass role checks")
    assert.equal(ran, 2)
  })

  it("checks scope and the bot's own role", async () => {
    const h = makeHarness()
    h.rt.commands.register(defineCommand({name: "ban", description: "d", scope: "group", botRole: T.GroupMemberRole.Admin, run: () => "banned"}))
    await h.receive(dm("/ban"))
    assert.match(h.chat.last()!.text!, /^🚫 \/ban only works in groups\./)
    await h.receive(groupMsg("/ban", {botRole: T.GroupMemberRole.Member}))
    assert.match(h.chat.last()!.text!, /I need to be a group \*admin\*/)
    await h.receive(groupMsg("/ban", {botRole: T.GroupMemberRole.Admin}))
    assert.equal(h.chat.last()!.text, "banned")
  })

  it("sends a live placeholder and edits it into the result", async () => {
    const h = makeHarness()
    h.rt.commands.register(
      defineCommand({
        name: "slow",
        description: "d",
        live: true,
        async run(ctx) {
          await new Promise((r) => setTimeout(r, 30))
          ctx.progress("halfway")
          await new Promise((r) => setTimeout(r, 30))
          return "finished!"
        },
      })
    )
    await h.receive(dm("/slow"))
    const [first, ...rest] = h.chat.sent
    assert.equal(first!.kind, "send")
    assert.equal(first!.live, true)
    assert.equal(first!.text, "⏳ Working on /slow", "no trailing … — the apps animate dots after live messages")
    assert.ok(rest.some((s) => s.kind === "update" && s.live && s.text === "halfway"), "progress edit stays live")
    const last = h.chat.last()!
    assert.deepEqual([last.kind, last.itemId, last.live, last.text], ["update", first!.itemId, false, "finished!"])
  })

  it("reports usage errors with the usage line", async () => {
    const h = makeHarness()
    h.rt.commands.register(
      defineCommand({name: "zroll", description: "d", args: [{name: "sides", type: "integer", description: "", required: true, min: 2}], run: (ctx) => `${ctx.args.sides}`})
    )
    await h.receive(dm("/zroll 1"))
    const text = h.chat.last()!.text!
    assert.match(text, /^❌ <sides> must be at least 2\./)
    assert.match(text, /\*Usage:\* `\/zroll <sides>`/)
    await h.receive(dm("/zroll 6"))
    assert.equal(h.chat.last()!.text, "6")
  })

  it("turns crashes into a reference id (details only for bot admins)", async () => {
    const h = makeHarness()
    h.rt.commands.register(defineCommand({name: "boom", description: "d", live: "loading…", run: () => {
      throw new Error("kaboom")
    }}))
    await h.receive(dm("/boom"))
    let last = h.chat.last()!
    assert.equal(last.kind, "update", "error replaces the live placeholder")
    assert.equal(last.live, false)
    assert.match(last.text!, /^💥 Something went wrong while running \/boom/)
    assert.match(last.text!, /Error ref: [0-9A-F]{6}/)
    assert.doesNotMatch(last.text!, /kaboom/)
    await h.receive(dm("/boom", {contactId: 99}))
    last = h.chat.last()!
    assert.match(last.text!, /kaboom/)
    assert.equal(h.rt.stats.commandsFailed, 2)
  })

  it("times out slow commands and aborts their signal", async () => {
    const h = makeHarness()
    let aborted = false
    h.rt.commands.register(
      defineCommand({
        name: "hang",
        description: "d",
        timeout: 0.05,
        run: (ctx) =>
          new Promise((resolve) => {
            ctx.signal.addEventListener("abort", () => ((aborted = true), resolve(undefined)))
          }),
      })
    )
    await h.receive(dm("/hang"))
    assert.match(h.chat.last()!.text!, /^⌛ \/hang took too long/)
    assert.ok(aborted)
  })

  it("applies per-user cooldowns", async () => {
    const h = makeHarness()
    h.rt.commands.register(defineCommand({name: "zping", description: "d", cooldown: 30, run: () => "pong"}))
    await h.receive(dm("/zping"))
    assert.equal(h.chat.last()!.text, "pong")
    await h.receive(dm("/zping"))
    assert.match(h.chat.last()!.text!, /^⏱ Slow down! You can use \/zping again in \d+s\./)
    await h.receive(dm("/zping", {contactId: 8}))
    assert.equal(h.chat.last()!.text, "pong", "other users are not affected")
  })

  it("waits for a user's live message to be finalized", async () => {
    const h = makeHarness()
    const item = dm("/help", {live: true})
    await h.receive(item)
    assert.equal(h.chat.sent.length, 0)
    ;(item.chatItem.meta as any).itemLive = false
    h.dispatcher.onChatItemUpdated({type: "chatItemUpdated", user: h.rt.user, chatItem: item})
    await settle(h.dispatcher)
    assert.match(h.chat.last()!.text!, /commands/)
  })

  it("resolves @mentions to members and replies with a real mention", async () => {
    const h = makeHarness()
    h.chat.members = [
      {groupMemberId: 3, memberRole: "member", memberStatus: "connected", memberProfile: {displayName: "Jo Do"}, localDisplayName: "Jo_Do"} as any,
    ]
    h.rt.commands.register(
      defineCommand({
        name: "zwho",
        description: "d",
        args: [{name: "m", type: "member", description: "", required: true}],
        run: (ctx) => `${ctx.mention(ctx.args.m)} is #${ctx.args.m.groupMemberId}`,
      })
    )
    await h.receive(groupMsg("/zwho @'Jo Do'"))
    assert.equal(h.chat.last()!.text, "@'Jo Do' is #3")
    await h.receive(groupMsg("/zwho nobody"))
    assert.match(h.chat.last()!.text!, /No member named "nobody"/)
  })
})

describe("missed commands", () => {
  const sentBeforeStart = (item: ReturnType<typeof dm>) => {
    item.chatItem.meta.itemTs = new Date(Date.now() - 60_000).toISOString()
    return item
  }

  it("ignores commands sent while the bot was offline, unless configured", async () => {
    const h = makeHarness()
    await h.receive(sentBeforeStart(dm("/ping")))
    assert.equal(h.chat.sent.length, 0)

    const late = makeHarness((cfg) => (cfg.replies.skipMissedCommands = false))
    await late.receive(sentBeforeStart(dm("/ping")))
    assert.ok(late.chat.sent.length > 0)
  })
})
