# 2026-09-15 上游图片 Diff、Agent 交互与版本目录吸收

## 范围

从 MaxCode `db4dda199` 创建隔离分支
`integrate/upstream-features-agents-20260915`。上游 `main` 仍为
`18046ea4`，没有比 9 月 14 日评审更新的提交。本次按用户选择继续吸收图片
Diff、命令颜色开关、Antigravity 退出登录、Codex 原生子智能体结果与子会话，
并更新已评审的内置智能体版本。

开始集成前已运行 `node scripts/check-upstream-impact.mjs`。退出码 2 按设计命中
上游重叠文件和 MaxCode 行为热点；没有整体合并上游，也没有使用 `ours` /
`theirs` 批量覆盖。

## 已吸收

| 功能 | 上游来源 | MaxCode 适配与保留 |
| --- | --- | --- |
| 图片文件 Diff | `504fc279` | 工作区、Commit、Push、Unstash 支持有界的前后图片；保留按对话隔离的文件标签、二进制产物系统打开和 Electron/Web 双运行时 |
| 命令颜色显式开启 | `1d4d0074`、`883f1964`、`52e30cfa`、`5bb2a279`、`c9e25be7` | 默认不再污染 Agent 的机器可读命令输出；通用设置增加开关，保存颜色时原样带回默认 Shell；沿用当前设置布局和通知区域 |
| Antigravity 退出登录 | `7861d6ed`、`de096bb4` | 使用 ACP `logout`，退出前阻断新连接并结束同类存活/退出中进程；保留 MaxCode 同时从 stdout/stderr 捕获登录链接及无浏览器登录流程 |
| Codex 原生子智能体 | `34b0f7fb` | 恢复 child id、completed/interrupted 状态、最终报告和 `list_agents` 名册；复用当前 Agent 胶囊及子会话查看器，保留费用、耗时、插件上下文过滤和语义 MCP 历史 |
| 智能体版本目录 | `8c461154`、`1055edc4`、`e588125b`、`25882257` | 更新安装/自动更新目标及兼容性说明；OpenCode 不采用上游空 SHA256，而是验证官方 Release 六个平台资产后升级 |

## 版本结果

| Agent | 版本 |
| --- | --- |
| Gemini | 0.59.0 |
| OpenClaw | 2026.9.3（Node 最低版本同步为 24.16.0） |
| OpenCode | 1.18.30 |
| Hermes | 0.21.1 |
| CodeBuddy | 2.149.0 |
| Kimi Code | 0.42.0 |
| Grok | 1.0.25 |
| Qoder | 1.1.49 |

Claude Code 0.75.1、Codex ACP 1.10.0、Cline 3.0.61、Pi ACP 0.0.33、
Cursor `2026.09.02-c22c1a3`、DeepSeek ACP 0.9.0 和 Antigravity 1.1.1
已与上游一致，保持不变。

## OpenCode 1.18.30 校验

GitHub Release API 当时返回 rate limit 403，上游注册表也没有摘要。MaxCode
直接从 `https://github.com/anomalyco/opencode/releases/download/v1.18.30/`
对应官方资产流式计算 SHA256，六项均成功：

| 平台 | SHA256 |
| --- | --- |
| darwin-aarch64 | `a5e43d6887386efc7d68ce49ae28e3bbdfdee3dfd1d7169b612c3ce67e53b1e8` |
| darwin-x86_64 | `7453007e58ff122401438d95ccb24334874b5908dcaee77883f96c23395d5710` |
| linux-aarch64 | `4111a55c2a02c0fac314bd51e9a2330280e6d29d2b85b9554fff6d62612566ed` |
| linux-x86_64 | `55007246858165496ff85ba1c2b648f7421e8e2013bf4189a680c9ff8e699d17` |
| windows-aarch64 | `35d6ff7d80aff5ade71ac06fc32dd89357b5b0bac050fc6db41ecf0929cea560` |
| windows-x86_64 | `c8c0e0d05ac3dac544a0edfad8de9eb244bf46c6c7a131c38619d40fcf31bd1f` |

## 冲突评审

- 图片 Diff 在干净分支上可直接应用；仍人工确认 `workspace-context` 保留
  MaxCode 的对话级文件范围和系统打开策略。
- 命令颜色冲突集中在终端设置和通用设置页；合并时同时保留标题模型、硬件加速、
  桌面通知和通知声音设置。
- Antigravity 唯一文本冲突来自 MaxCode 的双流 URL 捕获；新共享 spawn helper
  被改为继续从 stdout/stderr 共用首个链接接收器。
- Codex 两个 Rust 冲突按字段和控制流逐段合并；没有覆盖 MaxCode 的语义 MCP、
  计费、耗时或推荐插件过滤逻辑。
- 版本提交在 OpenCode 处冲突；采用 1.18.30 版本和 URL，但用独立计算的六个平台
  SHA256 替代上游的 `None`。

## 回归保护

新增五组独立 MaxCode 契约并登记热点：

- `workspace.binary-image-diffs`
- `settings.command-color-opt-in`
- `agents.antigravity-sign-out`
- `chat.codex-native-subagent-results`
- `agents.reviewed-version-catalog`

同时扩展 `agents.opencode-verified-distribution` 的来源和说明。

## 验证

- 新增及关联前端测试：8 个文件、156 项通过；
- 新增契约与关联既有契约：8 个文件、27 项通过；
- `pnpm upstream:guard`：123 个契约文件、598 项通过，120 项活跃热点清单有效；
- `pnpm test`：580 个测试文件、7034 项通过；
- `pnpm exec eslint .`：通过；
- `pnpm build`：Next.js 35 个静态页面导出通过；
- Rust 针对性测试：图片 Blob 5 项、命令颜色 1 项、Antigravity 57 项、
  Codex 新格式/子会话 2 项、版本目录 1 项通过；
- Electron/服务器 Rust 全量库测试：3690 项通过、1 项既有忽略；服务器入口 2 项通过；
- HTTP API 集成测试（`native-keyring,test-utils`）：16 项通过；
- Electron 后端与 MCP `cargo check`、旧 Tauri 默认 `cargo check`：通过；
- 修改文件 rustfmt、JSON 校验及 `git diff --check`：通过。

严格 `cargo clippy ... -D warnings` 被本次未修改的
`src-tauri/src/acp/binary_cache.rs` 三处 Rust 1.98 `needless_borrow` 新提示阻断；
允许这两个纯样式 lint 后，同一组 server/MCP/lib Clippy 目标通过。本次没有顺手修改
该无关文件。
