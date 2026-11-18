import type { ModelOptionGroup } from "./model-config-groups"

// Only explicit lifecycle copy counts as legacy. Unknown models stay visible.
export function isHistoricalModel(description?: string | null): boolean {
  return /\b(older|previous generation|legacy)\b|历史|上一代|旧版/i.test(
    description ?? ""
  )
}

export function visibleModelGroups(
  groups: ModelOptionGroup[],
  current: string,
  expanded: boolean
): ModelOptionGroup[] {
  if (expanded) return groups
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (item) => item.value === current || !isHistoricalModel(item.description)
      ),
    }))
    .filter((group) => group.options.length > 0)
}

const chinese: Record<string, string> = {
  "Fast responses with lighter reasoning": "较轻量的推理，响应更快",
  "Balances speed and reasoning depth for everyday tasks":
    "平衡速度与推理深度，适合日常任务",
  "Greater reasoning depth for complex problems": "更深入地推理，适合复杂问题",
  "Extra high reasoning depth for complex problems":
    "以更高推理强度处理复杂问题",
  "Maximum reasoning depth for the hardest problems":
    "以最高推理深度处理高难度问题",
  "Maximum reasoning with automatic task delegation":
    "最高推理深度，并自动委派任务",
  "Fast and affordable agentic coding model.": "响应快、成本低的智能编程模型。",
  "Requires approval to edit files and access the internet.":
    "修改文件或访问网络前需要批准。",
  "Requires approval to edit files and run commands.":
    "修改文件或运行命令前需要批准。",
  "Read and edit files, and run commands.": "允许读写工作区文件并运行命令。",
  "Edit workspace files; ask before writing outside the workspace or accessing the network.":
    "允许修改工作区文件；越界写入或访问网络前需要批准。",
  "Only ask for actions detected as potentially unsafe.":
    "仅对检测到的潜在风险操作请求批准。",
  "Unrestricted access to the internet and any file on your computer":
    "允许访问网络及本机所有文件。",
  "Codex can edit files outside this workspace and run commands with network access.":
    "允许修改工作区外的文件，并运行可访问网络的命令。",
  "Fast, go-to model for coding and everyday work.":
    "适合编程和日常工作的快速主力模型。",
  "Our most capable model for complex coding and professional work.":
    "适合复杂编程与专业工作的最强模型。",
  "Efficient model that excels at visual understanding and computer use.":
    "擅长视觉理解和计算机操作的高效模型。",
  "Previous generation model for coding and everyday work.":
    "适合编程和日常工作的上一代模型。",
  "Previous generation model for complex coding and professional work.":
    "适合复杂编程与专业工作的上一代模型。",
  "Legacy model for coding and everyday work.":
    "适合编程和日常工作的历史模型。",
  "Legacy balanced model for agentic coding.": "适合智能体编程的历史均衡模型。",
  "Legacy fast model for simpler tasks.": "适合简单任务的历史快速模型。",
  "Legacy coding model.": "历史编程模型。",
  "Latest workhorse model for coding and everyday work.":
    "适合日常编程与通用任务的最新主力模型。",
  "Frontier intelligence for the most demanding work.":
    "适合复杂推理与高难度任务。",
  "GPT-6.1 Terra Codex model.": "GPT-6.1 Terra 编程模型。",
  "Previous generation workhorse model.": "上一代主力模型。",
  "Fast and affordable model for easier tasks.":
    "适合简单任务，响应快、成本低。",
  "Older generation workhorse model.": "历史版本主力模型。",
  "Older balanced model for straightforward work.":
    "适合常规任务的历史版本均衡模型。",
  "Older fast and efficient model.": "历史版本快速高效模型。",
  "1.5x speed, increased usage": "1.5 倍速度，消耗更多额度",
}

function normalizeDescription(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!。]+$/, "")
    .toLowerCase()
}

const normalizedChinese = new Map(
  Object.entries(chinese).map(([text, translation]) => [
    normalizeDescription(text),
    translation,
  ])
)

export function translateSelectorText(text: string, locale: string): string {
  if (!locale.toLowerCase().startsWith("zh")) return text
  return normalizedChinese.get(normalizeDescription(text)) ?? text
}

// Translate descriptions only. Names and protocol values are always verbatim.
export function translateSelectorData<T>(input: T, locale: string): T {
  if (!locale.toLowerCase().startsWith("zh")) return input
  if (Array.isArray(input))
    return input.map((item) => translateSelectorData(item, locale)) as T
  if (!input || typeof input !== "object") return input
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      key === "description" && typeof value === "string"
        ? translateSelectorText(value, locale)
        : translateSelectorData(value, locale),
    ])
  ) as T
}
