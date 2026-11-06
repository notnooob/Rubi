#!/usr/bin/env node
// Mirrors the official SimpleX Chat bot docs into ./docs
//
//   docs/             <- packages/simplex-chat-nodejs/docs   (TypeDoc reference for the `simplex-chat` npm package)
//   docs/PACKAGE_README.md <- packages/simplex-chat-nodejs/README.md (usage guide)
//   docs/bot-api/     <- bots/README.md + bots/api/*.md       (chat core bot API: commands, events, types)
//   docs/INDEX.md     <- generated table of contents
//
// Usage: npm run docs:sync            (default ref: "stable")
//        npm run docs:sync -- --ref=master
// Set GITHUB_TOKEN to avoid GitHub API rate limits.
import {mkdir, writeFile, rm} from "node:fs/promises"
import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"

const REPO = "simplex-chat/simplex-chat"
const ref = process.argv.find((a) => a.startsWith("--ref="))?.slice(6) ?? "stable"
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(root, "docs")

const ua = {"User-Agent": "rubi-docs-sync"}
const apiHeaders = {...ua, Accept: "application/vnd.github+json"}
if (process.env.GITHUB_TOKEN) apiHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const raw = (path) => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`

async function get(url, headers, as = "text") {
  const r = await fetch(url, {headers})
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${r.statusText}`)
  return as === "json" ? r.json() : r.text()
}

async function listMarkdown(dir) {
  const listing = await get(`https://api.github.com/repos/${REPO}/contents/${dir}?ref=${ref}`, apiHeaders, "json")
  return listing.filter((f) => f.type === "file" && f.name.endsWith(".md")).map((f) => f.path)
}

async function download(jobs) {
  const queue = [...jobs]
  await Promise.all(
    Array.from({length: 8}, async () => {
      for (let job; (job = queue.shift()); ) {
        await writeFile(job.dest, await get(raw(job.src), ua))
      }
    })
  )
}

async function main() {
  // fresh mirror every time, so removed upstream files disappear
  await rm(outDir, {recursive: true, force: true})
  await mkdir(join(outDir, "bot-api"), {recursive: true})

  const pkgDocs = await listMarkdown("packages/simplex-chat-nodejs/docs")
  const botApiDocs = await listMarkdown("bots/api")
  const name = (p) => p.split("/").pop()

  const jobs = [
    ...pkgDocs.map((src) => ({src, dest: join(outDir, name(src))})),
    {src: "packages/simplex-chat-nodejs/README.md", dest: join(outDir, "PACKAGE_README.md")},
    {src: "bots/README.md", dest: join(outDir, "bot-api", "BOTS_README.md")},
    ...botApiDocs.map((src) => ({src, dest: join(outDir, "bot-api", name(src))})),
  ]
  await download(jobs)

  const groups = {}
  for (const n of pkgDocs.map(name)) {
    const ns = n.split(".")[0]
    const key = n === "README.md" || ns === "Namespace" ? "_top" : ns
    ;(groups[key] ??= []).push(n)
  }
  const lines = [
    "# SimpleX Chat bot docs (mirrored)",
    "",
    `Synced from \`${REPO}\` @ \`${ref}\` on ${new Date().toISOString()}.`,
    "Re-sync with `npm run docs:sync`. Do not hand-edit files in this folder — they are overwritten.",
    "",
    "## Start here",
    "",
    "- [PACKAGE_README.md](PACKAGE_README.md) — `simplex-chat` npm package guide (install, quick start, Postgres)",
    "- [README.md](README.md) — TypeDoc root for the npm package",
    "- [bot-api/BOTS_README.md](bot-api/BOTS_README.md) — how SimpleX bots work (chat core concepts)",
    "",
    "## Chat core bot API (what the npm package wraps)",
    "",
    "- [bot-api/COMMANDS.md](bot-api/COMMANDS.md) — every chat command, its params and responses",
    "- [bot-api/EVENTS.md](bot-api/EVENTS.md) — every event emitted by chat core",
    "- [bot-api/TYPES.md](bot-api/TYPES.md) — every type (ChatItem, GroupMember, MsgContent, ...)",
    ...botApiDocs.map(name).filter((n) => !["COMMANDS.md", "EVENTS.md", "TYPES.md"].includes(n)).map((n) => `- [bot-api/${n}](bot-api/${n})`),
    "",
    "## npm package namespaces",
    "",
    ...(groups._top ?? []).filter((n) => n !== "README.md").sort().map((n) => `- [${n}](${n})`),
    "",
  ]
  for (const ns of Object.keys(groups).filter((k) => k !== "_top").sort()) {
    lines.push(`### ${ns}`, "", ...groups[ns].sort().map((n) => `- [${n}](${n})`), "")
  }
  await writeFile(join(outDir, "INDEX.md"), lines.join("\n"))
  console.log(`Synced ${jobs.length} files into ${outDir} (ref: ${ref})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
