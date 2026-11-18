import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  isHistoricalModel,
  translateSelectorData,
  translateSelectorText,
  visibleModelGroups,
} from "@/lib/selector-presentation"
const groups = [
  {
    key: "all",
    name: null,
    options: [
      {
        value: "current",
        name: "6.1 Sol",
        description: "Latest workhorse model for coding and everyday work.",
      },
      {
        value: "old",
        name: "6 Sol",
        description: "Previous generation workhorse model.",
      },
      { value: "custom", name: "My model", description: null },
    ],
  },
]
describe("localized selector history", () => {
  it.each([
    "Only ask for actions detected as potentially unsafe",
    "Only ask for actions detected as potentially unsafe.",
    "  Only ask for actions detected as\n potentially unsafe.  ",
  ])(
    "translates the live Auto review description regardless of punctuation: %s",
    (description) => {
      expect(translateSelectorText(description, "zh-CN")).toBe(
        "仅对检测到的潜在风险操作请求批准。"
      )
    }
  )
  it("keeps reasoning and permission names verbatim while translating descriptions", () => {
    const items = [
      {
        value: "ultra",
        name: "Ultra",
        description: "Maximum reasoning with automatic task delegation",
      },
      {
        value: "agent-full-access",
        name: "Full access",
        description:
          "Codex can edit files outside this workspace and run commands with network access.",
      },
    ]
    const result = translateSelectorData(items, "zh-CN")
    expect(result.map((item) => item.name)).toEqual(["Ultra", "Full access"])
    expect(result[0].description).toContain("委派")
  })
  it("collapses only explicit historical models, keeping selected and custom models", () => {
    expect(
      visibleModelGroups(groups, "current", false)[0].options.map(
        (x) => x.value
      )
    ).toEqual(["current", "custom"])
    expect(visibleModelGroups(groups, "old", false)[0].options).toHaveLength(3)
    expect(visibleModelGroups(groups, "current", true)[0].options).toHaveLength(
      3
    )
  })
  it("translates descriptions while preserving model identity and English locales", () => {
    const result = translateSelectorData(groups, "zh-CN")
    expect(result[0].options[0].name).toBe("6.1 Sol")
    expect(result[0].options[0].value).toBe("current")
    expect(result[0].options[0].description).toContain("日常编程")
    expect(translateSelectorData(groups, "en")).toBe(groups)
  })

  it.each([
    [
      "Fast, go-to model for coding and everyday work.",
      "适合编程和日常工作的快速主力模型。",
      false,
    ],
    [
      "Our most capable model for complex coding and professional work.",
      "适合复杂编程与专业工作的最强模型。",
      false,
    ],
    [
      "Efficient model that excels at visual understanding and computer use.",
      "擅长视觉理解和计算机操作的高效模型。",
      false,
    ],
    [
      "Previous generation model for coding and everyday work.",
      "适合编程和日常工作的上一代模型。",
      true,
    ],
    [
      "Previous generation model for complex coding and professional work.",
      "适合复杂编程与专业工作的上一代模型。",
      true,
    ],
    [
      "Legacy model for coding and everyday work.",
      "适合编程和日常工作的历史模型。",
      true,
    ],
    [
      "Legacy balanced model for agentic coding.",
      "适合智能体编程的历史均衡模型。",
      true,
    ],
    [
      "Legacy fast model for simpler tasks.",
      "适合简单任务的历史快速模型。",
      true,
    ],
  ])(
    "localizes current Codex catalog copy without changing its historical status: %s",
    (description, translation, historical) => {
      const option = {
        value: "model-id",
        name: "Model name",
        description,
      }
      const [display] = translateSelectorData([option], "zh-CN")
      expect(display).toEqual({ ...option, description: translation })
      expect(isHistoricalModel(display.description)).toBe(historical)
    }
  )

  it("covers every visible model description in the bundled Codex catalog", () => {
    const { models } = JSON.parse(
      readFileSync("src-tauri/resources/codex/bundled-catalog.json", "utf8")
    ) as {
      models: { slug: string; description?: string; visibility: string }[]
    }
    const untranslated = models
      .filter(
        ({ visibility, description }) =>
          visibility === "list" &&
          description?.trim() &&
          !/\p{Script=Han}/u.test(translateSelectorText(description, "zh-CN"))
      )
      .map(({ slug, description }) => `${slug}: ${description}`)
    expect(untranslated).toEqual([])
  })

  it("preserves custom model descriptions that have no known translation", () => {
    const custom = "Internal model tuned for our project's test suite."
    expect(translateSelectorText(custom, "zh-CN")).toBe(custom)
  })
})
