/**
 * Safe calculator (no eval): + - * / % ^ (also × ÷ **), parentheses, unary minus.
 * Functions: sqrt cbrt abs round floor ceil sin cos tan asin acos atan log (base 10) ln log2 exp min max.
 * Constants: pi, e, tau. Not supported: implicit multiplication ("2(3)"). Commas group digits ("1,000 + 2").
 */
export class CalcError extends Error {}

type Tok = {t: "num"; v: number} | {t: "op"; v: string} | {t: "id"; v: string} | {t: "("} | {t: ")"} | {t: ","}

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, ln: Math.log, log2: Math.log2, exp: Math.exp, min: Math.min, max: Math.max,
}
const CONSTS: Record<string, number> = {pi: Math.PI, e: Math.E, tau: 2 * Math.PI}

function tokenize(src: string): Tok[] {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^")
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (/\s/.test(c)) {
      i++
    } else if (/[0-9.]/.test(c)) {
      const m = s.slice(i).match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(e[+-]?\d+)?/i)
      if (!m) throw new CalcError(`Unexpected "${c}"`)
      out.push({t: "num", v: Number(m[1]!.replace(/,/g, "") + (m[2] ?? ""))})
      i += m[0].length
    } else if (/[a-z]/i.test(c)) {
      const m = s.slice(i).match(/^[a-z][a-z0-9]*/i)!
      out.push({t: "id", v: m[0].toLowerCase()})
      i += m[0].length
    } else if ("+-*/%^".includes(c)) {
      out.push({t: "op", v: c})
      i++
    } else if (c === "(" || c === ")" || c === ",") {
      out.push({t: c})
      i++
    } else throw new CalcError(`Unexpected "${c}"`)
  }
  return out
}

/** Recursive descent: expr → term (+|- term)*; term → unary (*|/|% unary)*; unary → -unary | power; power → atom (^ unary)? */
export function evaluate(src: string): number {
  if (src.length > 300) throw new CalcError("Expression too long")
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = peek()
    return t?.t === "op" && t.v === v
  }

  const expr = (): number => {
    let v = term()
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as {v: string}).v
      const r = term()
      v = op === "+" ? v + r : v - r
    }
    return v
  }
  const term = (): number => {
    let v = unary()
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (toks[p++] as {v: string}).v
      const r = unary()
      if ((op === "/" || op === "%") && r === 0) throw new CalcError("Division by zero")
      v = op === "*" ? v * r : op === "/" ? v / r : v % r
    }
    return v
  }
  const unary = (): number => {
    if (isOp("-")) {
      p++
      return -unary()
    }
    if (isOp("+")) {
      p++
      return unary()
    }
    return power()
  }
  const power = (): number => {
    const base = atom()
    if (isOp("^")) {
      p++
      return Math.pow(base, unary()) // right-associative
    }
    return base
  }
  const atom = (): number => {
    const t = toks[p++]
    if (!t) throw new CalcError("Unexpected end")
    if (t.t === "num") return t.v
    if (t.t === "(") {
      const v = expr()
      if (toks[p++]?.t !== ")") throw new CalcError("Missing )")
      return v
    }
    if (t.t === "id") {
      if (t.v in CONSTS) return CONSTS[t.v]!
      const f = FUNCS[t.v]
      if (!f) throw new CalcError(`Unknown name "${t.v}"`)
      if (toks[p++]?.t !== "(") throw new CalcError(`${t.v} needs parentheses, e.g. ${t.v}(2)`)
      const args = [expr()]
      while (peek()?.t === ",") {
        p++
        args.push(expr())
      }
      if (toks[p++]?.t !== ")") throw new CalcError("Missing )")
      return f(...args)
    }
    throw new CalcError(`Unexpected "${t.t === "op" ? t.v : t.t}"`)
  }

  const v = expr()
  if (p < toks.length) throw new CalcError("Unexpected input after the expression")
  if (!Number.isFinite(v)) throw new CalcError("The result isn't a finite number")
  return v
}
