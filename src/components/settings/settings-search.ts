import type { MessageKeys, NestedKeyOf } from "next-intl"
import type messages from "@/i18n/messages/en.json"
import { SHORTCUT_DEFINITIONS } from "@/lib/keyboard-shortcuts"

type SettingMessageKey = MessageKeys<
  typeof messages,
  NestedKeyOf<typeof messages>
>

export interface SettingSearchEntry {
  id: string
  page: string
  titleKey?: SettingMessageKey
  title?: string
  descriptionKey?: SettingMessageKey
  keywords?: string
  targetId?: string
  agentType?: string
  tab?: boolean
  desktopOnly?: boolean
}

// Only index reachable settings. Values and credentials never enter this index.
// Labels/descriptions come from the same translations as the setting itself.
function section(
  page: string,
  namespace: string,
  rows: ReadonlyArray<readonly [string, string, string?, string?]>
): SettingSearchEntry[] {
  return rows.map(([id, title, description, keywords]) => ({
    id,
    page,
    titleKey: `${namespace}.${title}` as SettingMessageKey,
    descriptionKey: description
      ? (`${namespace}.${description}` as SettingMessageKey)
      : undefined,
    keywords,
  }))
}

export const SETTINGS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  ...section("appearance", "AppearanceSettings", [
    [
      "theme-mode",
      "themeMode",
      "sectionDescription",
      "dark light system 深色 浅色 跟随系统",
    ],
    [
      "theme-color",
      "themeColor.sectionTitle",
      "themeColor.sectionDescription",
      "HBuilderX 暖黄 配色",
    ],
  ]),
  ...section("general", "GeneralSettings", [
    [
      "terminal",
      "terminalTitle",
      "terminalDescription",
      "shell bash zsh powershell 终端",
    ],
    [
      "command-color",
      "colorizeCommandOutput",
      "colorizeCommandOutputDescription",
      "ANSI 彩色 命令输出",
    ],
  ]),
  {
    id: "login-item",
    page: "general",
    titleKey: "GeneralSettings.loginItem.title",
    descriptionKey: "GeneralSettings.loginItem.description",
    desktopOnly: true,
  },
  ...section("general", "DesktopNotificationSettings", [
    ["desktop-notifications", "title", "description", "通知 隐私 permission"],
  ]),
  ...section("general", "NotificationSoundSettings", [
    ["notification-sound", "title", "description", "声音 音量 volume sound"],
  ]),
  ...section("general", "AcpAgentSettings.multiAgent", [
    [
      "delegation",
      "title",
      "description",
      "subagent 协作 委托 子智能体 深度 缓存",
    ],
  ]),
  ...section("general", "AgentToolsSettings", [
    ["agent-tools", "title", "description"],
    ["live-feedback", "feedbackLabel", "feedbackHint"],
    ["ask-question", "questionLabel", "questionHint"],
    ["session-info", "sessionInfoLabel", "sessionInfoHint"],
    ["automation-tool", "automationsLabel", "automationsHint"],
    ["task-tool", "workTasksLabel", "workTasksHint"],
  ]),
  ...section("system", "SystemSettings", [
    ["proxy", "proxyTitle", "proxyDescription", "http socks5 网络代理"],
    ["proxy-address", "proxyAddress"],
    ["proxy-bypass", "proxyBypass", undefined, "no_proxy bypass 绕过代理"],
    [
      "title-model",
      "titleModelTitle",
      "titleModelDescription",
      "自动标题 标题模型",
    ],
    ["title-model-url", "titleModelBaseUrl", "titleModelBaseUrlHint"],
    ["title-model-key", "titleModelApiKey", undefined, "标题模型 API key 密钥"],
    ["language", "languageTitle", "languageDescription", "中文 English 语言"],
  ]),
  ...section("system", "BackupSettings", [
    [
      "backup",
      "title",
      "description",
      "备份 backup 导出 export 恢复 restore 导入 import",
    ],
    ["snapshots", "snapshots.title"],
  ]),
  ...section("version-control", "VersionControlSettings", [
    ["git", "gitTitle", "gitDescription", "Git executable 路径"],
    ["github", "githubTitle", "githubDescription", "token 令牌"],
    ["gitlab", "gitlabTitle", "gitlabDescription", "token 令牌"],
    ["gitea", "giteaTitle", "giteaDescription", "Forgejo token 令牌"],
  ]),
  ...section("logs", "LogsSettings", [
    ["log-level", "captureTitle", "captureDescription", "debug trace 日志级别"],
    ["log-overrides", "targetsTitle", "targetsDescription"],
    ["log-viewer", "viewerTitle", "viewerDescription"],
    ["log-files", "filesTitle", "filesDescription", "download 下载"],
  ]),
  ...section("web-service", "WebServiceSettings", [
    ["web-port", "port", undefined, "端口 port"],
    ["web-token", "tokenLabel", "tokenHint"],
    ["web-autostart", "autoStart"],
    ["web-share", "publicShareUrlLabel", "publicShareUrlHint"],
  ]),
  ...SHORTCUT_DEFINITIONS.map(({ id }) => ({
    id: `shortcut-${id}`,
    page: "shortcuts",
    titleKey: `ShortcutSettings.actions.${id}.title` as SettingMessageKey,
    descriptionKey:
      `ShortcutSettings.actions.${id}.description` as SettingMessageKey,
    targetId: `shortcut-${id}`,
  })),
  ...[
    ["claude_code", "Claude Code"],
    ["codex", "Codex"],
    ["grok", "Grok"],
    ["pi", "Pi"],
    ["deepseek", "DeepSeek"],
    ["antigravity", "Google Antigravity"],
    ["zcode", "ZCode"],
  ].map(([agentType, title]) => ({
    id: `agent-${agentType}`,
    page: "agents",
    title,
    agentType,
    keywords: "agent model API key 智能体 模型 密钥 安装 更新",
  })),
  ...["channels", "commands", "events", "other"].map((tab) => ({
    id: `chat-channel-${tab}`,
    page: "chat-channels",
    titleKey: `ChatChannelSettings.tabs.${tab}` as SettingMessageKey,
    tab: true,
  })),
  ...["experts", "science", "office", "custom"].map((tab) => ({
    id: `skill-pack-${tab}`,
    page: "skill-packs",
    titleKey: `SkillPacksSettings.tabs.${tab}` as SettingMessageKey,
    tab: true,
  })),
]

export interface SettingSearchResult extends SettingSearchEntry {
  label: string
  description: string
  category: string
}

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim()

export function searchSettings(entries: SettingSearchResult[], query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return entries
    .map((entry) => {
      const label = normalize(entry.label)
      const text = normalize(
        `${entry.label} ${entry.description} ${entry.category} ${entry.keywords ?? ""}`
      )
      const score = terms.every((term) => text.includes(term))
        ? label === normalize(query)
          ? 3
          : terms.every((term) => label.includes(term))
            ? 2
            : 1
        : 0
      return { entry, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry)
}

/** Locate only inside the visible page; in-window settings retain hidden drafts. */
export function findSettingTarget(
  root: HTMLElement,
  entry: SettingSearchResult
): HTMLElement | null {
  const visible = (node: HTMLElement) =>
    !node.closest('[hidden], [inert], [data-state="inactive"]')
  if (entry.agentType) {
    return (
      [...root.querySelectorAll<HTMLElement>("[data-agent-type]")].find(
        (node) => node.dataset.agentType === entry.agentType && visible(node)
      ) ?? null
    )
  }
  if (entry.targetId) {
    return (
      [...root.querySelectorAll<HTMLElement>("[data-settings-search-id]")].find(
        (node) =>
          node.dataset.settingsSearchId === entry.targetId && visible(node)
      ) ?? null
    )
  }
  if (entry.id.startsWith("page-")) {
    return (
      [
        ...root.querySelectorAll<HTMLElement>("[data-settings-page-title]"),
      ].find(visible) ?? null
    )
  }
  const selector = entry.tab
    ? '[role="tab"]'
    : "[data-settings-search-label], h2, h3, label"
  const match = [
    ...root.querySelectorAll<HTMLElement>("[data-settings-search-label]"),
    ...root.querySelectorAll<HTMLElement>(selector),
  ].find(
    (node) =>
      normalize(node.dataset.settingsSearchLabel ?? node.textContent ?? "") ===
        normalize(entry.label) && visible(node)
  )
  if (!match) return null
  if (match.matches("label"))
    return (
      match.closest<HTMLElement>("[data-setting-row]") ?? match.parentElement
    )
  return (
    match.closest<HTMLElement>(
      "[data-setting-row], [data-settings-section], [data-settings-group]"
    ) ?? match
  )
}
