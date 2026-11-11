import {readFileSync, readdirSync} from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const commandDir = path.join(root, "data", "commands")
const customDir = path.join(commandDir, "custom") // local, gitignored commands are not part of the documented set
const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (full !== customDir) walk(full)
    }
    else if (entry.name.endsWith(".ts") && !entry.name.startsWith("_")) files.push(full)
  }
}
walk(commandDir)
const commands = files.map((file) => ({file, text: readFileSync(file, "utf8")})).map(({file, text}) => ({
  file,
  name: text.match(/name:\s*["']([^"']+)["']/)?.[1],
  hidden: /hidden:\s*true/.test(text),
}))
const visible = commands.filter((c) => c.name && !c.hidden)
const readme = readFileSync(path.join(root, "README.md"), "utf8")
const count = Number(readme.match(/\*\*(\d+) commands\*\*/)?.[1] ?? NaN)
const errors = []
if (!Number.isInteger(count) || count !== visible.length) errors.push(`README command count is ${count}, registry files contain ${visible.length} visible commands.`)
for (const command of visible) if (!readme.includes(`/${command.name}`)) errors.push(`README does not mention /${command.name}.`)

const envExample = readFileSync(path.join(root, ".env.example"), "utf8")
const configFiles = [path.join(root, "src", "config.ts")]
const envKeys = new Set()
for (const file of configFiles) {
  for (const key of readFileSync(file, "utf8").matchAll(/RUBI_[A-Z0-9_]+/g)) envKeys.add(key[0])
}
for (const key of envKeys) if (!envExample.includes(key)) errors.push(`${key} is parsed by config.ts but missing from .env.example.`)

if (errors.length) {
  console.error(errors.map((e) => `docs:check: ${e}`).join("\n"))
  process.exitCode = 1
} else {
  console.log(`docs:check: ${visible.length} visible commands and ${envKeys.size} configuration keys documented.`)
}
