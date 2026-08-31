import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const guardScript = resolve(process.cwd(), "scripts/check-upstream-impact.mjs")
const temporaryRepos: string[] = []

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function write(repo: string, path: string, content: string) {
  const absolutePath = join(repo, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function commitAll(repo: string, message: string) {
  git(repo, "add", ".")
  git(repo, "commit", "-m", message)
}

function createRepo() {
  const repo = mkdtempSync(join(tmpdir(), "maxcode-upstream-guard-"))
  temporaryRepos.push(repo)
  git(repo, "init", "-b", "main")
  git(repo, "config", "user.name", "MaxCode Contract")
  git(repo, "config", "user.email", "contract@maxcode.invalid")

  write(repo, "src/watched.ts", "export const watched = 1\n")
  write(repo, "src/shared.ts", "export const shared = 1\n")
  write(repo, "src/downstream-only.ts", "export const local = 1\n")
  write(repo, "src/upstream-only.ts", "export const upstream = 1\n")
  write(
    repo,
    "src/maxcode-contracts/watched.contract.test.ts",
    "// behavior contract\n"
  )
  write(
    repo,
    "guard.json",
    JSON.stringify(
      {
        version: 2,
        hotspots: [
          {
            id: "watched-behavior",
            category: "product",
            description: "A downstream behavior that upstream must not replace",
            origins: ["test-fixture"],
            paths: ["src/watched.ts"],
            contracts: ["src/maxcode-contracts/watched.contract.test.ts"],
          },
        ],
        retired: [],
      },
      null,
      2
    )
  )
  commitAll(repo, "base")

  return { repo, base: git(repo, "rev-parse", "HEAD") }
}

function runGuard(repo: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [guardScript, "--repo", repo, "--manifest", "guard.json", ...args],
    { encoding: "utf8" }
  )
}

afterEach(() => {
  for (const repo of temporaryRepos.splice(0)) {
    rmSync(repo, { recursive: true, force: true })
  }
})

describe("MaxCode contract: upstream impact guard", () => {
  it("blocks an incoming change to a declared behavior hotspot", () => {
    const { repo, base } = createRepo()
    git(repo, "switch", "-c", "incoming")
    write(repo, "src/watched.ts", "export const watched = 2\n")
    commitAll(repo, "change watched behavior")
    git(repo, "switch", "main")

    const result = runGuard(repo, "--base", base, "--head", "incoming")

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Declared behavior hotspots")
    expect(result.stderr).toContain("watched-behavior")
    expect(result.stderr).toContain("src/watched.ts")
  })

  it("blocks a file changed independently by MaxCode and incoming upstream", () => {
    const { repo, base } = createRepo()
    git(repo, "switch", "-c", "incoming")
    write(repo, "src/shared.ts", "export const shared = 'upstream'\n")
    commitAll(repo, "upstream shared change")
    git(repo, "switch", "main")
    write(repo, "src/shared.ts", "export const shared = 'maxcode'\n")
    commitAll(repo, "MaxCode shared change")

    const result = runGuard(repo, "--head", "incoming")

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Files changed by both MaxCode")
    expect(result.stderr).toContain("src/shared.ts")
    expect(result.stderr).not.toContain("watched-behavior")
    expect(git(repo, "merge-base", "HEAD", "incoming")).toBe(base)
  })

  it("includes uncommitted downstream work when comparing HEAD", () => {
    const { repo } = createRepo()
    git(repo, "switch", "-c", "incoming")
    write(repo, "src/shared.ts", "export const shared = 'upstream'\n")
    commitAll(repo, "upstream shared change")
    git(repo, "switch", "main")
    write(repo, "src/shared.ts", "export const shared = 'uncommitted'\n")

    const result = runGuard(repo, "--head", "incoming")

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Files changed by both MaxCode")
    expect(result.stderr).toContain("src/shared.ts")
  })

  it("passes when upstream and MaxCode touch independent non-hotspot files", () => {
    const { repo } = createRepo()
    git(repo, "switch", "-c", "incoming")
    write(repo, "src/upstream-only.ts", "export const upstream = 2\n")
    commitAll(repo, "upstream-only change")
    git(repo, "switch", "main")
    write(repo, "src/downstream-only.ts", "export const local = 2\n")
    commitAll(repo, "downstream-only change")

    const result = runGuard(repo, "--head", "incoming")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Upstream impact guard passed")
  })

  it("rejects a manifest whose behavior contract is missing", () => {
    const { repo } = createRepo()
    write(
      repo,
      "guard.json",
      JSON.stringify({
        version: 2,
        hotspots: [
          {
            id: "broken",
            category: "product",
            description: "Missing its independent contract",
            origins: ["test-fixture"],
            paths: ["src/watched.ts"],
            contracts: ["src/maxcode-contracts/missing.contract.test.ts"],
          },
        ],
        retired: [],
      })
    )

    const result = runGuard(repo, "--validate-only")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("contract does not exist")
  })

  it("rejects an independent contract that was added without inventory registration", () => {
    const { repo } = createRepo()
    write(
      repo,
      "src/maxcode-contracts/forgotten.contract.test.ts",
      "// forgotten behavior contract\n"
    )

    const result = runGuard(repo, "--validate-only")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unregistered MaxCode contract")
    expect(result.stderr).toContain("forgotten.contract.test.ts")
  })
})
