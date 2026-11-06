import {existsSync} from "node:fs"
import path from "node:path"

/**
 * Filesystem locations resolved relative to this module, so they work both
 * from TypeScript sources (`tsx src/index.ts`) and from the compiled output
 * (`node dist/src/index.js`, where `data/` is compiled to `dist/data/`).
 */
export const SRC_DIR = __dirname
export const DATA_DIR = path.resolve(__dirname, "..", "data")
export const COMMANDS_DIR = path.join(DATA_DIR, "commands")
export const EVENTS_DIR = path.join(DATA_DIR, "events")

/** Project root (the folder with package.json) — `src/..` or `dist/src/../..`. */
export const ROOT_DIR = (() => {
  let dir = __dirname
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir
    dir = path.dirname(dir)
  }
  return process.cwd()
})()
