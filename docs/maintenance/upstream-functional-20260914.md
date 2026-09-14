# 2026-09-14 上游功能选择性吸收

## 范围与评审依据

用户要求吸收适合的功能，尽量不改已经重写的界面。从 MaxCode `main`
（`3a097c1d`，v0.30.15）创建隔离分支 `integrate/upstream-functional-20260914`，
评审 `932ac543`（上游 v0.30.7）之后尚未吸收的提交，并复审 9 月 11 日刻意跳过
的项目。共同祖先仍为 `4f0bd5f3`。上游 `main` 当时为 `18046ea4`。

没有整体合并上游，也没有用 ours/theirs 覆盖文件。未来比较上游时应结合
`upstream-functional-20260911.md` 与本记录识别已移植内容。

## 已吸收

| 功能 | 上游来源 | MaxCode 适配与保留 |
| --- | --- | --- |
| 带 `query` 的 MCP 工具保留真名 | `fc8cad0c` | 不再把 payload 里有 `query` 的调用一律当成 WebSearch；CodeGraph / Context7 等显示原名。沿用现有工具卡片，不改 JSX |
| Codex 网页搜索后续动作 | `a47c68a9` | `web search` / `open page` / `find in page` 标题以及 `webSearch` 类型仍归类为网页搜索；普通 `kind: "search"` 继续当本地 grep |
| 「打开文件夹」快捷键说明 | `5e5b7c60` | 十种语言改为「在当前工作区打开」。只改文案，不改快捷键 id、绑定或布局 |

## 本次暂不吸收

| 上游变化 | 原因 |
| --- | --- |
| Tauri 辅助窗口关闭后恢复隐藏的主窗口（#680） | MaxCode 桌面已走 Electron，`windows.rs` 这条路径不生效 |
| Codex 原生子智能体卡片：结束状态、汇报、打开子会话、`list_agents` 名册（`34b0f7fb`） | 改写 `agent-tool-call` / `collab-agent-card` / capsule 布局；9 月 11 日已跳过，现有卡片结构保留 |
| 画布文件/终端、图片 Diff、MCP 状态栏和工具开关 | 界面入口，保留当前组件 |
| 本地 Markdown 图片内联、输入框右键、文件徽章下载菜单 | 触及已重写的消息/文件引用交互 |
| DeepSeek 模型列表编辑器及 0.9.0 目录 | 需要新的设置面板；只提版本会半套 |
| 内置智能体版本整体升级 | MaxCode 已有强制自动更新与 OpenCode SHA256 约束；不在本次改注册表钉死版本 |
| 命令着色、任务合并/看板、标签页重开位置、Antigravity 登出面板 | 设置项已去掉、任务入口已退役，或属于自定义交互 |
| 发布版本、赞助与 README、品牌和安装包 | 继续使用 MaxCode 的版本、品牌及 Electron 发布链路 |

## 回归保护

新增独立契约 `chat.query-bearing-mcp-names`，登记在
`config/maxcode-upstream-hotspots.json`：带 `query` 的 MCP 调用保持原名，
Codex 网页搜索动作仍识别为 websearch，普通 search 仍为 grep。

## 验证

- `corepack pnpm exec eslint`：修改的 TypeScript 文件通过。
- `corepack pnpm test`：561 个测试文件、6,821 项测试通过。
- `corepack pnpm upstream:guard`：114 个契约文件、570 项测试通过，111 项活跃热点清单有效。
- `git diff --check` 通过。

无 Rust 改动。界面 diff 不含 JSX 布局、CSS、颜色、间距或导航入口。
不更新依赖锁、产品版本或发布配置。
