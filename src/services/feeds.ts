import type {Http} from "../core/http"
import {HttpError} from "../core/http"

/**
 * RSS 2.0, RSS 1.0 (RDF) and Atom feeds, read with a few regular expressions instead of a full XML parser:
 * Rubi only needs each entry's id, title, link and date.
 */
export interface FeedItem {
  id: string
  title: string
  link?: string
  date?: number
}

export interface Feed {
  title: string
  items: FeedItem[]
}

const NAMED: Record<string, string> = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "}

/** Text content: CDATA kept as is, entities decoded, tags stripped, whitespace collapsed. */
export function xmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, cdata: string | undefined, ent: string | undefined) => {
      if (cdata !== undefined) return cdata
      const e = ent!.toLowerCase()
      if (e.startsWith("#")) {
        const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
      }
      return NAMED[e] ?? m
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1]
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]

function linkOf(entry: string): string | undefined {
  const text = tag(entry, "link")
  if (text?.trim()) return xmlText(text)
  // Atom: <link href="…"/>, the alternate one when there are several
  for (const m of entry.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = attr(m[1]!, "rel")
    const href = attr(m[1]!, "href")
    if (href && (!rel || rel === "alternate")) return xmlText(href)
  }
}

export function isFeed(xml: string): boolean {
  return /<(rss|feed|rdf:RDF)\b/i.test(xml.slice(0, 2000))
}

export function parseFeed(xml: string): Feed {
  const entries = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? []
  const head = entries.length ? xml.slice(0, xml.indexOf(entries[0]!)) : xml
  const items = entries.map((e): FeedItem => {
    const title = xmlText(tag(e, "title") ?? "")
    const link = linkOf(e)
    const id = xmlText(tag(e, "guid") ?? tag(e, "id") ?? "") || link || title
    const raw = tag(e, "pubDate") ?? tag(e, "published") ?? tag(e, "updated") ?? tag(e, "dc:date")
    const date = raw ? Date.parse(xmlText(raw)) : NaN
    return {id, title: title || "(untitled)", link, date: Number.isNaN(date) ? undefined : date}
  })
  return {title: xmlText(tag(head, "title") ?? ""), items: items.filter((i) => i.id)}
}

/** The feed a web page advertises (`<link rel="alternate" type="application/rss+xml" href="…">`). */
export function findFeedLink(html: string, base: string): string | undefined {
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = m[1]!
    const href = attr(a, "href")
    if (href && /\balternate\b/i.test(attr(a, "rel") ?? "") && /application\/(rss|atom)\+xml/i.test(attr(a, "type") ?? "")) {
      try {
        return new URL(xmlText(href), base).href
      } catch {
        return undefined
      }
    }
  }
}

/** Fetch a feed, or the feed a page links to. `url` is user-supplied, so private addresses are refused. */
export async function loadFeed(http: Http, url: string): Promise<{url: string; feed: Feed}> {
  const opts = {service: "Feed", publicOnly: true, timeoutMs: 15_000, headers: {accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8"}}
  let body = await http.text(url, opts)
  if (!isFeed(body)) {
    const found = findFeedLink(body, url)
    if (!found) throw new HttpError("That page isn't an RSS or Atom feed and doesn't link to one.")
    url = found
    body = await http.text(url, opts)
    if (!isFeed(body)) throw new HttpError("The feed that page links to isn't RSS or Atom.")
  }
  return {url, feed: parseFeed(body)}
}
