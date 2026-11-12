import assert from "node:assert/strict"
import {existsSync, mkdtempSync, readFileSync} from "node:fs"
import {tmpdir} from "node:os"
import path from "node:path"
import {describe, it} from "node:test"
import {GUIDE_FILE, renderCommandReference} from "../scripts/make-guide"

describe("guide", () => {
  it("guide/commands.md matches the commands (run `npm run guide` after changing one)", () => {
    assert.equal(readFileSync(GUIDE_FILE, "utf8").replace(/\r\n/g, "\n"), renderCommandReference())
  })
})

describe("wiki", () => {
  it("builds a page for every guide file, with wiki links instead of .md links", async () => {
    const {buildWiki, PAGES} = await import("../scripts/build-wiki.mjs")
    const dir = mkdtempSync(path.join(tmpdir(), "rubi-wiki-"))
    buildWiki(dir, "https://github.com/example/rubi")
    const pages = Object.values(PAGES) as string[]
    for (const page of [...pages, "_Sidebar", "_Footer"]) assert.ok(existsSync(path.join(dir, `${page}.md`)), page)
    for (const page of pages) {
      const text = readFileSync(path.join(dir, `${page}.md`), "utf8")
      assert.doesNotMatch(text, /\]\((?!https?:|#)[^)]*\.md[)#]/, `${page} still links to a .md file`)
    }
    assert.match(readFileSync(path.join(dir, "Home.md"), "utf8"), /\]\(Group-Admin-Guide\)/)
    assert.doesNotMatch(readFileSync(path.join(dir, "Using-Rubi.md"), "utf8"), /^# /, "the wiki shows the page title itself")
  })

  it("makes heading anchors the way GitHub does", async () => {
    const {slug} = await import("../scripts/build-wiki.mjs")
    assert.equal(slug("Roles: yours and Rubi's"), "roles-yours-and-rubis")
    assert.equal(slug("🛠 Utility"), "-utility")
    assert.equal(slug("`/remind`"), "remind")
    assert.equal(slug("What's public and what stays private"), "whats-public-and-what-stays-private")
  })
})
