/**
 * Rubi — entry point.
 *
 *   npm run dev     (TypeScript directly, via tsx)
 *   npm run build && npm start
 *
 * Boots the bot: loads config (.env), every command in data/commands and every event handler
 * in data/events, then connects to SimpleX via the official `simplex-chat` library.
 */
import {loadConfig} from "./config"
import {describeError} from "./core/errors"
import {logger, setLogLevel} from "./core/logger"
import {InstanceLockError} from "./core/lock"
import {NativeLibraryError, Rubi} from "./core/rubi"

async function main(): Promise<void> {
  const config = loadConfig()
  setLogLevel(config.log.level)

  const rubi = new Rubi(config)

  let shuttingDown = false
  const shutdown = (signal: string, code = 0) => {
    if (shuttingDown) {
      logger.warn("forced exit")
      process.exit(1)
    }
    shuttingDown = true
    rubi
      .stop(signal)
      .catch((e) => logger.error("error during shutdown:", e))
      .finally(() => process.exit(code))
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("unhandledRejection", (reason) => logger.error("unhandled promise rejection:", reason))
  process.on("uncaughtException", (err) => {
    logger.error("uncaught exception:", err)
    shutdown("uncaughtException", 1)
  })

  try {
    await rubi.start()
  } catch (e) {
    if (e instanceof NativeLibraryError || e instanceof InstanceLockError) {
      logger.error(e.message)
    } else if ((e as any)?.dbMigrationError) {
      // core.ChatInitError — database could not be opened/migrated
      const m = (e as any).dbMigrationError
      logger.error(`could not open the chat database (${m.type}). Wrong RUBI_DB_KEY, a corrupt file, or a migration problem:`, m)
    } else {
      logger.error(`failed to start: ${describeError(e)}`, e)
    }
    process.exit(1)
  }
}

void main()
