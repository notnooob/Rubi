import type {Http} from "../core/http"
import {HttpError} from "../core/http"
import type {MediaItem} from "../util/attachments"
import * as fmt from "../util/format"

/**
 * X (formerly Twitter) posts via the FxTwitter API (https://github.com/FxEmbed/FxEmbed), which needs no account
 * or key: GET https://api.fxtwitter.com/<user>/status/<id>.
 *
 * - `parseXLink` → user + status id from x.com / twitter.com (and fxtwitter/vxtwitter/fixupx) links
 * - `fetchXPost` → the post, with its quoted post, media, poll, community note…
 * - `renderXPost` / `xStats` → SimpleX text; `xMedia` → photos, videos and GIFs to attach
 */

export const FXTWITTER = "https://api.fxtwitter.com"

export interface XLink {
  /** Screen name, when the link has one (/i/web/status/<id> links don't). */
  user?: string
  id: string
}

const HOSTS = /^(?:www\.|mobile\.|m\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx|twittpr|nitter)\.(?:com|net)$/i

/** https://x.com/<user>/status/<id>, twitter.com, mobile links, /i/web/status/<id>, mirrors like fxtwitter.com. */
export function parseXLink(input: string): XLink | undefined {
  const raw = input.trim().replace(/^<|>$/g, "")
  let u: URL
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return undefined
  }
  if (!HOSTS.test(u.hostname)) return undefined
  const m = u.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})|i(?:\/web)?)\/status(?:es)?\/(\d{1,20})(?:\/|$)/)
  if (!m) return undefined
  return {user: m[1] && m[1].toLowerCase() !== "i" ? m[1] : undefined, id: m[2]!}
}

// ── API ────────────────────────────────────────────────────────────────────

export interface XAuthor {
  name: string
  screen_name: string
  url?: string
  avatar_url?: string
  followers?: number
  verification?: {verified?: boolean; type?: string | null} | null
}

export interface XPhoto {
  type: "photo" | "gif"
  url: string
  width?: number
  height?: number
  altText?: string
}

export interface XVideo {
  type: "video" | "gif"
  url: string
  thumbnail_url?: string | null
  duration?: number
  width?: number
  height?: number
  formats?: {url: string; container?: string; bitrate?: number; height?: number}[]
  variants?: {url: string; content_type?: string; bitrate?: number}[]
}

export interface XPoll {
  choices: {label: string; count: number; percentage: number}[]
  total_votes: number
  ends_at?: string
  time_left_en?: string
}

export interface XTombstone {
  type: "tombstone"
  reason?: string
  message?: string
  url?: string
}

export interface XPost {
  id: string
  url: string
  text: string
  author: XAuthor
  created_timestamp: number
  replies?: number
  retweets?: number
  reposts?: number
  likes?: number
  bookmarks?: number
  quotes?: number
  views?: number | null
  replying_to?: string | null
  replying_to_status?: string | null
  possibly_sensitive?: boolean
  is_note_tweet?: boolean
  lang?: string | null
  quote?: XPost | XTombstone
  poll?: XPoll
  /** v2: links as facets; legacy: entities with code point offsets */
  community_note?: {
    text: string
    facets?: {type: string; indices: [number, number]; replacement?: string}[]
    entities?: {fromIndex: number; toIndex: number; ref?: {url?: string}}[]
  } | null
  media?: {
    all?: (XPhoto | XVideo | {type: string; url: string})[]
    photos?: XPhoto[]
    videos?: XVideo[]
    external?: {type: "video"; url: string; thumbnail_url?: string}
    broadcast?: {url: string; title?: string; state?: string}
  }
  card?: {url: string; title?: string; domain?: string}
  article?: {title: string; preview_text?: string}
  translation?: {text: string; source_lang_en?: string}
  reposted_by?: {name: string; screen_name: string} | null
}

const isTombstone = (q: XPost | XTombstone | undefined): q is XTombstone => !!q && (q as XTombstone).type === "tombstone"

/** The post, or undefined if it doesn't exist. Private/suspended posts throw a friendly HttpError. */
export async function fetchXPost(http: Http, link: XLink): Promise<XPost | undefined> {
  const path = link.user ? `${encodeURIComponent(link.user)}/status/${link.id}` : `status/${link.id}`
  const res = await http.request(`${FXTWITTER}/${path}`, {service: "FxTwitter", allowErrorStatus: true, timeoutMs: 15_000})
  let body: {code?: number; message?: string; tweet?: XPost}
  try {
    body = res.json()
  } catch {
    throw new HttpError(res.status >= 500 ? "FxTwitter is having problems right now." : "FxTwitter sent a response I couldn't read.", res.status)
  }
  if (body.tweet) return body.tweet
  const code = body.code ?? res.status
  if (code === 404) return undefined
  if (code === 401 || body.message === "PRIVATE_TWEET") throw new HttpError("That post is from a private account.", 401)
  if (code === 429) throw new HttpError("FxTwitter is rate-limiting me — try again in a minute.", 429)
  throw new HttpError(code >= 500 ? "FxTwitter couldn't load that post right now. Try again in a minute." : `FxTwitter: ${body.message ?? code}`, code)
}

// ── formatting ─────────────────────────────────────────────────────────────

const verified = (a: XAuthor) => (a.verification?.verified ? (a.verification.type === "government" ? " 🏛" : a.verification.type === "business" ? " 🏅" : " ☑️") : "")

/** "*Name* ☑️ @handle · 3h ago" */
export function authorLine(p: XPost, now = Date.now()): string {
  return `${fmt.bold(p.author.name.trim() || p.author.screen_name)}${verified(p.author)} ${fmt.color("blue", `@${p.author.screen_name}`)} · ${fmt.when(p.created_timestamp * 1000, now)}`
}

/** Post text without the leading "@user @user" of a reply (shown as "Replying to" instead). */
export function postText(p: XPost): string {
  let t = (p.text ?? "").replace(/\r\n?/g, "\n").trim()
  if (p.replying_to) t = t.replace(/^(?:@\w{1,15}\s+)+/, "")
  return plainText(t)
}

/**
 * Posts are plain text, so keep SimpleX from reading markup into them: "#tag" would become a SimpleX name link,
 * so an invisible word joiner goes after the "#". Trailing spaces and extra blank lines are dropped.
 */
export function plainText(t: string): string {
  return t
    .replace(/(^|\s)#(?=[\p{L}\p{N}_])/gu, "$1#⁠")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
}

/** Community note text with its links expanded (the API's text shows them shortened, with "…"). */
export function noteText(note: NonNullable<XPost["community_note"]>): string {
  const chars = Array.from(note.text)
  const spans = [
    ...(note.facets ?? []).filter((f) => f.type === "url" && f.replacement).map((f) => ({from: f.indices[0], to: f.indices[1], url: f.replacement!})),
    ...(note.entities ?? []).filter((e) => e.ref?.url).map((e) => ({from: e.fromIndex, to: e.toIndex, url: e.ref!.url!})),
  ].sort((a, b) => b.from - a.from)
  for (const sp of spans) if (sp.from >= 0 && sp.to <= chars.length && sp.from < sp.to) chars.splice(sp.from, sp.to - sp.from, sp.url)
  return plainText(chars.join("").trim())
}

function pollLines(poll: XPoll): string {
  const top = Math.max(...poll.choices.map((c) => c.count))
  return fmt.lines(
    ...poll.choices.map((c) => `${fmt.bar(c.percentage / 100, 8)} ${c.count === top && top > 0 ? fmt.bold(c.label) : c.label} ${fmt.italic(`${Math.round(c.percentage)}%`)}`),
    fmt.italic(`📊 ${fmt.plural(poll.total_votes, "vote")}${poll.time_left_en ? ` · ${poll.time_left_en}` : ""}`)
  )
}

/** Links and labels for things that aren't attached: link cards, articles, external videos, live broadcasts. */
function extrasOf(p: XPost): (string | undefined)[] {
  const ext = p.media?.external
  const live = p.media?.broadcast
  return [
    p.article && fmt.lines(`📰 ${fmt.bold(p.article.title)}`, p.article.preview_text && fmt.italic(p.article.preview_text.trim())),
    p.card?.url && `🔗 ${p.card.title ? `${p.card.title} ` : ""}${p.card.url}`,
    ext?.url && `▶️ ${ext.url}`,
    live?.url && `🔴 ${live.title ? `${live.title} ` : ""}${fmt.italic(live.state === "LIVE" ? "(live now)" : "(broadcast)")} ${live.url}`,
  ]
}

/** One post (the main one, or a quoted one when `depth` is 1). */
function postBlock(p: XPost, media: {photos: number; videos: number}, now: number): string {
  const counts = [media.photos && fmt.plural(media.photos, "photo"), media.videos && fmt.plural(media.videos, "video")].filter(Boolean).join(", ")
  return fmt.lines(
    authorLine(p, now),
    p.replying_to && fmt.italic(`↩️ Replying to @${p.replying_to}`),
    postText(p) && `\n${postText(p)}`,
    p.translation?.text && `\n🌐 ${fmt.italic(`Translated${p.translation.source_lang_en ? ` from ${p.translation.source_lang_en}` : ""}:`)}\n${p.translation.text.trim()}`,
    p.poll && `\n${pollLines(p.poll)}`,
    ...extrasOf(p).map((x) => x && `\n${x}`),
    counts && `\n${fmt.italic(`🖼 ${counts}`)}`,
    p.community_note?.text && `\n📝 ${fmt.bold("Community note")}\n${noteText(p.community_note)}`
  )
}

const quoteLines = (s: string) =>
  s
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n")

function mediaCounts(p: XPost): {photos: number; videos: number} {
  return {photos: p.media?.photos?.length ?? 0, videos: p.media?.videos?.length ?? 0}
}

/**
 * The post as SimpleX text: who, when, what it replies to, the text, poll, links, community note, and the quoted
 * post as a quote block. Media isn't listed for the main post (it's attached); quoted media is counted.
 */
export function renderXPost(p: XPost, opts: {parent?: XPost; now?: number} = {}): string {
  const now = opts.now ?? Date.now()
  const parent = opts.parent
  const head = fmt.lines(
    p.reposted_by && fmt.italic(`🔁 Reposted by ${p.reposted_by.name}`),
    // a reply: the post it answers comes first, like on X
    parent && quoteLines(fmt.lines(`↩️ ${postBlock(parent, mediaCounts(parent), now)}`, `🌐 ${parent.url}`))
  )
  const q = p.quote
  const quote = isTombstone(q)
    ? quoteLines(`🚫 ${q.message ?? "The quoted post is unavailable."}`)
    : q
      ? quoteLines(fmt.lines(`🔁 ${postBlock(q, mediaCounts(q), now)}`, `🌐 ${q.url}`))
      : undefined
  return fmt.lines(head ? `${head}\n` : undefined, `𝕏 ${postBlock(p, {photos: 0, videos: 0}, now)}`, quote && `\n${quote}`)
}

/** The bottom line: replies, reposts, likes, bookmarks, views. */
export function xStats(p: XPost): string {
  const n = (v: number | null | undefined) => fmt.bold(fmt.compact(v ?? 0))
  return [
    `💬 ${n(p.replies)}`,
    `🔁 ${n(p.retweets ?? p.reposts)}`,
    p.quotes ? `❝ ${n(p.quotes)}` : undefined,
    `❤️ ${n(p.likes)}`,
    p.bookmarks ? `🔖 ${n(p.bookmarks)}` : undefined,
    p.views ? `👁 ${n(p.views)} views` : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
}

// ── media ──────────────────────────────────────────────────────────────────

/** Photos as their original size, with the "large" size as a fallback (some originals are huge PNGs). */
function photoItem(ph: XPhoto, caption?: string): MediaItem {
  const large = ph.url.includes("name=") ? ph.url.replace(/name=\w+/, "name=large") : `${ph.url}${ph.url.includes("?") ? "&" : "?"}name=large`
  return {kind: ph.type === "gif" ? "gif" : "image", url: ph.url, alts: large !== ph.url ? [{kind: "image", url: large}] : undefined, caption: caption ?? ph.altText}
}

/** Videos (and X's GIFs, which are MP4s): the best MP4, with lower bitrates as fallbacks if it's too big. */
function videoItem(v: XVideo, caption?: string): MediaItem {
  const mp4s = [
    ...(v.formats ?? []).filter((f) => f.container === "mp4" || /\.mp4(\?|$)/.test(f.url)),
    ...(v.variants ?? []).filter((f) => f.content_type === "video/mp4"),
  ]
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
    .map((f) => f.url)
  const urls = [...new Set([v.url, ...mp4s].filter((u) => u && !/\.m3u8(\?|$)/.test(u)))]
  return {
    kind: "video",
    url: urls[0] ?? v.url,
    alts: urls.slice(1).map((url) => ({kind: "video" as const, url})),
    previewUrl: v.thumbnail_url ?? undefined,
    duration: v.duration,
    caption,
  }
}

function itemsOf(p: XPost, caption?: string): MediaItem[] {
  const all = p.media?.all
  if (all?.length) {
    return all.flatMap((m): MediaItem[] => {
      if (m.type === "photo") return [photoItem(m as XPhoto, caption)]
      if (m.type === "video" || m.type === "gif") return [videoItem(m as XVideo, caption)]
      return [] // mosaics are previews of the photos above
    })
  }
  return [...(p.media?.photos ?? []).map((ph) => photoItem(ph, caption)), ...(p.media?.videos ?? []).map((v) => videoItem(v, caption))]
}

/** Everything to attach: the post's photos and videos, then the quoted post's (captioned as such). */
export function xMedia(p: XPost): MediaItem[] {
  const q = p.quote && !isTombstone(p.quote) ? p.quote : undefined
  return [...itemsOf(p), ...(q ? itemsOf(q, `From @${q.author.screen_name}'s quoted post`) : [])]
}

/** Request headers for pbs.twimg.com / video.twimg.com. */
export const X_MEDIA_HEADERS: Record<string, string> = {
  accept: "image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8",
}
