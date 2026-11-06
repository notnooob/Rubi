import {closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync} from "node:fs"
import path from "node:path"

/**
 * One Rubi per database. Two chat cores on the same database fight over the same message queues
 * (each new subscriber takes the queue from the other), so messages get lost.
 *
 * The lock is a file holding the owner's PID. A lock left by a crashed process (PID gone) is taken over.
 */
export class InstanceLockError extends Error {
  override name = "InstanceLockError"
}

export function acquireLock(file: string): () => void {
  mkdirSync(path.dirname(file), {recursive: true})
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx")
      writeSync(fd, String(process.pid))
      closeSync(fd)
      let released = false
      const release = () => {
        if (released) return
        released = true
        try {
          if (readFileSync(file, "utf8").trim() === String(process.pid)) rmSync(file, {force: true})
        } catch {
          /* already gone */
        }
      }
      process.once("exit", release)
      return release
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      const pid = Number(readFileSync(file, "utf8").trim())
      if (pid && pid !== process.pid && isAlive(pid)) {
        throw new InstanceLockError(
          `Another Rubi (PID ${pid}) is already running on this database. Stop it first — two instances on one database lose messages.\n` +
            `  (If that process isn't Rubi, delete ${file})`
        )
      }
      rmSync(file, {force: true}) // stale lock from a crashed run
    }
  }
  throw new InstanceLockError(`Could not create lock file ${file}`)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}
