import type {T} from "@simplex-chat/types"
import {UsageError} from "./errors"

/**
 * Typed command arguments.
 *
 * - `string`  — one word, or a "quoted phrase"
 * - `text`    — everything that's left (must be the last argument)
 * - `integer` / `number` — validated numbers (`min` / `max` optional)
 * - `boolean` — yes/no, on/off, true/false, 1/0
 * - `member`  — a group member: `@mention`, `@'Name With Spaces'`, display name, or `#groupMemberId` (groups only)
 *
 * Add `choices` to a `string` to restrict (and type) the accepted values.
 */
export type ArgType = "string" | "text" | "integer" | "number" | "boolean" | "member"

export interface ArgDef {
  readonly name: string
  readonly type: ArgType
  readonly description: string
  readonly required?: boolean
  readonly choices?: readonly string[]
  readonly min?: number
  readonly max?: number
}

interface ArgTypeMap {
  string: string
  text: string
  integer: number
  number: number
  boolean: boolean
  member: T.GroupMember
}

export type ArgValue<A extends ArgDef> = A extends {readonly choices: readonly (infer C extends string)[]} ? C : ArgTypeMap[A["type"]]

/** `{name: value}` object type inferred from an args definition array. */
export type ParsedArgs<As extends readonly ArgDef[]> = {
  [A in As[number] as A["name"]]: A extends {readonly required: true} ? ArgValue<A> : ArgValue<A> | undefined
}

export interface Token {
  value: string
  /** Offsets in the raw input — `text` args take the raw remainder from `start`. */
  start: number
  end: number
  quoted: boolean
}

/** Splits on whitespace; supports "double", 'single' quotes (with \\ escapes) and @'quoted mentions'. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c)
  while (i < n) {
    while (i < n && isSpace(input[i])) i++
    if (i >= n) break
    const start = i
    let prefix = ""
    if (input[i] === "@" && (input[i + 1] === "'" || input[i + 1] === '"')) {
      prefix = "@"
      i++
    }
    const q = input[i]
    if (q === '"' || q === "'") {
      i++
      let value = ""
      let closed = false
      while (i < n) {
        const c = input[i]!
        if (c === "\\" && i + 1 < n) {
          value += input[i + 1]
          i += 2
          continue
        }
        if (c === q) {
          closed = true
          i++
          break
        }
        value += c
        i++
      }
      if (!closed) throw new UsageError(`Unclosed quote ${q} in arguments.`)
      tokens.push({value: prefix + value, start, end: i, quoted: true})
    } else {
      while (i < n && !isSpace(input[i])) i++
      tokens.push({value: input.slice(start, i), start, end: i, quoted: false})
    }
  }
  return tokens
}

const TRUE = new Set(["yes", "y", "true", "on", "1", "enable", "enabled"])
const FALSE = new Set(["no", "n", "false", "off", "0", "disable", "disabled"])

export type MemberResolver = (token: string) => Promise<T.GroupMember>

/** Parse raw argument text against definitions. Throws `UsageError` with a helpful message. */
export async function parseArgs(defs: readonly ArgDef[], raw: string, resolveMember: MemberResolver): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const tokens = tokenize(raw)
  let ti = 0
  for (const def of defs) {
    const tok = tokens[ti]
    if (def.type === "text") {
      const rest = tok ? raw.slice(tok.start).trim() : ""
      ti = tokens.length
      if (!rest) {
        if (def.required) throw new UsageError(`Missing ${argLabel(def)}.`)
        continue
      }
      out[def.name] = checkChoices(def, rest)
      continue
    }
    if (!tok) {
      if (def.required) throw new UsageError(`Missing ${argLabel(def)}.`)
      continue
    }
    ti++
    out[def.name] = await convert(def, tok.value, resolveMember)
  }
  if (ti < tokens.length) {
    const extra = tokens.slice(ti).map((t) => t.value).join(" ")
    throw new UsageError(`Too many arguments: "${extra}".`)
  }
  return out
}

async function convert(def: ArgDef, v: string, resolveMember: MemberResolver): Promise<unknown> {
  switch (def.type) {
    case "string":
    case "text":
      return checkChoices(def, v)
    case "integer":
    case "number": {
      const num = Number(v.replace(/_/g, ""))
      if (!Number.isFinite(num) || (def.type === "integer" && !Number.isInteger(num))) {
        throw new UsageError(`${argLabel(def)} must be ${def.type === "integer" ? "a whole number" : "a number"}, got "${v}".`)
      }
      if (def.min !== undefined && num < def.min) throw new UsageError(`${argLabel(def)} must be at least ${def.min}.`)
      if (def.max !== undefined && num > def.max) throw new UsageError(`${argLabel(def)} must be at most ${def.max}.`)
      return num
    }
    case "boolean": {
      const s = v.toLowerCase()
      if (TRUE.has(s)) return true
      if (FALSE.has(s)) return false
      throw new UsageError(`${argLabel(def)} must be yes/no (or on/off), got "${v}".`)
    }
    case "member":
      return resolveMember(v)
  }
}

function checkChoices(def: ArgDef, v: string): string {
  if (!def.choices) return v
  const match = def.choices.find((c) => c.toLowerCase() === v.toLowerCase())
  if (match === undefined) throw new UsageError(`${argLabel(def)} must be one of: ${def.choices.join(", ")}.`)
  return match
}

const argLabel = (def: ArgDef) => `<${def.name}>`

/** "<member> [reason...]" — required in <>, optional in [], `text` with "...". */
export function usageParams(defs: readonly ArgDef[]): string {
  return defs
    .map((d) => {
      const inner = d.choices ? d.choices.join("|") : d.name + (d.type === "text" ? "..." : "")
      return d.required ? `<${inner}>` : `[${inner}]`
    })
    .join(" ")
}
