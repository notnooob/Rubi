import {execFile} from "node:child_process"
import {mkdir, readdir, rm, stat} from "node:fs/promises"
import path from "node:path"
import {randomBytes} from "node:crypto"
import type * as SharpNS from "sharp"

/**
 * Media helpers for sending downloaded files as SimpleX attachments:
 * - `thumbnail()` makes the small inline preview every image/video message needs (a data: URI, see below)
 * - `mergeAudio()` muxes a separate audio track into a video with ffmpeg (Reddit stores them apart)
 * - `mediaDir()` / `sweepMedia()` manage per-request download folders
 *
 * sharp and ffmpeg are both optional: without sharp, images go out as plain files; without ffmpeg,
 * Reddit videos have no sound.
 */

/** SimpleX previews must stay under ~12.5K chars as a data URI, and use exactly this prefix (not "image/jpeg"). */
export const THUMB_PREFIX = "data:image/jpg;base64,"
const MAX_THUMB_URI = 12_000

type Sharp = typeof SharpNS
let sharpMod: Sharp | null | undefined
function loadSharp(): Sharp | null {
  if (sharpMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharpMod = require("sharp") as Sharp
    } catch {
      sharpMod = null
    }
  }
  return sharpMod
}

/** Whether thumbnails can be made (sharp is installed). */
export const canThumbnail = (): boolean => loadSharp() !== null

/**
 * Small JPEG preview of an image file or buffer (first frame for GIFs), as a SimpleX-ready data URI.
 * Returns undefined if sharp is missing or the image can't be read.
 */
export async function thumbnail(input: string | Buffer): Promise<string | undefined> {
  const sharp = loadSharp()
  if (!sharp) return undefined
  try {
    for (const size of [320, 256, 192, 128]) {
      for (const quality of [70, 55, 40]) {
        const jpg = await (sharp as any)(input, {animated: false, failOn: "none"})
          .rotate()
          .resize(size, size, {fit: "inside", withoutEnlargement: true})
          .flatten({background: "#1a1028"})
          .jpeg({quality, progressive: false, mozjpeg: false})
          .toBuffer()
        const uri = THUMB_PREFIX + jpg.toString("base64")
        if (uri.length <= MAX_THUMB_URI) return uri
      }
    }
  } catch {
    /* not an image sharp understands */
  }
  return undefined
}

/** Image size (for picking how to send it). */
export async function imageInfo(file: string): Promise<{width: number; height: number; format: string} | undefined> {
  const sharp = loadSharp()
  if (!sharp) return undefined
  try {
    const m = await (sharp as any)(file).metadata()
    return {width: m.width ?? 0, height: m.height ?? 0, format: m.format ?? ""}
  } catch {
    return undefined
  }
}

/** A plain dark tile, for videos without any preview image (undefined without sharp). */
export async function placeholderThumbnail(): Promise<string | undefined> {
  const sharp = loadSharp()
  if (!sharp) return undefined
  try {
    const jpg = await (sharp as any)({create: {width: 160, height: 90, channels: 3, background: "#2a1740"}}).jpeg({quality: 60}).toBuffer()
    return THUMB_PREFIX + jpg.toString("base64")
  } catch {
    return undefined
  }
}

// ── ffmpeg ─────────────────────────────────────────────────────────────────

const ffmpegChecks = new Map<string, Promise<boolean>>()

/** Whether `bin` runs (checked once per path). */
export function hasFfmpeg(bin: string): Promise<boolean> {
  if (!bin) return Promise.resolve(false)
  let p = ffmpegChecks.get(bin)
  if (!p) {
    p = new Promise((resolve) => execFile(bin, ["-version"], {timeout: 10_000, windowsHide: true}, (e) => resolve(!e)))
    ffmpegChecks.set(bin, p)
  }
  return p
}

function run(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, {timeout: 120_000, windowsHide: true, signal, maxBuffer: 4 * 1024 * 1024}, (e) => (e ? reject(e) : resolve()))
  })
}

/** Copy video + audio streams into one MP4 (no re-encoding). */
export async function mergeAudio(bin: string, video: string, audio: string, out: string, signal?: AbortSignal): Promise<void> {
  await run(bin, ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", "-movflags", "+faststart", out], signal)
}

/** Grab one frame of a video as a JPEG file (for a preview when the source has none). */
export async function videoFrame(bin: string, video: string, out: string, signal?: AbortSignal): Promise<void> {
  await run(bin, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", video, "-frames:v", "1", "-q:v", "4", out], signal)
}

// ── download folders ───────────────────────────────────────────────────────

/** A fresh folder under `root` for one request's downloads, e.g. storage/media/reddit-17snc7d-3fa9c1. */
export async function mediaDir(root: string, label: string): Promise<string> {
  const dir = path.join(root, `${label.replace(/[^a-z0-9_-]/gi, "").slice(0, 40)}-${randomBytes(3).toString("hex")}`)
  await mkdir(dir, {recursive: true})
  return dir
}

/**
 * Delete download folders older than `maxAgeMs`. Normally `TempFiles` deletes each folder once its uploads finish;
 * this catches leftovers (Rubi runs it with 0 on start, when no upload from a previous run can still need them).
 */
export async function sweepMedia(root: string, maxAgeMs = 3600_000): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  const cutoff = Date.now() - maxAgeMs
  await Promise.all(
    entries.map(async (name) => {
      const p = path.join(root, name)
      try {
        if ((await stat(p)).mtimeMs < cutoff) await rm(p, {recursive: true, force: true})
      } catch {
        /* already gone */
      }
    })
  )
}

/** File extension for a MIME type (falls back to the URL's extension, then ".bin"). */
export function extensionFor(contentType: string, url = ""): string {
  const known: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
  }
  if (known[contentType]) return known[contentType]!
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext
  } catch {
    /* not a URL */
  }
  return ".bin"
}
