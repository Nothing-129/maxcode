#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const DEFAULT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_MANIFEST = "config/maxcode-upstream-hotspots.json"
const CONTRACT_DIRECTORY = "src/maxcode-contracts"
const CONTRACT_PATTERN = /\.contract\.test\.[cm]?[jt]sx?$/
const HOTSPOT_CATEGORIES = new Set([
  "branding",
  "maintenance",
  "platform",
  "product",
  "release",
  "runtime",
])

function usage() {
  return `Usage: node scripts/check-upstream-impact.mjs [options]

Detect semantic-risk areas before merging a new upstream revision. The check
blocks when an incoming upstream change either:
  1. touches a file changed by MaxCode since the common base; or
  2. touches a declared behavior hotspot from the manifest.

Options:
  --head <ref>         Incoming upstream ref (default: upstream/main)
  --downstream <ref>   MaxCode ref to compare (default: HEAD)
  --base <ref>         Common base override (default: git merge-base)
  --repo <path>        Repository root (default: this script's repository)
  --manifest <path>    Hotspot manifest, relative to repo root
  --validate-only      Validate the manifest without inspecting Git history
  --help               Show this help

Run this on a clean integration branch before the upstream merge commit.`
}

function parseArgs(argv) {
  const options = {
    repo: DEFAULT_REPO,
    manifest: DEFAULT_MANIFEST,
    head: "upstream/main",
    downstream: "HEAD",
    base: null,
    validateOnly: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help") {
      console.log(usage())
      process.exit(0)
    }
    if (arg === "--validate-only") {
      options.validateOnly = true
      continue
    }

    const key = {
      "--repo": "repo",
      "--manifest": "manifest",
      "--head": "head",
      "--downstream": "downstream",
      "--base": "base",
    }[arg]
    if (!key) throw new Error(`Unknown option: ${arg}\n\n${usage()}`)

    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`)
    }
    options[key] = value
    index += 1
  }

  options.repo = resolve(options.repo)
  return options
}

function manifestPath(repo, requestedPath) {
  return isAbsolute(requestedPath)
    ? requestedPath
    : resolve(repo, requestedPath)
}

function isSafeRepoRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    return false
  }
  const normalized = value.replaceAll("\\", "/")
  return normalized !== ".." && !normalized.startsWith("../")
}

function loadManifest(repo, requestedPath) {
  const path = manifestPath(repo, requestedPath)
  if (!existsSync(path)) throw new Error(`Hotspot manifest not found: ${path}`)

  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error.message}`)
  }

  if (
    manifest?.version !== 2 ||
    !Array.isArray(manifest.hotspots) ||
    !Array.isArray(manifest.retired)
  ) {
    throw new Error(
      `${path} must contain version 2, a hotspots array, and a retired array`
    )
  }
  if (manifest.hotspots.length === 0) {
    throw new Error(`${path} must declare at least one MaxCode hotspot`)
  }

  const ids = new Set()
  for (const hotspot of manifest.hotspots) {
    if (!hotspot || typeof hotspot !== "object") {
      throw new Error(`${path} contains a non-object hotspot`)
    }
    if (typeof hotspot.id !== "string" || hotspot.id.length === 0) {
      throw new Error(`${path} contains a hotspot without an id`)
    }
    if (ids.has(hotspot.id)) {
      throw new Error(`${path} contains duplicate hotspot id: ${hotspot.id}`)
    }
    ids.add(hotspot.id)

    if (!HOTSPOT_CATEGORIES.has(hotspot.category)) {
      throw new Error(`${hotspot.id} has an invalid category`)
    }
    if (!Array.isArray(hotspot.origins) || hotspot.origins.length === 0) {
      throw new Error(`${hotspot.id}.origins must be a non-empty array`)
    }
    for (const origin of hotspot.origins) {
      if (typeof origin !== "string" || origin.length === 0) {
        throw new Error(`${hotspot.id}.origins contains an invalid value`)
      }
    }

    if (
      typeof hotspot.description !== "string" ||
      hotspot.description.length === 0
    ) {
      throw new Error(`${hotspot.id} must have a description`)
    }
    for (const field of ["paths", "contracts"]) {
      const values = hotspot[field]
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`${hotspot.id}.${field} must be a non-empty array`)
      }
      for (const value of values) {
        if (!isSafeRepoRelativePath(value)) {
          throw new Error(`${hotspot.id}.${field} has unsafe path: ${value}`)
        }
      }
    }

    for (const contract of hotspot.contracts) {
      if (
        !contract.startsWith(`${CONTRACT_DIRECTORY}/`) ||
        !CONTRACT_PATTERN.test(contract)
      ) {
        throw new Error(
          `${hotspot.id} contract must be an independent MaxCode contract test: ${contract}`
        )
      }
      if (!existsSync(resolve(repo, contract))) {
        throw new Error(`${hotspot.id} contract does not exist: ${contract}`)
      }
    }
    for (const implementationPath of hotspot.paths) {
      if (!existsSync(resolve(repo, implementationPath))) {
        throw new Error(
          `${hotspot.id} implementation path does not exist: ${implementationPath}`
        )
      }
    }
  }

  for (const retired of manifest.retired) {
    if (!retired || typeof retired !== "object") {
      throw new Error(`${path} contains a non-object retired customization`)
    }
    if (typeof retired.id !== "string" || retired.id.length === 0) {
      throw new Error(`${path} contains a retired customization without an id`)
    }
    if (ids.has(retired.id)) {
      throw new Error(
        `${path} contains duplicate customization id: ${retired.id}`
      )
    }
    ids.add(retired.id)
    if (retired.status !== "retired") {
      throw new Error(`${retired.id}.status must be retired`)
    }
    if (!HOTSPOT_CATEGORIES.has(retired.category)) {
      throw new Error(`${retired.id} has an invalid category`)
    }
    for (const field of ["description", "reason"]) {
      if (typeof retired[field] !== "string" || retired[field].length === 0) {
        throw new Error(`${retired.id} must have a ${field}`)
      }
    }
    if (!Array.isArray(retired.origins) || retired.origins.length === 0) {
      throw new Error(`${retired.id}.origins must be a non-empty array`)
    }
  }

  const referencedContracts = new Set(
    manifest.hotspots.flatMap((hotspot) => hotspot.contracts)
  )
  const unregisteredContracts = readdirSync(resolve(repo, CONTRACT_DIRECTORY))
    .filter((file) => CONTRACT_PATTERN.test(file))
    .map((file) => `${CONTRACT_DIRECTORY}/${file}`)
    .filter((contract) => !referencedContracts.has(contract))
  if (unregisteredContracts.length > 0) {
    throw new Error(
      `Unregistered MaxCode contract(s): ${unregisteredContracts.join(", ")}`
    )
  }

  return { manifest, path }
}

function git(repo, args, options = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      `git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`
    )
  }
  return result
}

function resolveCommit(repo, ref) {
  return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).stdout.trim()
}

function changedFiles(repo, from, to) {
  const output = git(repo, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "-z",
    from,
    to,
    "--",
  ]).stdout
  return output.split("\0").filter(Boolean)
}

function workingTreeChangedFiles(repo) {
  const tracked = git(repo, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "-z",
    "HEAD",
    "--",
  ])
    .stdout.split("\0")
    .filter(Boolean)
  const untracked = git(repo, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .stdout.split("\0")
    .filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
}

function pathMatches(watchedPath, changedPath) {
  const watched = watchedPath.replaceAll("\\", "/")
  if (watched.endsWith("/")) return changedPath.startsWith(watched)
  return changedPath === watched
}

function shortRef(commit) {
  return commit.slice(0, 12)
}

function printImpact({
  base,
  head,
  downstream,
  upstreamFiles,
  downstreamFiles,
  overlaps,
  hotspotHits,
}) {
  console.error("Upstream impact guard blocked this integration.")
  console.error(
    `Range: ${shortRef(base)} -> ${shortRef(head)}; MaxCode: ${shortRef(downstream)}`
  )
  console.error(
    `Incoming files: ${upstreamFiles.length}; downstream-customized files: ${downstreamFiles.length}`
  )

  if (overlaps.length > 0) {
    console.error("\nFiles changed by both MaxCode and incoming upstream:")
    for (const path of overlaps) console.error(`  - ${path}`)
  }

  if (hotspotHits.length > 0) {
    console.error("\nDeclared behavior hotspots touched by incoming upstream:")
    for (const { hotspot, files } of hotspotHits) {
      console.error(`  - ${hotspot.id}: ${hotspot.description}`)
      for (const path of files) console.error(`      ${path}`)
      console.error(`    Contracts: ${hotspot.contracts.join(", ")}`)
    }
  }

  console.error(
    "\nReview the listed upstream commits and behavior, then run `pnpm test:maxcode` before completing the merge."
  )
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const { manifest, path } = loadManifest(options.repo, options.manifest)
  const displayManifest = relative(options.repo, path) || path

  if (options.validateOnly) {
    console.log(
      `MaxCode upstream guard manifest is valid: ${displayManifest} (${manifest.hotspots.length} active, ${manifest.retired.length} retired)`
    )
    return
  }

  const currentHead = resolveCommit(options.repo, "HEAD")
  const head = resolveCommit(options.repo, options.head)
  const downstream = resolveCommit(options.repo, options.downstream)
  const base = options.base
    ? resolveCommit(options.repo, options.base)
    : git(options.repo, ["merge-base", downstream, head]).stdout.trim()
  if (!base) throw new Error("Could not determine a common upstream base")

  for (const [label, commit] of [
    ["incoming upstream", head],
    ["MaxCode downstream", downstream],
  ]) {
    const ancestor = git(
      options.repo,
      ["merge-base", "--is-ancestor", base, commit],
      { allowFailure: true }
    )
    if (ancestor.status !== 0) {
      throw new Error(
        `Selected base ${shortRef(base)} is not an ancestor of ${label} ${shortRef(commit)}`
      )
    }
  }

  const upstreamFiles = changedFiles(options.repo, base, head)
  const downstreamFiles = [
    ...new Set([
      ...changedFiles(options.repo, base, downstream),
      ...(downstream === currentHead
        ? workingTreeChangedFiles(options.repo)
        : []),
    ]),
  ]
  const downstreamSet = new Set(downstreamFiles)
  const overlaps = upstreamFiles
    .filter((file) => downstreamSet.has(file))
    .sort()
  const hotspotHits = manifest.hotspots
    .map((hotspot) => ({
      hotspot,
      files: upstreamFiles.filter((file) =>
        hotspot.paths.some((watchedPath) => pathMatches(watchedPath, file))
      ),
    }))
    .filter(({ files }) => files.length > 0)

  if (overlaps.length > 0 || hotspotHits.length > 0) {
    printImpact({
      base,
      head,
      downstream,
      upstreamFiles,
      downstreamFiles,
      overlaps,
      hotspotHits,
    })
    process.exitCode = 2
    return
  }

  console.log(
    `Upstream impact guard passed: ${shortRef(base)} -> ${shortRef(head)} (${upstreamFiles.length} incoming file(s), no MaxCode overlap)`
  )
}

try {
  main()
} catch (error) {
  console.error(`Upstream impact guard failed: ${error.message}`)
  process.exitCode = 1
}
