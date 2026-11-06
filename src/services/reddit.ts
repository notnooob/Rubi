import type {Http} from "../core/http"
import {HttpError} from "../core/http"
import type {MediaItem} from "../util/attachments"
import * as fmt from "../util/format"

/**
 * Reddit posts via the Arctic Shift API (https://arctic-shift.photon-reddit.com), an archive of Reddit
 * that needs no account or key. Docs: https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md
 *
 * - `parseRedditLink` → post id (and comment id) from any Reddit URL form, or a share link to resolve
 * - `resolveShareLink` → reddit.com/r/<sub>/s/<token> via Arctic Shift's share-link index (falls back to following redirects)
 * - `fetchPost` / `fetchComment` → archived data
 * - `redditToSimplex` → Reddit markdown → SimpleX markdown
 * - `postMedia` → the images / GIFs / videos / files attached to a post, in order
 */

export const ARCTIC_SHIFT = "https://arctic-shift.photon-reddit.com"

/** Headers for reddit.com itself (share-link redirects, media CDNs): Reddit turns away obvious bots. */
export const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
}

/** For media downloads: no text/html in Accept, or i.redd.it answers with its HTML image viewer instead of the file. */
export const MEDIA_HEADERS: Record<string, string> = {
  "user-agent": BROWSER_HEADERS["user-agent"]!,
  accept: "image/avif,image/webp,image/apng,image/*,video/*,audio/*,application/octet-stream;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
}

// ── links ──────────────────────────────────────────────────────────────────

export type RedditLink = {postId: string; commentId?: string} | {share: string}

const ID = "[a-z0-9]{4,12}"

/**
 * Accepts post URLs (www/old/new/m/np.reddit.com, with or without https://), redd.it/<id>, /gallery/<id>,
 * comment permalinks, share links (/r/<sub>/s/<token>, /u/<name>/s/<token>), "t3_<id>" or a bare id.
 */
export function parseRedditLink(input: string): RedditLink | undefined {
  const raw = input.trim().replace(/^<|>$/g, "")
  const bare = raw.match(new RegExp(`^(?:t3_)?(${ID})$`, "i"))
  if (bare && !/^https?:/i.test(raw)) return {postId: bare[1]!.toLowerCase()}

  let u: URL
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return undefined
  }
  const host = u.hostname.toLowerCase()
  if (host === "redd.it" || host.endsWith(".redd.it")) {
    const m = u.pathname.match(new RegExp(`^/(${ID})/?$`, "i"))
    return m ? {postId: m[1]!.toLowerCase()} : undefined
  }
  if (host !== "reddit.com" && !host.endsWith(".reddit.com")) return undefined
  const p = u.pathname
  const share = p.match(/^\/(?:r|u|user)\/[^/]+\/s\/[A-Za-z0-9]+\/?$/)
  if (share) return {share: `https://www.reddit.com${p.replace(/\/$/, "")}`}
  const comments = p.match(new RegExp(`/comments/(${ID})(?:/[^/]*/(${ID})?)?`, "i"))
  if (comments) return {postId: comments[1]!.toLowerCase(), commentId: comments[2]?.toLowerCase()}
  const other = p.match(new RegExp(`^/(?:gallery|video|link)/(${ID})(?:/|$)`, "i"))
  if (other) return {postId: other[1]!.toLowerCase()}
  return undefined
}

/**
 * Unshortens a share link. Asks Arctic Shift's share-link index first; if it doesn't know the link (yet),
 * follows Reddit's redirects with browser-like headers (only the Location headers are read).
 */
export async function resolveShareLink(http: Http, shareUrl: string): Promise<{postId: string; commentId?: string; url: string}> {
  const path = new URL(shareUrl).pathname
  try {
    const r = await http.json<{data?: {resolved_path?: string}[] | null; error?: string}>(`${ARCTIC_SHIFT}/api/short_links`, {
      service: "Arctic Shift",
      query: {paths: path},
      timeoutMs: 10_000,
    })
    const resolved = r.data?.[0]?.resolved_path
    const link = resolved ? parseRedditLink(`https://www.reddit.com${resolved}`) : undefined
    if (link && "postId" in link) return {...link, url: `https://www.reddit.com${resolved}`}
  } catch (e) {
    if (!(e instanceof HttpError)) throw e
  }

  let url = shareUrl
  try {
    for (let hop = 0; hop < 5; hop++) {
      const res = await http.request(url, {
        service: "Reddit",
        headers: BROWSER_HEADERS,
        redirect: "manual",
        allowErrorStatus: true,
        discardBody: true,
        publicOnly: true,
        timeoutMs: 10_000,
      })
      const location = res.headers.get("location")
      if (res.status < 300 || res.status >= 400 || !location) break
      url = new URL(location, url).toString()
      const link = parseRedditLink(url)
      if (link && "postId" in link) return {...link, url}
      if (!link) break // redirected away from Reddit
    }
  } catch (e) {
    if (!(e instanceof HttpError)) throw e
  }
  throw new HttpError("I couldn't unshorten that share link. Open it in a browser and send me the full link instead.")
}

// ── API ────────────────────────────────────────────────────────────────────

export interface MediaMetadata {
  status?: string
  /** "Image" | "AnimatedImage" | "RedditVideo" */
  e?: string
  m?: string
  id?: string
  /** source: u = image URL, gif / mp4 for animations */
  s?: {u?: string; gif?: string; mp4?: string; x?: number; y?: number}
  /** previews, smallest first */
  p?: {u: string; x: number; y: number}[]
  dashUrl?: string
  hlsUrl?: string
  isGif?: boolean
}

export interface RedditVideo {
  fallback_url?: string
  dash_url?: string
  hls_url?: string
  duration?: number
  has_audio?: boolean
  is_gif?: boolean
  width?: number
  height?: number
}

export interface PreviewImage {
  source?: {url: string; width: number; height: number}
  resolutions?: {url: string; width: number; height: number}[]
  variants?: {mp4?: {source?: {url: string}}; gif?: {source?: {url: string}; resolutions?: {url: string; width: number}[]}}
}

export interface RedditPost {
  id: string
  title: string
  selftext?: string
  author?: string
  subreddit: string
  score?: number
  upvote_ratio?: number
  num_comments?: number
  created_utc: number
  retrieved_on?: number
  _meta?: {retrieved_2nd_on?: number}
  permalink: string
  url?: string
  url_overridden_by_dest?: string
  domain?: string
  is_self?: boolean
  is_video?: boolean
  is_gallery?: boolean
  over_18?: boolean
  spoiler?: boolean
  locked?: boolean
  link_flair_text?: string | null
  removed_by_category?: string | null
  post_hint?: string
  media?: {reddit_video?: RedditVideo} | null
  secure_media?: {reddit_video?: RedditVideo} | null
  preview?: {images?: PreviewImage[]; reddit_video_preview?: RedditVideo}
  media_metadata?: Record<string, MediaMetadata> | null
  gallery_data?: {items?: {media_id: string; caption?: string; is_deleted?: boolean}[]} | null
  crosspost_parent_list?: RedditPost[]
  poll_data?: {options?: {text: string; vote_count?: number}[]; total_vote_count?: number} | null
}

export interface RedditComment {
  id: string
  author?: string
  body?: string
  score?: number
  created_utc: number
  link_id?: string
}

type ArcticResponse<T> = {data?: T[] | null; error?: string}

async function arctic<T>(http: Http, path: string, ids: string): Promise<T | undefined> {
  const r = await http.json<ArcticResponse<T>>(`${ARCTIC_SHIFT}${path}`, {service: "Arctic Shift", query: {ids}, timeoutMs: 15_000})
  if (r.error) throw new HttpError(`Arctic Shift: ${r.error}`)
  return r.data?.[0]
}

export const fetchPost = (http: Http, id: string) => arctic<RedditPost>(http, "/api/posts/ids", id)
export const fetchComment = (http: Http, id: string) => arctic<RedditComment>(http, "/api/comments/ids", id)

// ── markdown ───────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'"}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

// private-use characters used as placeholders while converting
const B = ["", ""] as const // bold
const I = ["", ""] as const // italic
const S = ["", ""] as const // strikethrough
const H = ["", ""] as const // spoiler → SimpleX secret
const MARK: Record<string, string> = {[B[0]]: "*", [I[0]]: "_", [S[0]]: "~", [H[0]]: "#"}
const CLOSE_OF: Record<string, string> = {[B[0]]: B[1], [I[0]]: I[1], [S[0]]: S[1], [H[0]]: H[1]}
const SLOT = (n: number) => `${n}`

/** Reddit link target → absolute URL (Reddit allows /r/sub and /u/name links). */
function absolute(url: string): string {
  const u = url.trim().replace(/^<|>$/g, "").replace(/\\([_*()~])/g, "$1")
  if (/^\/?(r|u|user)\//i.test(u)) return `https://www.reddit.com/${u.replace(/^\//, "")}`
  return u
}

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)

export interface MarkdownOptions {
  /** Replace inline media links (preview.redd.it/<id>…) with a label, e.g. "🖼 image 2". */
  mediaLabel?: (mediaId: string) => string | undefined
}

/**
 * Inline Reddit markdown → SimpleX: **bold** → *bold*, *italic* → _italic_, ~~strike~~ → ~strike~,
 * >!spoiler!< → #secret#, ^superscript → plain, [text](url) → SimpleX link, escapes removed.
 *
 * SimpleX only starts formatting at the beginning of a word (after a space), and doesn't nest it, so
 * markers that can't render are dropped instead of showing up as stray characters.
 */
export function inlineToSimplex(text: string, opts: MarkdownOptions = {}): string {
  const slots: string[] = []
  const keep = (s: string) => SLOT(slots.push(s) - 1)

  let s = text
  // code spans are literal
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => keep(`\`${code.trim()}\``))
  // escaped characters are literal
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~>^|<&])/g, (_m, c: string) => keep(c))
  // images and links: ![alt](url), [text](url "title")
  s = s.replace(/!?\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m, label: string, target: string) => {
    if (/^(emote|giphy)\|/.test(target)) return keep(m.startsWith("!") ? "🎞" : "")
    const url = absolute(target)
    if (!isUrl(url)) return m
    const media = mediaIdOf(url)
    const mediaText = media && opts.mediaLabel?.(media)
    if (mediaText) return keep(mediaText)
    const t = stripInline(label).trim()
    if (!t || t === url || `https://${t}` === url || `http://${t}` === url || isUrl(t)) return keep(url)
    // SimpleX hyperlinks can't have punctuation in their text
    return keep(/[\p{P}]/u.test(t.replace(/[-_]/g, "")) ? `${t} (${url})` : `[${t}](${url})`)
  })
  // bare URLs: protect them from formatting (and label inline media)
  s = s.replace(/\bhttps?:\/\/[^\s<>()-]+[^\s<>().,;:!?'"-]/gi, (url) => {
    const media = mediaIdOf(url)
    const label = media && opts.mediaLabel?.(media)
    return keep(label ?? url.replace(/\\_/g, "_"))
  })
  // "#tag" would read as a SimpleX name link: an invisible word joiner after the "#" keeps it plain text
  s = s.replace(/(^|\s)#(?=[\p{L}\p{N}_])/gu, "$1#⁠")
  // spoilers
  s = s.replace(/>!\s*([\s\S]+?)\s*!</g, (_m, t: string) => `${H[0]}${t}${H[1]}`)
  // emphasis (strongest first)
  s = s.replace(/\*\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*\*/g, `${B[0]}$1${B[1]}`)
  s = s.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, `${B[0]}$1${B[1]}`)
  s = s.replace(/(^|[^\w])__(?!\s)([\s\S]+?)(?<!\s)__(?!\w)/g, `$1${B[0]}$2${B[1]}`)
  s = s.replace(/~~(?!\s)([\s\S]+?)(?<!\s)~~/g, `${S[0]}$1${S[1]}`)
  s = s.replace(/(^|[^\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?!\*)/g, `$1${I[0]}$2${I[1]}`)
  s = s.replace(/(^|[^\w])_(?![\s_])([^_\n]+?)(?<![\s_])_(?!\w)/g, `$1${I[0]}$2${I[1]}`)
  // superscript: ^(several words) or ^word
  s = s.replace(/\^\(([^)\n]*)\)/g, "$1").replace(/\^(?=\S)/g, "")

  s = emitFormatting(s)
  // a lone "*", "_", "~" or "#" left over can't start formatting by accident, so leave them
  return s.replace(/(\d+)/g, (_m, n: string) => slots[Number(n)] ?? "")
}

/** Placeholders → SimpleX markers, dropping spans that can't render (nested, mid-word, or empty). */
function emitFormatting(s: string): string {
  let out = ""
  let open: string | undefined // the open marker of the current span
  let span = ""
  for (const ch of s) {
    if (MARK[ch] !== undefined) {
      if (open) continue // no nesting: inner markers are dropped
      open = ch
      span = ""
      continue
    }
    if (open && ch === CLOSE_OF[open]) {
      const m = MARK[open]!
      const inner = span.trim()
      const lead = span.match(/^\s*/)![0]
      const trail = span.match(/\s*$/)![0]
      const atWordStart = out === "" || /\s$/.test(out + lead)
      out += lead + (inner && atWordStart && !inner.includes(m) ? `${m}${inner}${m}` : inner) + trail
      open = undefined
      continue
    }
    if (Object.values(CLOSE_OF).includes(ch)) continue // stray close (from a dropped nested span)
    if (open) span += ch
    else out += ch
  }
  if (open) out += span
  return out
}

/** Plain text of an inline snippet (for link labels and headings). */
function stripInline(s: string): string {
  return s.replace(/\*\*|__|~~|>!|!<|[*`]/g, "").replace(/\\(.)/g, "$1")
}

/** "abc123" for preview.redd.it/abc123.jpeg?… or i.redd.it/abc123.png. */
function mediaIdOf(url: string): string | undefined {
  return url.match(/^https?:\/\/(?:preview|i)\.redd\.it\/([a-z0-9]+)\.[a-z0-9]+/i)?.[1]
}

/**
 * Reddit markdown (posts and comments) → SimpleX markdown.
 *
 * Newer SimpleX versions render headings, lists, quotes, tables and code blocks much like Reddit does,
 * so those are kept; older apps show them as plain text, which still reads fine.
 */
export function redditToSimplex(md: string, opts: MarkdownOptions = {}): string {
  const lines = decodeEntities(md).replace(/\r\n?/g, "\n").replace(/[​‌‍﻿]/g, "").split("\n")
  const out: string[] = []
  let fence: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/[ \t]+$/, "").replace(/\\$/, "")
    const fenceMark = line.match(/^\s*(```+|~~~+)/)
    if (fence) {
      if (fenceMark && fenceMark[1]![0] === fence[0]) {
        out.push("```")
        fence = undefined
      } else out.push(lines[i]!)
      continue
    }
    if (fenceMark) {
      fence = fenceMark[1]!
      out.push("```")
      continue
    }
    // indented code block (after a blank line, not inside a list)
    if (/^( {4}|\t)/.test(line) && (out.length === 0 || out[out.length - 1]!.trim() === "") && !/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      const block: string[] = []
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]!) || (lines[i]!.trim() === "" && /^( {4}|\t)/.test(lines[i + 1] ?? "")))) {
        block.push(lines[i]!.replace(/^( {4}|\t)/, ""))
        i++
      }
      i--
      out.push("```", ...block, "```")
      continue
    }
    if (!line.trim()) {
      out.push("")
      continue
    }
    let m: RegExpMatchArray | null
    if ((m = line.match(/^ {0,3}(#{1,6})\s*(.*?)\s*#*$/)) && m[2]) {
      out.push(`${m[1]} ${stripInline(inlineToSimplex(m[2], opts))}`)
    } else if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
      out.push("──────────")
    } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
      out.push(`${m[1]}- ${inlineToSimplex(m[2]!, opts)}`)
    } else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) {
      out.push(`${m[1]}${m[2]}. ${inlineToSimplex(m[3]!, opts)}`)
    } else if ((m = line.match(/^\s*((?:>(?!!)\s?)+)(.*)$/))) {
      const depth = (m[1]!.match(/>/g) ?? []).length
      out.push(`${"> ".repeat(depth)}${inlineToSimplex(m[2]!, opts)}`.trimEnd())
    } else {
      out.push(inlineToSimplex(line, opts))
    }
  }
  if (fence) out.push("```")
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Cut long markdown at a paragraph/line boundary, closing an open code block. */
export function truncateMarkdown(s: string, max: number): {text: string; cut: boolean} {
  if (s.length <= max) return {text: s, cut: false}
  let t = s.slice(0, max)
  const para = t.lastIndexOf("\n\n")
  const line = t.lastIndexOf("\n")
  if (para > max * 0.6) t = t.slice(0, para)
  else if (line > max * 0.6) t = t.slice(0, line)
  else t = t.replace(/\s+\S*$/, "")
  if ((t.match(/^```/gm) ?? []).length % 2 === 1) t += "\n```"
  return {text: t.trimEnd(), cut: true}
}

// ── media ──────────────────────────────────────────────────────────────────

export type RedditMedia = MediaItem & {
  /** media_metadata id (for inline images in text posts). */
  mediaId?: string
}

const clean = (u: string | undefined): string | undefined => (u ? decodeEntities(u) : undefined)

/** A preview URL no wider than ~640px. */
function previewOf(images?: PreviewImage[]): string | undefined {
  const img = images?.[0]
  if (!img) return undefined
  const res = (img.resolutions ?? []).filter((r) => r.width <= 640)
  return clean(res[res.length - 1]?.url ?? img.source?.url)
}

function fromMetadata(meta: MediaMetadata | undefined, caption?: string): RedditMedia | undefined {
  if (!meta || (meta.status && meta.status !== "valid")) return undefined
  const preview = clean(meta.p?.filter((p) => p.x <= 640).pop()?.u ?? meta.p?.[0]?.u)
  if (meta.e === "AnimatedImage") {
    // GIFs play inline in SimpleX; the MP4 (much smaller) is the fallback for big ones
    const mp4 = clean(meta.s?.mp4)
    if (meta.s?.gif) return {kind: "gif", url: clean(meta.s.gif)!, caption, mediaId: meta.id, previewUrl: preview, alts: mp4 ? [{kind: "video", url: mp4}] : undefined}
    if (mp4) return {kind: "video", url: mp4, previewUrl: preview, caption, mediaId: meta.id}
    return undefined
  }
  if (meta.e === "RedditVideo" && meta.id) {
    return {kind: "video", url: "", dashUrl: clean(meta.dashUrl), previewUrl: preview, caption, mediaId: meta.id}
  }
  const url = clean(meta.s?.u) ?? (meta.id && meta.m ? `https://i.redd.it/${meta.id}.${meta.m.split("/")[1]?.replace("jpeg", "jpg")}` : undefined)
  if (!url) return undefined
  return {kind: meta.m === "image/gif" ? "gif" : "image", url, caption, mediaId: meta.id, alts: preview && preview !== url ? [{kind: "image", url: preview}] : undefined}
}

/** Fallbacks for a linked image or GIF: Reddit's MP4 version and resized previews. */
function previewAlts(images: PreviewImage[] | undefined, gif: boolean): RedditMedia["alts"] {
  const img = images?.[0]
  if (!img) return undefined
  const alts: NonNullable<RedditMedia["alts"]> = []
  const mp4 = clean(img.variants?.mp4?.source?.url)
  if (gif && mp4) alts.push({kind: "video", url: mp4})
  const smallGif = img.variants?.gif?.resolutions?.filter((r) => r.width <= 640).pop()
  if (gif && smallGif) alts.push({kind: "gif", url: clean(smallGif.url)!})
  const still = clean(img.source?.url) ?? previewOf(images)
  if (still) alts.push({kind: "image", url: still})
  return alts.length ? alts : undefined
}

const MEDIA_HOSTS = /(^|\.)(redd\.it|imgur\.com|redgifs\.com|gfycat\.com|giphy\.com|tenor\.com|catbox\.moe|discordapp\.(com|net)|twimg\.com)$/i
/** Sites whose links are pages to watch/read, not files. */
const PAGE_HOSTS = /(^|\.)(reddit\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|wikipedia\.org|github\.com|streamable\.com)$/i

/**
 * Everything attached to a post, in display order: gallery items, Reddit videos, linked images/GIFs/videos,
 * inline images in text posts, and direct links to other files. Crossposts use the original post's media.
 */
export function postMedia(post: RedditPost): RedditMedia[] {
  const src = post.crosspost_parent_list?.[0] && !post.is_self ? post.crosspost_parent_list[0] : post
  const items: RedditMedia[] = []
  const meta = src.media_metadata ?? {}

  if (src.gallery_data?.items?.length) {
    for (const it of src.gallery_data.items) {
      if (it.is_deleted) continue
      const m = fromMetadata(meta[it.media_id], it.caption)
      if (m) items.push(m)
    }
    return items
  }

  const video = src.media?.reddit_video ?? src.secure_media?.reddit_video
  if (video?.fallback_url) {
    items.push({
      kind: video.is_gif ? "gif" : "video",
      url: clean(video.fallback_url)!,
      dashUrl: video.has_audio === false || video.is_gif ? undefined : clean(video.dash_url),
      previewUrl: previewOf(src.preview?.images),
      duration: video.duration,
    })
    return items
  }

  // inline media in text posts, in the order the text mentions them
  const inline = Object.values(meta)
  if (inline.length) {
    const text = src.selftext ?? ""
    const pos = (m: MediaMetadata) => {
      const i = m.id ? text.indexOf(m.id) : -1
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    for (const m of inline.sort((a, b) => pos(a) - pos(b))) {
      const item = fromMetadata(m)
      if (item) items.push(item)
    }
  }

  const url = clean(src.url_overridden_by_dest ?? src.url)
  if (!url || src.is_self || !/^https?:\/\//i.test(url)) return items
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    return items
  }
  const ext = url.split(/[?#]/)[0]!.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
  const gifPreview = src.preview?.reddit_video_preview?.fallback_url
  if (ext === "gifv" || (gifPreview && /imgur|gfycat|redgifs/i.test(host))) {
    const mp4 = ext === "gifv" ? url.replace(/\.gifv(\?.*)?$/i, ".mp4") : clean(gifPreview)!
    items.push({kind: "video", url: mp4, previewUrl: previewOf(src.preview?.images), duration: src.preview?.reddit_video_preview?.duration})
  } else if (ext && /^(jpe?g|png|webp|avif)$/.test(ext)) {
    items.push({kind: "image", url, alts: previewAlts(src.preview?.images, false)})
  } else if (ext === "gif") {
    items.push({kind: "gif", url, previewUrl: previewOf(src.preview?.images), alts: previewAlts(src.preview?.images, true)})
  } else if (ext && /^(mp4|webm|mov|m4v)$/.test(ext)) {
    items.push({kind: "video", url, previewUrl: previewOf(src.preview?.images)})
  } else if (src.post_hint === "image") {
    items.push({kind: "image", url, alts: previewAlts(src.preview?.images, false)})
  } else if (ext && !PAGE_HOSTS.test(host) && !/^(html?|php|aspx?|jsp)$/.test(ext)) {
    // a direct link to some other file (pdf, zip, mp3, …): attach it if it really is a file
    items.push({kind: "file", url})
  } else if (MEDIA_HOSTS.test(host) && !PAGE_HOSTS.test(host)) {
    items.push({kind: "file", url})
  }
  return items
}

// ── formatting ─────────────────────────────────────────────────────────────

const pct = (r: number) => Math.round(r * 100)

/** The top of a post: title, then subreddit, author, date, flair and flags. */
export function postHeader(post: RedditPost, now = Date.now()): string {
  const created = post.created_utc * 1000
  const flags = [
    post.link_flair_text ? `🏷 ${decodeEntities(post.link_flair_text).trim()}` : undefined,
    post.over_18 ? fmt.color("red", "NSFW") : undefined,
    post.spoiler ? fmt.color("yellow", "Spoiler") : undefined,
    post.locked ? "🔒 Locked" : undefined,
  ].filter(Boolean)
  return fmt.lines(
    `# ${decodeEntities(post.title).replace(/\s+/g, " ").trim()}`,
    [fmt.color("magenta", `r/${post.subreddit}`), `u/${post.author ?? "[deleted]"}`, fmt.when(created, now), ...flags].join(" · ")
  )
}

/** The bottom of a post: upvotes, upvote ratio, comments. */
export function postStats(post: RedditPost, now = Date.now()): string {
  const created = post.created_utc * 1000
  const ratio = post.upvote_ratio
  const ratioColor = ratio === undefined ? undefined : ratio >= 0.8 ? "green" : ratio >= 0.6 ? "yellow" : "red"
  // Arctic Shift saves a post when it's made and refreshes it ~36h later; until then scores read 0-1
  const early = !post._meta?.retrieved_2nd_on && (post.retrieved_on ?? 0) - post.created_utc < 36 * 3600 && now - created < 7 * 86400_000
  const score = [
    `⬆️ ${fmt.bold(fmt.num(post.score ?? 0, 0))} ${post.score === 1 ? "upvote" : "upvotes"}`,
    ratio !== undefined ? fmt.color(ratioColor as fmt.Color, `${pct(ratio)}% upvoted`) : undefined,
    `💬 ${fmt.num(post.num_comments ?? 0, 0)} ${post.num_comments === 1 ? "comment" : "comments"}`,
  ]
    .filter(Boolean)
    .join(" · ")
  return early ? `${score} ${fmt.italic("(early snapshot)")}` : score
}

/** Why a post has no text: removed by mods, deleted by its author… */
export function removalNote(post: RedditPost): string | undefined {
  const body = post.selftext?.trim()
  if (post.removed_by_category === "deleted" || body === "[deleted]") return fmt.color("red", "Deleted by its author")
  if (post.removed_by_category || body === "[removed]") return fmt.color("red", "Removed by the moderators")
  return undefined
}

export function pollText(post: RedditPost): string | undefined {
  const opts = post.poll_data?.options
  if (!opts?.length) return undefined
  const total = post.poll_data?.total_vote_count ?? opts.reduce((n, o) => n + (o.vote_count ?? 0), 0)
  return fmt.lines(
    `📊 ${fmt.bold("Poll")}${total ? ` · ${fmt.plural(total, "vote")}` : ""}`,
    ...opts.map((o) => (o.vote_count !== undefined && total ? `- ${o.text}: ${o.vote_count} (${pct(o.vote_count / total)}%)` : `- ${o.text}`))
  )
}
