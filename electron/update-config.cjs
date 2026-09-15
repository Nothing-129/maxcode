const UPDATE_REPOSITORY = "https://github.com/Nothing-129/maxcode"
const UPDATE_MIRROR = "https://maxcode-update.aifalao.net"
const GITHUB_SLOW_MS = 800
const SOURCE_PROBE_TIMEOUT_MS = 1500

function updateFeed(arch = process.arch) {
  if (!["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported update architecture: ${arch}`)
  return {
    provider: "github",
    owner: "Nothing-129",
    repo: "maxcode",
    channel: `latest-${arch}`,
  }
}

function mirrorFeed(arch = process.arch) {
  if (!["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported update architecture: ${arch}`)
  return {
    provider: "generic",
    url: UPDATE_MIRROR,
    channel: `latest-${arch}`,
  }
}

function updateSources(arch = process.arch, version) {
  if (!version) throw new Error("Update source list requires the running version")
  return [
    {
      feed: updateFeed(arch),
      blockmap: `${UPDATE_REPOSITORY}/releases/download/v${version}/`,
    },
    {
      feed: mirrorFeed(arch),
      blockmap: `${UPDATE_MIRROR}/download/v${version}/`,
    },
  ]
}

function updateManifestName(os, arch) {
  return `latest-${arch}${os === "mac" ? "-mac" : os === "linux" ? "-linux" : ""}.yml`
}

function updateOs(platform = process.platform) {
  if (platform === "darwin") return "mac"
  if (platform === "linux") return "linux"
  return "win"
}

function sourceProbeUrls(arch = process.arch, platform = process.platform) {
  const name = updateManifestName(updateOs(platform), arch)
  return {
    github: `${UPDATE_REPOSITORY}/releases/latest/download/${name}`,
    mirror: `${UPDATE_MIRROR}/${name}`,
  }
}

function orderUpdateSources(sources, { github, mirror }) {
  const [githubSource, mirrorSource] = sources
  if (github == null) return [mirrorSource, githubSource]
  if (mirror == null) return [githubSource, mirrorSource]
  if (github >= GITHUB_SLOW_MS && github > mirror)
    return [mirrorSource, githubSource]
  return [githubSource, mirrorSource]
}

module.exports = {
  UPDATE_REPOSITORY,
  UPDATE_MIRROR,
  GITHUB_SLOW_MS,
  SOURCE_PROBE_TIMEOUT_MS,
  updateFeed,
  mirrorFeed,
  updateSources,
  updateManifestName,
  updateOs,
  sourceProbeUrls,
  orderUpdateSources,
}
