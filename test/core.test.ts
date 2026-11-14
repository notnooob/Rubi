import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {parseArgs, tokenize, usageParams} from "../src/core/args"
import {parseCommand} from "../src/core/dispatcher"
import {splitText, fitText} from "../src/core/messages"
import {roleAtLeast} from "../src/core/permissions"
import {T} from "@simplex-chat/types"
import * as fmt from "../src/util/format"
import {loadConfig, MAX_AVATAR_DATA_URI} from "../src/config"
import {botMenuBudget, groupMenuBudget, MAX_INFO_BYTES} from "../src/core/profile"
import {CommandRegistry} from "../src/core/registry"
import {createLogger, setLogLevel} from "../src/core/logger"
import {COMMANDS_DIR} from "../src/paths"
import {ChatData} from "../src/core/data"
import {FakeChat} from "./helpers/fake"

const noMembers = async (): Promise<never> => {
  throw new Error("no members")
}

describe("parseCommand", () => {
  it("parses keyword and args", () => {
    assert.deepEqual(parseCommand("/help"), {keyword: "help", rawArgs: ""})
    assert.deepEqual(parseCommand("  /Help   ping  "), {keyword: "help", rawArgs: "ping"})
    assert.deepEqual(parseCommand("/say hello\nworld"), {keyword: "say", rawArgs: "hello\nworld"})
  })
  it("unwraps the tappable /'cmd args' form", () => {
    assert.deepEqual(parseCommand("/'help ping'"), {keyword: "help", rawArgs: "ping"})
  })
  it("ignores non-commands", () => {
    for (const t of ["hello", "/", "/ hi", "/path/to/file", "//", "a /help"]) assert.equal(parseCommand(t), undefined, t)
  })
})

describe("args", () => {
  it("tokenizes quotes and quoted mentions", () => {
    assert.deepEqual(
      tokenize(`a "b c" @'Jo Do' 'it\\'s' d`).map((t) => t.value),
      ["a", "b c", "@Jo Do", "it's", "d"]
    )
    assert.throws(() => tokenize(`"open`), /Unclosed quote/)
  })
  it("parses typed args", async () => {
    const defs = [
      {name: "n", type: "integer", description: "", required: true, min: 1, max: 10},
      {name: "mode", type: "string", description: "", choices: ["on", "off"]},
      {name: "rest", type: "text", description: ""},
    ] as const
    assert.deepEqual(await parseArgs(defs, "3 ON  the rest  here", noMembers), {n: 3, mode: "on", rest: "the rest  here"})
    assert.deepEqual(await parseArgs(defs, "3", noMembers), {n: 3})
    await assert.rejects(parseArgs(defs, "", noMembers), /Missing <n>/)
    await assert.rejects(parseArgs(defs, "x", noMembers), /whole number/)
    await assert.rejects(parseArgs(defs, "11", noMembers), /at most 10/)
    await assert.rejects(parseArgs(defs, "1 maybe", noMembers), /one of: on, off/)
  })
  it("accepts commas in integer and number arguments", async () => {
    const defs = [
      {name: "whole", type: "integer", description: "", required: true},
      {name: "decimal", type: "number", description: "", required: true},
    ] as const
    assert.deepEqual(await parseArgs(defs, "1,000 1,234.5", noMembers), {whole: 1000, decimal: 1234.5})
    await assert.rejects(parseArgs(defs, "1,000x 2", noMembers), /whole number/)
  })
  it("rejects extra args and parses booleans", async () => {
    const defs = [{name: "flag", type: "boolean", description: ""}] as const
    assert.deepEqual(await parseArgs(defs, "off", noMembers), {flag: false})
    await assert.rejects(parseArgs(defs, "yes no", noMembers), /Too many arguments/)
  })
  it("renders usage", () => {
    assert.equal(
      usageParams([
        {name: "member", type: "member", description: "", required: true},
        {name: "reason", type: "text", description: ""},
      ]),
      "<member> [reason...]"
    )
  })
})

describe("text helpers", () => {
  it("splits long text on line boundaries", () => {
    const text = Array.from({length: 100}, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n")
    const parts = splitText(text, 1000)
    assert.ok(parts.length > 1)
    assert.ok(parts.every((p) => Buffer.byteLength(p) <= 1000))
    assert.equal(parts.join("\n"), text)
  })
  it("truncates edits", () => {
    const out = fitText("é".repeat(1000), 100)
    assert.ok(Buffer.byteLength(out) <= 100)
    assert.ok(out.endsWith("(truncated)"))
  })
  it("formats SimpleX markdown", () => {
    assert.equal(fmt.bold("hi"), "*hi*")
    assert.equal(fmt.command("help"), "/help")
    assert.equal(fmt.command("help", "ping"), "/'help ping'")
    assert.equal(fmt.mention("Jo Do"), "@'Jo Do'")
    assert.equal(fmt.duration(3_725_000), "1h 2m 5s")
    assert.equal(fmt.color("red", "x"), "!1 x!")
  })
  it("keeps spaces outside markdown markers (SimpleX only formats from the start of a word)", () => {
    // "Rubi" + italic(" (me)") must read "Rubi _(me)_", not "Rubi_(me)_" (which shows the underscores)
    assert.equal(`Rubi${fmt.italic(" (me)")}`, "Rubi _(me)_")
    assert.equal(`Day${fmt.italic(" · regional")}`, "Day _· regional_")
    assert.equal(fmt.bold(" x "), " *x* ")
    assert.equal(fmt.color("green", " ok"), " !2 ok!")
    assert.equal(fmt.italic("   "), "")
  })
})

describe("config", () => {
  it("uses the data URI prefix SimpleX apps can decode (image/jpg, not image/jpeg)", () => {
    const saved = process.env.RUBI_AVATAR
    process.env.RUBI_AVATAR = "./assets/avatar.jpg"
    try {
      const image = loadConfig().profile.image ?? ""
      assert.ok(image.startsWith("data:image/jpg;base64,"), image.slice(0, 30))
      assert.ok(image.length <= MAX_AVATAR_DATA_URI, `avatar is ${image.length} chars`)
    } finally {
      if (saved === undefined) delete process.env.RUBI_AVATAR
      else process.env.RUBI_AVATAR = saved
    }
  })
})

describe("permissions", () => {
  it("orders roles", () => {
    assert.ok(roleAtLeast(T.GroupMemberRole.Owner, T.GroupMemberRole.Admin))
    assert.ok(roleAtLeast(T.GroupMemberRole.Admin, T.GroupMemberRole.Admin))
    assert.ok(!roleAtLeast(T.GroupMemberRole.Moderator, T.GroupMemberRole.Admin))
    assert.ok(!roleAtLeast(undefined, T.GroupMemberRole.Observer))
  })
})

describe("profile size budget", () => {
  const registry = () => {
    setLogLevel("error")
    const r = new CommandRegistry(COMMANDS_DIR, createLogger("test"))
    r.load()
    return r
  }
  const size = (m: unknown) => Buffer.byteLength(JSON.stringify(m))

  it("the default avatar leaves room for the full command menu (with room to grow)", () => {
    const cfg = loadConfig()
    const budget = botMenuBudget(cfg.profile, {allowFiles: false})
    const {menu, level, dropped} = registry().menuWithin({maxBytes: budget})
    assert.equal(level, "full", `menu is ${size(menu)} bytes but only ${budget} fit next to the avatar: shrink the avatar (npm run avatar)`)
    assert.equal(dropped, 0)
    assert.ok(budget - size(menu) > 800, "keep some headroom for new commands")
  })

  it("shrinks the menu step by step instead of failing", () => {
    const r = registry()
    const full = size(r.menu())
    assert.equal(r.menuWithin({maxBytes: full - 1}).level, "no-params")
    const keywords = r.menuWithin({maxBytes: 2600})
    assert.equal(keywords.level, "keywords")
    assert.ok(size(keywords.menu) <= 2600)
    const tiny = r.menuWithin({maxBytes: 600})
    assert.ok(tiny.dropped > 0 && size(tiny.menu) <= 600, "drops commands only as a last resort")
  })

  it("counts the address link and a group's own picture", () => {
    const profile = {displayName: "Rubi", fullName: ""}
    const short = botMenuBudget(profile, {allowFiles: false, contactLink: "https://smp.example/a#x"})
    assert.ok(botMenuBudget(profile, {allowFiles: false}) < short, "an unknown link reserves space")
    const plain = groupMenuBudget({displayName: "Club", fullName: ""})
    assert.equal(groupMenuBudget({displayName: "Club", fullName: "", image: "x".repeat(5000)}), plain - 5000 - Buffer.byteLength(',"image":""'))
    assert.ok(plain < MAX_INFO_BYTES)
  })
})

describe("chat settings", () => {
  it("peek reads without copying, and an update never changes an earlier snapshot", async () => {
    const data = new ChatData(new FakeChat() as any)
    const g = {groupId: 5, customData: {rubi: {filter: ["spam"]}}} as any
    const scoped = data.group(g)
    const before = scoped.peek()
    assert.equal(before, scoped.peek(), "no copy per read")
    await scoped.update((s) => {
      s.filter!.push("scam")
    })
    assert.deepEqual(before.filter, ["spam"])
    assert.deepEqual(scoped.peek().filter, ["spam", "scam"])
  })
})
