#!/usr/bin/env node
// Installs/repairs the SimpleX native library for the `simplex-chat` package.
//
// Why: simplex-chat's own preinstall step (src/download-libs.js) unzips with `extract-zip`, which stops
// silently partway through on recent Node versions (seen on Node 26), leaving a truncated libsimplex.dll and no
// libsimplex.lib, so the node-gyp link step fails. This script downloads the same release zip,
// extracts it with the OS tool (tar on Windows, unzip elsewhere), then runs `npm rebuild simplex-chat`.
//
// Usage: npm run setup:native   (safe to re-run; skips the download when libs are already complete)
import {spawnSync} from "node:child_process"
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkgDir = join(root, "node_modules", "simplex-chat")
if (!existsSync(pkgDir)) fail("node_modules/simplex-chat not found — run `npm install` first.")

const downloader = readFileSync(join(pkgDir, "src", "download-libs.js"), "utf8")
const tag = downloader.match(/RELEASE_TAG\s*=\s*'([^']+)'/)?.[1] ?? fail("could not read RELEASE_TAG from simplex-chat")
const repo = downloader.match(/GITHUB_REPO\s*=\s*'([^']+)'/)?.[1] ?? "simplex-chat/simplex-chat-libs"
const backend = (process.env.SIMPLEX_BACKEND || process.env.npm_config_simplex_backend || "sqlite").toLowerCase()

const platform = {linux: "linux", darwin: "macos", win32: "windows"}[process.platform] ?? fail(`unsupported platform ${process.platform}`)
const arch = {x64: "x86_64", arm64: "aarch64"}[process.arch] ?? fail(`unsupported arch ${process.arch}`)
const required = {windows: ["libsimplex.dll", "libsimplex.lib"], linux: ["libsimplex.so"], macos: ["libsimplex.dylib"]}[platform]

const libsDir = join(pkgDir, "libs")
const stamp = `${tag}:${backend}`
const installedFile = join(libsDir, "installed.txt")
const complete =
  existsSync(installedFile) && readFileSync(installedFile, "utf8").trim() === stamp && required.every((f) => existsSync(join(libsDir, f)))

if (complete) {
  console.log(`✓ native libs ${stamp} already installed`)
} else {
  const zipName = `${repo.split("/")[1]}-${platform}-${arch}${backend === "postgres" ? "-postgres" : ""}.zip`
  const url = `https://github.com/${repo}/releases/download/${tag}/${zipName}`
  const work = mkdtempSync(join(tmpdir(), "rubi-simplex-"))
  try {
    console.log(`↓ ${url}`)
    const res = await fetch(url, {headers: {"User-Agent": "rubi-setup-native"}})
    if (!res.ok) fail(`download failed: ${res.status} ${res.statusText}`)
    const zipPath = join(work, zipName)
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))

    console.log("⇲ extracting")
    const extract =
      process.platform === "win32"
        ? spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zipPath, "-C", work], {stdio: "inherit"})
        : spawnSync("unzip", ["-oq", zipPath, "-d", work], {stdio: "inherit"})
    if (extract.status !== 0) fail(`extraction failed${extract.error ? `: ${extract.error.message}` : ""}`)
    if (!existsSync(join(work, "libs"))) fail("zip has no libs/ folder")

    rmSync(libsDir, {recursive: true, force: true})
    cpSync(join(work, "libs"), libsDir, {recursive: true})
    const missing = required.filter((f) => !existsSync(join(libsDir, f)))
    if (missing.length) fail(`missing after extraction: ${missing.join(", ")}`)
    writeFileSync(installedFile, stamp)
    console.log(`✓ native libs ${stamp} installed`)
  } finally {
    rmSync(work, {recursive: true, force: true})
  }
}

console.log("⚙ building the Node addon (npm rebuild simplex-chat)")
const build = spawnSync("npm", ["rebuild", "simplex-chat", "--foreground-scripts"], {cwd: root, stdio: "inherit", shell: true})
if (build.status !== 0) {
  fail(
    "addon build failed. On Windows install Visual Studio Build Tools with the 'Desktop development with C++' workload; " +
      "on Linux: build-essential + python3; on macOS: Xcode command line tools."
  )
}

const check = spawnSync(process.execPath, ["-e", "require('simplex-chat')"], {cwd: root, stdio: "inherit"})
if (check.status !== 0) fail("simplex-chat still fails to load")
console.log("✓ simplex-chat native library ready")

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
