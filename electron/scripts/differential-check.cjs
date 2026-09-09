/* eslint-disable @typescript-eslint/no-require-imports */
// Local-only transfer verification using the same pinned downloader as the app.
const { createRequire } = require("node:module")
const { createHash } = require("node:crypto")
const { createServer, request } = require("node:http")
const { createReadStream, createWriteStream, promises: fs } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { pipeline } = require("node:stream/promises")
const updaterRequire = createRequire(
  require.resolve("electron-updater/package.json")
)
const { AppUpdater } = updaterRequire("./out/AppUpdater.js")
const { HttpExecutor, CancellationToken } = updaterRequire(
  "builder-util-runtime"
)

class LocalExecutor extends HttpExecutor {
  createRequest(options, callback) {
    if (options.hostname !== "127.0.0.1")
      throw new Error("Only loopback test downloads are allowed")
    return request({ ...options, agent: false }, callback)
  }
}

async function hash(file) {
  const value = createHash("sha512")
  for await (const bytes of createReadStream(file)) value.update(bytes)
  return value.digest("base64")
}

async function verifyDifferential({
  oldFile,
  newFile,
  oldBlockmap,
  newBlockmap,
  missingCache = false,
  brokenBlockmap = false,
}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "maxcode-differential-"))
  let rangeBytes = 0
  let fullBytes = 0
  let blockmapBytes = 0
  const size = (await fs.stat(newFile)).size
  const sha512 = await hash(newFile)
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url === "/old.blockmap" || req.url === "/new.blockmap") {
        const data =
          req.url === "/old.blockmap" && brokenBlockmap
            ? Buffer.from("broken")
            : await fs.readFile(
                req.url === "/old.blockmap" ? oldBlockmap : newBlockmap
              )
        blockmapBytes += data.length
        res.writeHead(200, { "Content-Length": data.length })
        res.end(data)
        return
      }
      if (req.url !== "/new.zip") {
        res.writeHead(404)
        res.end()
        return
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "")
      const start = range ? Number(range[1]) : 0
      const end = range ? Number(range[2]) : size - 1
      if (start > end || end >= size) {
        res.writeHead(416)
        res.end()
        return
      }
      if (range) rangeBytes += end - start + 1
      else fullBytes += size
      res.writeHead(range ? 206 : 200, {
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      })
      await pipeline(createReadStream(newFile, { start, end }), res)
    })().catch(() => res.destroy())
  })
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const base = `http://127.0.0.1:${server.address().port}`
    const provider = {
      getBlockMapFiles: async () => [
        new URL(`${base}/old.blockmap`),
        new URL(`${base}/new.blockmap`),
      ],
      isUseMultipleRangeRequest: false,
    }
    if (!missingCache) await fs.copyFile(oldFile, join(directory, "update.zip"))
    const output = join(directory, "result.zip")
    const messages = []
    const fallback =
      await AppUpdater.prototype.differentialDownloadInstaller.call(
        {
          app: { version: "0.30.6" },
          httpExecutor: new LocalExecutor(),
          downloadedUpdateHelper: {
            cacheDir: directory,
            cacheDirForPendingUpdate: join(directory, "pending"),
          },
          _logger: {
            info: (text) => messages.push(text),
            error: (text) => messages.push(text),
            warn: (text) => messages.push(text),
          },
          listenerCount: () => 0,
        },
        { url: new URL(`${base}/new.zip`), info: { size, sha512 } },
        {
          updateInfoAndProvider: { provider, info: { version: "0.30.7" } },
          cancellationToken: new CancellationToken(),
        },
        output,
        provider,
        "update.zip"
      )
    // Same fallback branch used by MacUpdater/NSIS after differential failure.
    if (fallback) {
      const response = await fetch(`${base}/new.zip`)
      if (!response.ok)
        throw new Error(`Full download failed: ${response.status}`)
      await pipeline(response.body, createWriteStream(output))
    }
    if ((await hash(output)) !== sha512)
      throw new Error("Reconstructed installer checksum mismatch")
    return {
      size,
      rangeBytes,
      fullBytes,
      blockmapBytes,
      fallback,
      verified: true,
      messages,
    }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
}

module.exports = { verifyDifferential }

if (require.main === module) {
  const [oldFile, newFile] = process.argv.slice(2)
  if (!oldFile || !newFile)
    throw new Error(
      "Usage: node electron/scripts/differential-check.cjs old.zip new.zip (with adjacent .blockmap files)"
    )
  verifyDifferential({
    oldFile,
    newFile,
    oldBlockmap: `${oldFile}.blockmap`,
    newBlockmap: `${newFile}.blockmap`,
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
