# 2026-09-17 上游评审：六种智能体维护范围

本次刷新 `upstream/main` 后，最新提交仍为 `e4c389637a89`（2026-09-16）。
比较对象为 MaxCode `52ab279940dc` 加当前工作区，包含尚未提交的 Electron/Tauri 迁移。
已在 `integrate/upstream-six-agents-20260917` 按功能移植以下建议项；可选项仍暂缓。登记版本指源码内置安装目标，不代表本机实际运行版本；
MaxCode 的自动更新可能已经安装更新的适配器，因此协议适配仍需单独补齐。

维护范围：Claude Code、Codex、Grok、Pi、DeepSeek、Google Antigravity。
其他智能体实现和历史数据保留，设置和新会话目录隐藏，后台自动更新跳过。

## 本次集成范围（建议项已落实，可选项暂缓）

| 优先级 | 范围 | 上游提交 | 收益及移植要求 |
| --- | --- | --- | --- |
| 高 | Codex | `bd9b6038`、`d74eec45` | 内置适配器 1.10.0 → 1.12.0；支持代理公布的推荐模型/推理强度；按实际握手版本处理 request_user_input 的 title/description 变化，防止问题截断。保留 MaxCode 提问卡片、模型费用、原生子代理结果和官方 CLI 独立更新。 |
| 高 | Claude Code | `39506eb5`、`d74eec45` | 内置适配器 0.75.1 → 0.78.0；采用推荐值能力，避免历史记录写入无意义的 default 模型，跳过已经失效的保存选项，支持 defaultToNo 权限默认选项。保留压缩历史和当前消息布局。 |
| 高 | DeepSeek | `b84e76c6` | 目前固定查找 session.v3.jsonl/session.jsonl；上游新增 generation 日志定位和迁移恢复。移植解析、快照及必要词汇本地化；保留首 token 延迟、生成速度、模型目录，不恢复桌宠面板。 |
| 中 | Grok | `50fff85f` 的 Grok 部分 | 内置安装目标 1.0.25 → 1.0.30。只取 Grok 的版本与相应校验，跳过同提交中的八种其他智能体。已有自动更新不等于内置版本目录已经更新。 |
| 中 | Antigravity及共用进程管理 | `594024db`、`91907061`、`f4f34180` | 独立启动临时目录、退出与崩溃后回收、持久二进制缓存迁移、旧临时文件手动清理、JSON 错误来源与脱敏。按 Electron 共用 Rust 服务接入；保留 Antigravity 双流登录链接发现、退出登录串行化和空闲时更新。跳过 OpenCode 插件专属部分。 |
| 中 | 共用输入框 | `51ded76b`、`86b4bb7a` | 仅代理真实公布的斜杠命令转为徽标；修复异步恢复草稿被依赖更新取消后变空。沿用现有输入框排版、粘贴和右键功能。 |
| 中 | 共用连接状态 | `e4c38963` | 打开旧会话时区分准备与连接，选择器行显示加载占位。保留 MaxCode 移动端断线提示延迟和当前选择器布局。 |
| 可选 | 共用非主动回合提示 | `a4f866f1` | 代理在用户请求之外产生内容时提供重新读取入口。由 CodeBuddy 问题触发，但机制通用；目前不是六种智能体的已证实故障，建议待复现需求后再引入。 |

Pi 当前 pi-acp 0.0.33，最近这一轮没有尚待吸收的专属上游改动。
已有历史解析、MCP 扩展和启动横幅过滤继续保留。

## 排除及暂缓

- 跳过 Cline、Gemini、OpenCode、OpenClaw、Hermes、CodeBuddy、Kimi、Cursor、Qoder 的专属适配、解析、设置和版本升级。
- 特别跳过 CodeBuddy 后台结果归并 `125daf2e`，不要把它和通用的 `a4f866f1` 混为一组。
- `codeg://` 系统链接、关闭窗口询问/托盘/退出采用上游 Tauri 实现；不直接移植。后续有需求时单独设计 Electron 实现。
- MCP 工具名称、文件下载、本地图片、图片 diff、Antigravity 退出登录、Codex 原生子代理结果已吸收，不重复引入。

## 实施顺序和约束

1. Codex / Claude 协议适配与 DeepSeek 日志修复。
2. Grok 版本目录、输入框及历史会话连接提示。
3. Antigravity 与共用缓存、临时目录管理，单独评审迁移和进程生命周期。

正式集成仍从 main 建临时分支，执行 upstream:impact，对重叠提交逐项评审，
新增或更新独立契约。不能直接套用整个混合提交或恢复已隐藏的智能体目录。

## 集成评审结果

- 原工作区迁移和六种智能体限制先保存为独立本地基线 `ae5484d65a17`。
- 采用逐提交差异移植，未把 upstream/main 的全部历史标记为已合并；今后仍能审查尚未吸收的共用改动。
- 推荐模型接入现有内联、搜索及折叠选择器；没有替换输入框布局。
- 连接提示复用现有 pending placeholder、提前连接、空闲 owner 保留和移动端 3 秒提示延迟；没有再维护第二份 pending 状态。
- DeepSeek 保留 MaxCode 的代际优先规则：新代际明文可覆盖旧代际压缩日志；同代际压缩优先。上游编码优先规则会违反既有历史恢复契约，因此未采用。保留增量压缩帧恢复和生成时延统计。
- 临时目录隔离保留 Codex/Claude/Pi 官方 CLI 独立更新注入，只接入共享 Rust 服务启动和回收。未引入 OpenCode 的安装路径、插件迁移或任何 Tauri 注册。
- Grok 仅取 1.0.30 版本变更；其余八种代理版本不变。
- 修正现有 Electron Dock 测试的登录项依赖，以及 JSON 错误脱敏后 Response 测试替身，保留原行为断言。

## 验证结果

- `pnpm upstream:impact`：返回预期的重叠评审状态 2；按上述提交与下游契约完成逐项评审。
- `pnpm upstream:guard`：133 个文件、655 项契约通过。
- `pnpm test`：588 个文件、7,125 项测试通过。
- `pnpm eslint .`、`pnpm build`：通过。
- Electron 后端及 MCP：`cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp` 通过。
- `env -u CODEG_RUNTIME cargo test --no-default-features --features native-keyring --bin codeg-server --lib`：共享库 3,758 项、服务器 2 项通过，1 项既有忽略项。清除测试进程继承的 Electron 运行标记，避免服务器更新测试按设计被拒绝；公开监听器测试禁用系统 HTTP 代理，直接验证本地监听器关闭。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings`：通过。
- 未安装或运行真实代理升级，未生成发布安装包，未推送远端。
