#!/usr/bin/env node
// Renders assets/avatar.svg into:
//   assets/avatar.png       — 512px square, full quality (for sharing / app stores)
//   assets/avatar-round.png — 512px circle with transparent corners (README: GitHub strips CSS, so it must be baked in)
//   assets/avatar.jpg — the profile picture Rubi uses (RUBI_AVATAR), compressed so its
//                       data: URI fits SimpleX's profile image budget (~12.5K chars, like the apps)
// Usage: npm run avatar
import {readFile, writeFile} from "node:fs/promises"
import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"
import sharp from "sharp"

const MAX_DATA_URI = 12_500
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const svg = await readFile(join(root, "assets", "avatar.svg"))

const png = await sharp(svg, {density: 144}).resize(512, 512).png({compressionLevel: 9}).toBuffer()
await writeFile(join(root, "assets", "avatar.png"), png)

// circle mask: keep only pixels inside the circle
const circle = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="256"/></svg>')
const round = await sharp(png).ensureAlpha().composite([{input: circle, blend: "dest-in"}]).png({compressionLevel: 9}).toBuffer()
await writeFile(join(root, "assets", "avatar-round.png"), round)

let best
search: for (const size of [256, 240, 224, 208, 192, 176, 160, 144, 128]) {
  for (let quality = 92; quality >= 50; quality -= 4) {
    // plain baseline JPEG, like the SimpleX apps produce (no mozjpeg: it forces progressive)
    const jpg = await sharp(png).resize(size, size).jpeg({quality, progressive: false, optimiseCoding: true, chromaSubsampling: "4:4:4"}).toBuffer()
    // the data URI prefix is "data:image/jpg;base64," — SimpleX apps expect "jpg", not "jpeg"
    const uriLen = "data:image/jpg;base64,".length + Math.ceil(jpg.length / 3) * 4
    if (uriLen <= MAX_DATA_URI) {
      best = {size, quality, jpg, uriLen}
      break search
    }
  }
}
if (!best) throw new Error("could not compress avatar under the size budget")
await writeFile(join(root, "assets", "avatar.jpg"), best.jpg)
console.log(`assets/avatar.png  512px  ${png.length} bytes`)
console.log(`assets/avatar-round.png  512px  ${round.length} bytes`)
console.log(`assets/avatar.jpg  ${best.size}px q${best.quality}  ${best.jpg.length} bytes (data URI ${best.uriLen}/${MAX_DATA_URI})`)
