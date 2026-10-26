import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { parse } from "yaml"
import {
  extractCodexTomlImportantValues,
  patchCodexConfigTomlText,
} from "@/components/settings/codex-config-toml"

it("keeps Codex TOML updates usable without mounting settings and preserves unrelated content", () => {
  const input = '# user comment\nmodel = "example"\n[unrelated]\nvalue = 42\n'
  const output = patchCodexConfigTomlText(input, { skills: true })
  expect(extractCodexTomlImportantValues(output).featureSkills).toBe(true)
  expect(output).toContain("# user comment")
  expect(output).toContain("[unrelated]\nvalue = 42")
  const disabled = patchCodexConfigTomlText(output, { skills: false })
  expect(extractCodexTomlImportantValues(disabled).featureSkills).toBe(false)
})

it("keeps performance measurement and artifact collection in a dedicated CI job", () => {
  const workflow = parse(readFileSync(".github/workflows/test.yml", "utf8"))
  const job = workflow.jobs["runtime-benchmarks"]
  expect(job["timeout-minutes"]).toBe(15)
  expect(
    job.steps.some((step: { run?: string }) =>
      step.run?.includes("pnpm bench:runtime")
    )
  ).toBe(true)
  const upload = job.steps.find((step: { uses?: string }) =>
    step.uses?.startsWith("actions/upload-artifact@")
  )
  expect(upload.if).toBe("always()")
  expect(upload.with.path).toBe("benchmark-results/")
  expect(readFileSync("vitest.bench.config.ts", "utf8")).toContain(
    'outputJson: "benchmark-results/runtime.json"'
  )
})
