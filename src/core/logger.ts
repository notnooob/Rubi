import {inspect} from "node:util"

export type LogLevel = "debug" | "info" | "warn" | "error"

const RANK: Record<LogLevel, number> = {debug: 10, info: 20, warn: 30, error: 40}
const COLOR: Record<LogLevel, string> = {debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m"}
const RESET = "\x1b[0m"
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

let threshold: number = RANK.info

export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level]
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  /** Logger with a nested scope, e.g. `rubi:dispatcher`. */
  child(scope: string): Logger
}

function fmt(args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : inspect(a, {depth: 6, colors: useColor})
    )
    .join(" ")
}

export function createLogger(scope: string): Logger {
  const write = (level: LogLevel, args: unknown[]) => {
    if (RANK[level] < threshold) return
    const ts = new Date().toISOString().slice(11, 23)
    const tag = level.toUpperCase().padEnd(5)
    const head = useColor ? `${COLOR[level]}${ts} ${tag}${RESET} \x1b[35m[${scope}]${RESET}` : `${ts} ${tag} [${scope}]`
    const line = `${head} ${fmt(args)}`
    if (level === "error" || level === "warn") console.error(line)
    else console.log(line)
  }
  return {
    debug: (...a) => write("debug", a),
    info: (...a) => write("info", a),
    warn: (...a) => write("warn", a),
    error: (...a) => write("error", a),
    child: (sub) => createLogger(`${scope}:${sub}`),
  }
}

export const logger = createLogger("rubi")
