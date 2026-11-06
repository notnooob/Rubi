import {createWriteStream} from "node:fs"
import {rm} from "node:fs/promises"
import {lookup} from "node:dns/promises"
import {isIP} from "node:net"
import {fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent, type Dispatcher} from "undici"
import {CommandError} from "./errors"

/**
 * HTTP helper for commands: `ctx.http.json(url)` / `ctx.http.text(url)` / `ctx.http.request(url)`.
 *
 * - Timeout (default 10s) and cancellation tied to the command (`ctx.signal`).
 * - Response size cap (default 2 MB) so a huge page can't eat memory.
 * - Errors become friendly `HttpError`s (a ❌ reply, not a 💥 crash), e.g. "Weather service timed out."
 * - Optional proxy for all requests: RUBI_HTTP_PROXY=http://host:port or socks5://127.0.0.1:9050 (Tor).
 *   Without a proxy, every API you call sees this server's IP address.
 * - `publicOnly: true` refuses URLs that resolve to private/loopback addresses — use it for user-supplied URLs.
 */

export interface HttpOptions {
  /** Shown in error messages: "<service> timed out". Defaults to the host name. */
  service?: string
  method?: string
  headers?: Record<string, string>
  /** Appended to the URL as a query string. */
  query?: Record<string, string | number | boolean | undefined>
  /** JSON body (sets content-type). */
  json?: unknown
  /** Milliseconds (default 10 000). */
  timeoutMs?: number
  /** Max response bytes (default 2 MB). */
  maxBytes?: number
  /** Reject URLs resolving to private, loopback or link-local addresses (SSRF guard). */
  publicOnly?: boolean
  /** "manual": don't follow redirects; the 3xx response (with its `location` header) is returned. Use with `allowErrorStatus`. */
  redirect?: "follow" | "manual"
  /** Don't read the body (e.g. when only the status or headers matter). */
  discardBody?: boolean
  /** Don't throw on non-2xx; return the response instead. */
  allowErrorStatus?: boolean
  /** Combined with the command's signal. */
  signal?: AbortSignal
}

export interface HttpResponse {
  status: number
  ok: boolean
  url: string
  headers: Headers
  /** Response time in ms. */
  ms: number
  body: Buffer
  text(): string
  json<T = unknown>(): T
}

/** A failed request, worded for users. */
export class HttpError extends CommandError {
  override name = "HttpError"
  override icon = "🌐"
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export class Http {
  private readonly dispatcher: Dispatcher | undefined

  constructor(
    private readonly userAgent: string,
    proxy?: string,
    private readonly signal?: AbortSignal
  ) {
    if (proxy) {
      this.dispatcher = /^socks5h?:\/\//i.test(proxy) ? new Socks5ProxyAgent(proxy) : new ProxyAgent(proxy)
    }
  }

  /** Same client, cancelled together with `signal` (used to give each command its own instance). */
  withSignal(signal: AbortSignal): Http {
    const h = Object.create(this) as Http
    ;(h as any).signal = signal
    return h
  }

  async request(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
    const {res, u, service, timeoutMs, started} = await this.open(url, opts)
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    let buf: Buffer
    if (opts.discardBody) {
      await res.body?.cancel().catch(() => undefined)
      buf = Buffer.alloc(0)
    } else {
      const declared = Number(res.headers.get("content-length") ?? 0)
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined)
        throw new HttpError(`${service} sent too much data.`)
      }
      try {
        buf = await readCapped(res, maxBytes, service)
      } catch (e) {
        if (e instanceof HttpError) throw e
        throw this.networkError(e, service, timeoutMs)
      }
    }
    const ms = Date.now() - started

    if (!res.ok && !opts.allowErrorStatus) throw statusError(service, res.status)
    return {
      status: res.status,
      ok: res.ok,
      url: res.url || u.toString(),
      headers: res.headers as unknown as Headers,
      ms,
      body: buf,
      text: () => buf.toString("utf8"),
      json: <T>() => {
        try {
          return JSON.parse(buf.toString("utf8")) as T
        } catch {
          throw new HttpError(`${service} sent a response I couldn't read.`)
        }
      },
    }
  }

  /**
   * Stream a response body to a file (for media: no 2 MB in-memory cap, `maxBytes` still applies, default 50 MB).
   * `accept(contentType)` can refuse a response before anything is written (e.g. HTML pages); then it returns undefined.
   * The file is removed again if the download fails.
   */
  async download(
    url: string,
    filePath: string,
    opts: HttpOptions & {accept?: (contentType: string) => boolean} = {}
  ): Promise<{bytes: number; contentType: string; url: string} | undefined> {
    const {res, u, service, timeoutMs} = await this.open(url, {timeoutMs: 60_000, ...opts})
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      throw statusError(service, res.status)
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
    const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024
    const declared = Number(res.headers.get("content-length") ?? 0)
    if ((opts.accept && !opts.accept(contentType)) || declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined)
      if (declared > maxBytes) throw new HttpError(`${service}: the file is too big (${Math.round(declared / 1048576)} MB).`)
      return undefined
    }
    let bytes = 0
    const out = createWriteStream(filePath)
    try {
      for await (const chunk of (res.body ?? []) as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength
        if (bytes > maxBytes) throw new HttpError(`${service}: the file is too big (over ${Math.round(maxBytes / 1048576)} MB).`)
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r))
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
    } catch (e) {
      out.destroy()
      await rm(filePath, {force: true}).catch(() => undefined)
      if (e instanceof HttpError) throw e
      throw this.networkError(e, service, timeoutMs)
    }
    return {bytes, contentType, url: res.url || u.toString()}
  }

  /** Sends the request (SSRF checks, redirects, timeout, proxy) and returns the response before its body is read. */
  private async open(url: string, opts: HttpOptions) {
    let u = buildUrl(url, opts.query)
    const service = opts.service ?? u.hostname
    // through a proxy, resolving locally would leak the lookup — only literal hosts are checked then
    const resolveDns = !this.dispatcher
    if (opts.publicOnly) await assertPublic(u, resolveDns)

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
    const signals = [AbortSignal.timeout(timeoutMs), this.signal, opts.signal].filter((s): s is AbortSignal => !!s)
    const signal = AbortSignal.any(signals)
    const headers: Record<string, string> = {"user-agent": this.userAgent, accept: "application/json, text/plain, */*"}
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v
    let body: string | undefined
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json)
      headers["content-type"] = "application/json"
    }
    const manual = opts.redirect === "manual"

    const started = Date.now()
    let res: Awaited<ReturnType<typeof undiciFetch>>
    try {
      // with publicOnly, follow redirects by hand so every hop is checked (no redirect into the LAN)
      for (let hop = 0; ; hop++) {
        res = await undiciFetch(u, {
          method: opts.method ?? (body ? "POST" : "GET"),
          headers,
          body,
          signal,
          dispatcher: this.dispatcher,
          redirect: opts.publicOnly || manual ? "manual" : "follow",
        })
        const location = res.headers.get("location")
        if (manual || !opts.publicOnly || res.status < 300 || res.status >= 400 || !location) break
        if (hop >= 5) throw new HttpError(`${service} redirected too many times.`)
        await res.body?.cancel().catch(() => undefined)
        u = new URL(location, u)
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError("Redirected to a non-http URL.")
        await assertPublic(u, resolveDns)
      }
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw this.networkError(e, service, timeoutMs)
    }
    return {res, u, service, timeoutMs, started}
  }

  async json<T = any>(url: string, opts: HttpOptions = {}): Promise<T> {
    return (await this.request(url, opts)).json<T>()
  }

  async text(url: string, opts: HttpOptions = {}): Promise<string> {
    return (await this.request(url, opts)).text()
  }

  private networkError(e: unknown, service: string, timeoutMs: number): Error {
    const err = e as Error & {cause?: any}
    if (err?.name === "TimeoutError" || (err?.name === "AbortError" && this.signal?.aborted === false)) {
      return new HttpError(`${service} didn't answer in time (${Math.round(timeoutMs / 1000)}s).`)
    }
    if (err?.name === "AbortError") return new HttpError("Request cancelled.")
    const code = err?.cause?.code ?? (err as any)?.code
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new HttpError(`Couldn't find ${service}.`)
    if (code === "ECONNREFUSED" || code === "ECONNRESET") return new HttpError(`Couldn't connect to ${service}.`)
    if (typeof code === "string" && code.startsWith("CERT_")) return new HttpError(`${service} has an invalid TLS certificate.`)
    return new HttpError(`Couldn't reach ${service}.`)
  }
}

function statusError(service: string, status: number): HttpError {
  return new HttpError(
    status === 404
      ? `${service}: nothing found.`
      : status === 429
        ? `${service} is rate-limiting me — try again in a minute.`
        : status >= 500
          ? `${service} is having problems right now (${status}).`
          : `${service} answered with an error (${status}).`,
    status
  )
}

function buildUrl(url: string, query?: HttpOptions["query"]): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new HttpError(`"${url}" isn't a valid URL.`)
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError("Only http(s) URLs are supported.")
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
  return u
}

async function readCapped(res: Response | Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number, service: string): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > maxBytes) throw new HttpError(`${service} sent too much data.`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** SSRF guard: refuse hosts that resolve to non-public addresses. */
async function assertPublic(u: URL, resolveDns: boolean): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, "")
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new HttpError("That address isn't public.")
  let addrs: string[]
  if (isIP(host)) addrs = [host]
  else if (!resolveDns) return
  else {
    try {
      addrs = (await lookup(host, {all: true})).map((a) => a.address)
    } catch {
      throw new HttpError(`Couldn't find ${host}.`)
    }
  }
  if (addrs.some(isPrivateAddress)) throw new HttpError("That address isn't public.")
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number)
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7))
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff")
}
