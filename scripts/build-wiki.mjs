/**
 * Turns guide/ into GitHub wiki pages: renames the files to wiki page names, rewrites links between them
 * (wiki links have no ".md"), points links into the repo at GitHub, and adds a sidebar and footer.
 *
 *   node scripts/build-wiki.mjs <wiki-checkout-dir> [repo-url]
 *
 * .github/workflows/wiki.yml runs this on every push to main that changes guide/, and pushes the result to the
 * wiki. Every .md page in the wiki checkout is replaced, so edit guide/ in the repo, not the wiki.
 */
import {execSync} from "node:child_process"
import {readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const GUIDE = path.join(ROOT, "guide")

/** guide file → wiki page name (shown with spaces: "Group-Admin-Guide" → "Group Admin Guide"). */
export const PAGES = {
  "README.md": "Home",
  "using-rubi.md": "Using-Rubi",
  "group-admins.md": "Group-Admin-Guide",
  "bot-admins.md": "Running-Rubi",
  "commands.md": "Command-Reference",
}

/** https://github.com/<owner>/<repo>, from the origin remote. */
function repoFromGit() {
  const url = execSync("git remote get-url origin", {cwd: ROOT, encoding: "utf8"}).trim()
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!m) throw new Error(`can't tell the GitHub repo from origin ${url}; pass the repo URL`)
  return `https://github.com/${m[1]}`
}

function rewriteLinks(text, file, repo) {
  return text.replace(/\]\(([^)\s]+)\)/g, (all, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return all
    const [base, hash = ""] = target.split(/(?=#)/)
    if (PAGES[base]) return `](${PAGES[base]}${hash})`
    if (base.startsWith("../")) return `](${repo}/blob/main/${base.slice(3)}${hash})`
    throw new Error(`guide/${file}: link to ${target} has no wiki page; add it to PAGES in scripts/build-wiki.mjs`)
  })
}

/** GitHub's heading anchor: lowercase, punctuation and emoji dropped, spaces to dashes ("Roles: yours" → "roles-yours"). */
export function slug(heading) {
  return heading
    .replace(/`/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-")
}

/** Anchors a page offers: its headings (repeats get -1, -2…) and explicit <a id="…"> tags. Code blocks are skipped. */
function anchorsOf(text) {
  const found = new Set()
  const seen = new Map()
  let inCode = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inCode = !inCode
    if (inCode) continue
    for (const m of line.matchAll(/<a id="([^"]+)"><\/a>/g)) found.add(m[1])
    const h = line.match(/^#{1,6} (.+)$/)
    if (!h) continue
    const base = slug(h[1])
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    found.add(n ? `${base}-${n}` : base)
  }
  return found
}

/** Every [text](Page#anchor) and [text](#anchor) must point at a page and heading that exist. */
function checkAnchors(pages) {
  const anchors = new Map([...pages].map(([page, text]) => [page, anchorsOf(text)]))
  const broken = []
  for (const [page, text] of pages) {
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue
      const [to = page, hash] = target.startsWith("#") ? [page, target.slice(1)] : target.split("#")
      if (!anchors.has(to)) broken.push(`${page}: ${target} (no page ${to})`)
      else if (hash && !anchors.get(to).has(hash)) broken.push(`${page}: ${target} (no heading #${hash} in ${to})`)
    }
  }
  if (broken.length) throw new Error(`broken wiki links:\n  ${broken.join("\n  ")}`)
}

export function buildWiki(outDir, repo = repoFromGit()) {
  const files = readdirSync(GUIDE).filter((f) => f.endsWith(".md"))
  const missing = files.filter((f) => !PAGES[f])
  if (missing.length) throw new Error(`guide/ pages without a wiki name: ${missing.join(", ")} (add them to PAGES)`)

  const pages = new Map()
  for (const file of files) {
    const text = readFileSync(path.join(GUIDE, file), "utf8").replace(/\r\n/g, "\n")
    // the wiki shows the page name as its title, so the file's own "# Title" would appear twice
    pages.set(PAGES[file], rewriteLinks(text.replace(/^# .*\n+/, ""), file, repo))
  }
  checkAnchors(pages)

  for (const f of readdirSync(outDir)) if (f.endsWith(".md")) rmSync(path.join(outDir, f))
  for (const [page, text] of pages) writeFileSync(path.join(outDir, `${page}.md`), text)
  const title = (page) => page.replace(/-/g, " ")
  writeFileSync(
    path.join(outDir, "_Sidebar.md"),
    ["**Rubi**", "", ...Object.values(PAGES).map((p) => `- [${p === "Home" ? "Home" : title(p)}](${p})`), "", `[Source on GitHub](${repo})`, ""].join("\n")
  )
  writeFileSync(
    path.join(outDir, "_Footer.md"),
    `These pages are generated from [\`guide/\`](${repo}/tree/main/guide) in the repository. Edit them there: changes made here are overwritten.\n`
  )
  return files.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [outDir, repo] = process.argv.slice(2)
  if (!outDir) {
    console.error("usage: node scripts/build-wiki.mjs <wiki-checkout-dir> [repo-url]")
    process.exit(1)
  }
  console.log(`wrote ${buildWiki(path.resolve(outDir), repo)} wiki page(s) to ${outDir}`)
}
