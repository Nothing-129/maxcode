import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"

// Reuse Next's image encoder; no platform-specific icon tools are needed.
const require = createRequire(import.meta.url)
const sharp = createRequire(require.resolve("next/package.json"))("sharp")
const root = new URL("../", import.meta.url)
const icns = await readFile(new URL("src-tauri/icons/icon.icns", root))
let master
for (let offset = 8; offset < icns.length; ) {
  const length = icns.readUInt32BE(offset + 4)
  if (length < 8 || offset + length > icns.length) {
    throw new Error("Invalid ICNS chunk")
  }
  if (icns.toString("ascii", offset, offset + 4) === "ic10") {
    master = icns.subarray(offset + 8, offset + length)
  }
  offset += length
}
if (!master) throw new Error("Missing branded 1024px ICNS master")

// Keep the Mac artwork and its real alpha, with less desktop-specific padding.
// Never derive this from icon.png: that legacy image has an opaque white matte.
const { data, info } = await sharp(master)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
let left = info.width,
  top = info.height,
  right = 0,
  bottom = 0
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 0) {
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
}
const artwork = await sharp(master)
  .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
  .png()
  .toBuffer()
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const frames = []
for (const size of sizes) {
  const inset = Math.max(1, Math.round(size * 0.035))
  frames.push(
    await sharp(artwork)
      .resize(size - inset * 2, size - inset * 2, {
        fit: "contain",
        background: "#00000000",
      })
      .extend({
        top: inset,
        bottom: inset,
        left: inset,
        right: inset,
        background: "#00000000",
      })
      .png()
      .toBuffer()
  )
}
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16
  header[entry] = header[entry + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frames[index].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frames[index].length
}
await writeFile(
  new URL("src-tauri/icons/icon.ico", root),
  Buffer.concat([header, ...frames])
)
console.log(`Generated transparent Windows icon: ${sizes.join(", ")}px`)
