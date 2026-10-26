// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { parse } from "yaml"
import { source } from "./contract-source"

const workflow = parse(source(".github/workflows/release.yml"))
const createStep = workflow.jobs["create-draft-release"].steps.find(
  (step: { id?: string }) => step.id === "release"
)
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const draft = {
  id: 42,
  tag_name: "v0.30.44",
  draft: true,
  name: "MaxCode v0.30.44",
  prerelease: false,
  body: "Release notes",
  html_url: "https://example.com/release/42",
}

async function runCreate(releases: (typeof draft)[]) {
  const repos = {
    listReleases: vi.fn(),
    getCommit: vi.fn().mockResolvedValue({
      data: { commit: { message: "Release notes" } },
    }),
    createRelease: vi.fn().mockResolvedValue({ data: draft }),
    updateRelease: vi.fn().mockResolvedValue({ data: draft }),
  }
  const github = {
    paginate: vi.fn().mockResolvedValue(releases),
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({
          data: { object: { type: "commit", sha: "commit-sha" } },
        }),
      },
      repos,
    },
  }
  const core = { setFailed: vi.fn(), setOutput: vi.fn(), info: vi.fn() }
  await new AsyncFunction("github", "context", "core", createStep.with.script)(
    github,
    {
      ref: "refs/tags/v0.30.44",
      repo: { owner: "Nothing-129", repo: "maxcode" },
    },
    core
  )
  return { github, repos, core }
}

describe("release drafts survive failed workflow reruns", () => {
  it("reuses the same-tag draft from the paginated collection", async () => {
    const { github, repos, core } = await runCreate([
      { ...draft, id: 10, tag_name: "v0.30.43" },
      draft,
    ])
    expect(github.paginate).toHaveBeenCalledWith(repos.listReleases, {
      owner: "Nothing-129",
      repo: "maxcode",
      per_page: 100,
    })
    expect(repos.createRelease).not.toHaveBeenCalled()
    expect(repos.updateRelease).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith("release_id", "42")
  })

  it("updates stale draft metadata using its release ID", async () => {
    const { repos } = await runCreate([{ ...draft, body: "Old notes" }])
    expect(repos.updateRelease).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: 42, body: "Release notes" })
    )
    expect(repos.createRelease).not.toHaveBeenCalled()
  })

  it("creates a draft only when the tag has no existing release", async () => {
    const { repos, core } = await runCreate([])
    expect(repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ tag_name: "v0.30.44", draft: true })
    )
    expect(core.setOutput).toHaveBeenCalledWith("release_id", "42")
  })

  it("rejects duplicate drafts instead of choosing an arbitrary one", async () => {
    const { repos, core } = await runCreate([draft, { ...draft, id: 43 }])
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Multiple draft releases")
    )
    expect(repos.createRelease).not.toHaveBeenCalled()
    expect(repos.updateRelease).not.toHaveBeenCalled()
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "rejects an already published tag even when another draft exists: %s",
    async (hasDraft) => {
      const { repos, core } = await runCreate([
        { ...draft, id: 20, draft: false },
        ...(hasDraft ? [draft] : []),
      ])
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("already exists and is not a draft")
      )
      expect(repos.createRelease).not.toHaveBeenCalled()
      expect(repos.updateRelease).not.toHaveBeenCalled()
    }
  )

  it("validates assets from the same draft ID that will be published", () => {
    const steps = workflow.jobs["publish-release"].steps
    const validate = steps.find((step: { run?: string }) =>
      step.run?.includes("release.cjs validate-assets")
    )
    const publish = steps.find(
      (step: { name?: string }) => step.name === "Publish draft release"
    )
    expect(validate.env.RELEASE_ID).toBe(publish.env.RELEASE_ID)
    expect(validate.run).toContain(
      'gh api "repos/$GH_REPO/releases/$RELEASE_ID"'
    )
    expect(validate.run).not.toContain("gh release view")
  })
})
