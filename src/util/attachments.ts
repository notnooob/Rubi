import {rename} from "node:fs/promises"
import path from "node:path"
import type {T} from "@simplex-chat/types"
import type {CommandContext} from "../core/context"
import type {FileGroup} from "../core/files"
import {HttpError} from "../core/http"
import {roleAtLeast} from "../core/permissions"
import {extensionFor, hasFfmpeg, mediaDir, mergeAudio, placeholderThumbnail, thumbnail, videoFrame} from "./media"

/**
 * Downloading media from the web and sending it as SimpleX attachments (used by /reddit and /x).
 *
 *   const dl = await downloadAttachments(ctx, items, {label: "x-123", onProgress})
 *   const post = await ctx.reply(text)
 *   await sendAttachments(ctx, dl, post.itemId)
 *
 * Files are temporary: they're deleted a minute after SimpleX finishes uploading them (see `TempFiles`).
 */

export interface MediaItem {
  /** What it most likely is; the real type is decided by the downloaded file's content type. */
  kind: "image" | "gif" | "video" | "file"
  url: string
  /** Other copies to try, in order, if this one is gone (404) or too big: smaller versions, a GIF's MP4… */
  alts?: {kind: MediaItem["kind"]; url: string}[]
  /** DASH playlist: where to find the separate audio track (and the video, if `url` is empty). */
  dashUrl?: string
  /** A preview image URL (for videos). */
  previewUrl?: string
  /** Video length in seconds. */
  duration?: number
  caption?: string
}

export interface Downloaded {
  /** Ready-to-send messages, in the order of the items (failed ones left out). */
  messages: T.ComposedMessage[]
  /** User-facing notes about what went wrong ("🔇 …", "🗑 …"). */
  notes: Set<string>
  files: FileGroup
}

export interface DownloadOptions {
  /** Folder name prefix, e.g. "reddit-abc123". */
  label: string
  /** Request headers for the media hosts. */
  headers?: Record<string, string>
  /** Used in error messages. */
  service?: string
  onProgress?: (done: number, total: number) => void
}

/** Big GIFs are heavy to receive; past this size the MP4 version (if there is one) is used. */
const MAX_GIF_BYTES = 10 * 1024 * 1024

/** Download items (3 at a time) and build the SimpleX messages for them. */
export async function downloadAttachments(ctx: CommandContext, items: MediaItem[], opts: DownloadOptions): Promise<Downloaded> {
  const cfg = ctx.config.media
  const dir = await mediaDir(cfg.dir, opts.label)
  const files = ctx.rt.tempFiles.group(dir)
  const notes = new Set<string>()
  const ffmpeg = (await hasFfmpeg(cfg.ffmpeg)) ? cfg.ffmpeg : ""
  let done = 0
  try {
    const prepared = await mapLimit(items, 3, async (item, i) => {
      try {
        return await prepare(ctx, item, i, dir, ffmpeg, notes, opts)
      } catch (e) {
        if (ctx.signal.aborted) throw e
        ctx.log.debug(`${opts.label}: media ${i + 1} failed:`, (e as Error).message)
        notes.add(
          e instanceof HttpError && /too big/.test(e.message)
            ? "⚠️ Some media was too big to send."
            : e instanceof HttpError && (e.status === 404 || e.status === 410)
              ? "🗑 Some media has been deleted."
              : "⚠️ Some media couldn't be downloaded."
        )
        return undefined
      } finally {
        opts.onProgress?.(++done, items.length)
      }
    })
    const messages = prepared.filter((p): p is T.ComposedMessage => !!p)
    if (!messages.length) files.purge()
    return {messages, notes, files}
  } catch (e) {
    files.purge()
    throw e
  }
}

/**
 * Send downloaded attachments in one batch (the first quotes `quote`). Their files are deleted once uploaded,
 * or right away if sending fails. Returns false if sending failed.
 */
export async function sendAttachments(ctx: CommandContext, dl: Downloaded, quote?: number): Promise<boolean> {
  if (!dl.messages.length) return true
  const messages = dl.messages.map((m, i) => (i === 0 && quote ? {...m, quotedItemId: quote} : m))
  try {
    const items = await ctx.rt.messenger.sendComposed(ctx.ref, messages)
    dl.files.sent(items.map((it) => it.chatItem.meta.itemId))
    return true
  } catch (e) {
    ctx.log.warn("sending attachments failed:", (e as Error).message)
    dl.files.purge()
    return false
  }
}

/** Why attachments can't be sent in this chat (files turned off for the bot's role in a group), if so. */
export function attachmentsBlocked(ctx: CommandContext): string | undefined {
  const files = ctx.group?.fullGroupPreferences?.files
  if (files && (files.enable === "off" || (files.role && !roleAtLeast(ctx.botRole, files.role)))) {
    return "📎 Files are turned off in this group, so I can't attach the media."
  }
  return undefined
}

/** "4 images", "a video", "2 attachments"… from media kinds or message types. */
export function describeMedia(kinds: string[]): string {
  const set = new Set(kinds.map((k) => (k === "gif" ? "image" : k)))
  const word = set.size === 1 ? [...set][0]! : "attachment"
  return kinds.length === 1 ? `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}` : `${kinds.length} ${word}s`
}

/** Download one item and build its message. */
async function prepare(
  ctx: CommandContext,
  item: MediaItem,
  i: number,
  dir: string,
  ffmpeg: string,
  notes: Set<string>,
  o: DownloadOptions
): Promise<T.ComposedMessage | undefined> {
  const http = ctx.http
  const max = ctx.config.media.maxFileBytes
  const opts = {headers: o.headers, publicOnly: true, maxBytes: max, timeoutMs: 120_000, service: o.service ?? "Media"}

  // some videos keep their audio in a separate track, listed in a DASH playlist
  let url = item.url
  let audioUrl: string | undefined
  if (item.dashUrl) {
    const mpd = await http.text(item.dashUrl, {...opts, maxBytes: 1024 * 1024, timeoutMs: 15_000}).catch(() => "")
    url ||= dashVideoUrl(mpd, item.dashUrl) ?? ""
    audioUrl = dashAudioUrl(mpd, item.dashUrl)
  }
  if (!url) return undefined

  // the original first, then the fallbacks if it's gone or too big
  const candidates = [{kind: item.kind, url}, ...(item.alts ?? [])]
  const tmp = path.join(dir, `${i + 1}.part`)
  let got: Awaited<ReturnType<typeof http.download>>
  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c]!
    const maxBytes = cand.kind === "gif" && c < candidates.length - 1 ? Math.min(MAX_GIF_BYTES, max) : max
    try {
      got = await http.download(cand.url, tmp, {...opts, maxBytes, accept: (ct) => !/^(text\/html|application\/xhtml)/.test(ct)})
      break
    } catch (e) {
      const retry = e instanceof HttpError && (e.status === 404 || e.status === 403 || e.status === 410 || /too big/.test(e.message))
      if (!retry || c === candidates.length - 1) throw e
    }
  }
  if (!got) return undefined // a web page, not a file
  let file = path.join(dir, `${i + 1}${extensionFor(got.contentType, got.url)}`)
  await rename(tmp, file)
  const type = got.contentType
  const caption = item.caption?.trim() ?? ""
  const attach = (msgContent: T.MsgContent): T.ComposedMessage => ({msgContent, fileSource: {filePath: file}, mentions: {}})

  const isVideo = type.startsWith("video/") || (item.kind === "video" && !type.startsWith("image/"))
  if (isVideo) {
    if (audioUrl) {
      if (!ffmpeg) notes.add("🔇 Videos are sent without sound: install ffmpeg on Rubi's server to add it.")
      else {
        const audio = path.join(dir, `${i + 1}-audio.mp4`)
        const merged = path.join(dir, `${i + 1}-sound.mp4`)
        try {
          if (await http.download(audioUrl, audio, opts)) {
            await mergeAudio(ffmpeg, file, audio, merged, ctx.signal)
            file = merged
          }
        } catch (e) {
          ctx.log.debug("adding audio failed:", (e as Error).message)
          notes.add("🔇 I couldn't add the sound to a video.")
        }
      }
    }
    const image = await videoPreview(ctx, item, file, dir, i, ffmpeg, o.headers)
    return image ? attach({type: "video", text: caption, image, duration: Math.round(item.duration ?? 0)}) : attach({type: "file", text: caption})
  }
  if (type.startsWith("image/")) {
    const image = await thumbnail(file)
    if (image) return attach({type: "image", text: caption, image})
  }
  return attach({type: "file", text: caption})
}

async function videoPreview(ctx: CommandContext, item: MediaItem, file: string, dir: string, i: number, ffmpeg: string, headers?: Record<string, string>): Promise<string | undefined> {
  if (item.previewUrl) {
    try {
      const res = await ctx.http.request(item.previewUrl, {headers, publicOnly: true, maxBytes: 5 * 1024 * 1024, service: "Media"})
      const t = await thumbnail(res.body)
      if (t) return t
    } catch {
      /* try the next way */
    }
  }
  if (ffmpeg) {
    const frame = path.join(dir, `${i + 1}-frame.jpg`)
    try {
      await videoFrame(ffmpeg, file, frame, ctx.signal)
      const t = await thumbnail(frame)
      if (t) return t
    } catch {
      /* no frame */
    }
  }
  return placeholderThumbnail()
}

/** Best audio track listed in a DASH playlist (absolute URL), if any. */
export function dashAudioUrl(mpd: string, dashUrl: string): string | undefined {
  const bases = [...mpd.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => decodeXml(m[1]!.trim()))
  const audio = bases
    .filter((b) => /audio/i.test(b))
    .sort((a, b) => Number(b.match(/(\d+)/)?.[1] ?? 0) - Number(a.match(/(\d+)/)?.[1] ?? 0))[0]
  return audio ? new URL(audio, dashUrl).toString() : undefined
}

/** Best video track (≤ maxHeight) in a DASH playlist, for videos that only have a playlist. */
export function dashVideoUrl(mpd: string, dashUrl: string, maxHeight = 720): string | undefined {
  const reps = [...mpd.matchAll(/<Representation\b([^>]*)>[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/g)]
    .map((m) => ({height: Number(m[1]!.match(/height="(\d+)"/)?.[1] ?? 0), base: decodeXml(m[2]!.trim())}))
    .filter((r) => r.height > 0 && r.height <= maxHeight && !/audio/i.test(r.base))
    .sort((a, b) => b.height - a.height)
  return reps[0] ? new URL(reps[0].base, dashUrl).toString() : undefined
}

const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')

/** Like Promise.all(items.map(fn)), with at most `limit` running at once. Keeps the order. */
export async function mapLimit<A, B>(items: A[], limit: number, fn: (item: A, i: number) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
  return out
}
