const UPDATE_REPOSITORY = "https://github.com/Nothing-129/maxcode"

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

function updateManifestName(os, arch) {
  return `latest-${arch}${os === "mac" ? "-mac" : os === "linux" ? "-linux" : ""}.yml`
}

module.exports = { UPDATE_REPOSITORY, updateFeed, updateManifestName }
