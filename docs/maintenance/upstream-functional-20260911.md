# 2026-09-11 上游功能选择性吸收

## 范围与评审依据

用户要求直接吸收适合的功能，尽量不改已经重写的界面。从 MaxCode `main`
（`cd5b8fe1`）创建隔离分支 `integrate/upstream-functional-20260911`，评审上游
`932ac543`（v0.30.7）之前的提交。共同祖先仍为 `4f0bd5f3`。

已运行 `corepack pnpm upstream:impact`，退出码 2 表示命中下游重叠及行为热点。
逐项审查后移植以下功能；没有整体合并上游，也没有用 ours/theirs 覆盖文件。
未来比较上游时应结合此记录识别已移植内容，不能把上游整个提交区间视为已合并。

## 已吸收

| 功能 | 上游来源 | MaxCode 适配与保留 |
| --- | --- | --- |
| Codex code-mode MCP 历史还原 | `a04fe077` 至 `1edca458` 的修复链及相关注释 | 通过原有 ToolUse/ToolResult 还原工具名、参数、结果和真实错误；不明确的关联保留脚本。保留逐模型计费、耗时、插件上下文过滤及既有原生子智能体行为 |
| pi 历史深度解析 | `bd98dfc4`、`c80b2161` | 修复思考字段、活动分支、图片、真实 edit diff、取消/失败状态、压缩和系统消息、绝对 sessionDir；仅补现有分类器对 ls/powershell 的识别。保留已有启动横幅抑制及 max 思考配置 |
| Cline 解析稳定性 | `145ef078`、`25ed5864` | 正确匹配被剥离块自己的结束标签，避免死循环、panic、反馈及后续标题丢失 |
| 导入 worktree 归属 | `6e4001c5`、`42dc4465`、`a69013fb`、`c50ae2d9` | 同批新建的仓库也可接收工作树，拒绝自引用、循环、悬空和多层父节点。保留现有侧栏分组、cwd、标题、模型及仅恢复所选删除会话的行为 |
| 未轮询的连接监视器回收 | `d9e5b145`、`9005ded2` | 在创建 Future 时立即持有 ChildGuard，保留进程树退出回调和存活 PID 保护 |
| Antigravity 登录链接 | `6f88b29a` | stdout/stderr 共用首个链接接收器；额外修复 stdout 提前 EOF 导致丢失稍后 stderr 链接的竞态，保留当前登录流程和进程清理 |
| pi 扩展 MCP 配置 | `4311c01a`、`266953a1` | 识别并编辑已有扩展配置，不新增不可用的 ACP 分配选项。额外保留共享服务器被其他来源覆盖时的 pi 扩展专属字段；切换传输时移除旧传输字段 |
| Claude 0.75.1 兼容 | `14168211`、`5f22a3e1`、`ad7af8c4` | 同步 adapter 固定版本及预检，保留精确分叉定位、压缩后上下文用量、/compact 提问顺序和实时 System 摘要。复用现有压缩分隔线 |

Claude 去重采用比上游更保守的策略：只在历史与实时来源之间逐一配对，完整的
压缩前/后 token 数、时长、触发方式及错误都一致才消除重复。相同来源的两个事件、
不同结果或信息不足的事件都保留，避免把两次真实压缩误合成一次。

## 本次暂不吸收

| 上游变化 | 原因 |
| --- | --- |
| 画布文件/终端卡片、图片 Diff 新视图、MCP 状态栏和工具开关、子智能体卡片重做 | 与用户现有界面和产品入口重叠，本次保留当前组件结构及布局 |
| 本地 Markdown 图片内联、输入框右键操作及文件徽章菜单 | 触及正在修改的消息/文件引用界面，需要按现有交互另行设计接入 |
| DeepSeek 模型列表编辑器及 0.9.0 默认版本 | 升级需配套新目录配置面板，不能只提版本；现有 DeepSeek v3 历史兼容保留 |
| 其他智能体版本整体升级 | 本次聚焦功能修复，仅更新与已移植功能配套的 Claude adapter；保留用户自定义版本、在线更新入口及 OpenCode SHA256 校验固定版本 |
| 命令着色设置、任务合并/看板更新、标签页交互调整、Antigravity 登出面板 | 与现有设置、已退役任务入口或自定义交互关联，避免半套功能或恢复旧界面 |
| 发布版本、赞助与 README、品牌和安装包配置 | 继续使用 MaxCode 的版本、品牌及 Electron 发布链路 |

## 回归保护

新增四组独立契约，均登记在 `config/maxcode-upstream-hotspots.json`：

- `history.codex-semantic-mcp`：MCP 内容恢复不改变费用、时间或上下文过滤。
- `history.import-worktree-grouping`：工作树归属遵守当前侧栏及导入策略。
- `history.claude-compaction-compatible`：压缩事件保守去重，沿用既有回复布局。
- `agents.functional-upstream-runtime`：进程回收、双流登录、pi 扩展字段保留及工具分类。

Rust 回归使用实际解析器、临时数据库/文件、真实输出泵及进程，不请求真实智能体
服务。Pi 的全局历史读取仍无法定位工作区相对或项目级 sessionDir；MCP 配置读取
仍使用进程级 PI_CODING_AGENT_DIR，与现有配置读写一致。

## 验证

验证全部通过：

- `corepack pnpm exec eslint .`，最终新增/修改前端文件再次检查通过。
- `corepack pnpm test`：554 个测试文件、6,695 项测试通过。
- `corepack pnpm upstream:guard`：108 个契约文件、465 项测试通过，105 项活跃热点清单有效。
- `corepack pnpm build --webpack`：类型检查和 35 页静态导出通过；使用 Webpack 以复用隔离工作区外的 node_modules。
- `cargo test --locked --no-default-features --features native-keyring --bin codeg-server --lib -- --test-threads=1`：库 3,624 项通过、1 项原有忽略；服务器入口 2 项通过。
- vendored `sacp-tokio` 独立测试：20 项通过，含从未轮询的监视器回收。独立测试解析出的锁文件改动未纳入集成。
- `cargo clippy --locked --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp --lib -- -D warnings` 通过。
- `cargo check --locked --no-default-features --bin codeg-server --bin codeg-mcp` 通过。
- 所有修改的 Rust 文件 rustfmt 检查、`git diff --check` 通过。

Rust 测试显式移除宿主传入的 `CODEG_RUNTIME=electron`，同时设置
`NO_PROXY=127.0.0.1,localhost` 和小写 `no_proxy`，避免服务器更新测试被宿主模式
阻止，以及 macOS 系统代理在本地监听关闭后返回 HTTP 响应。后者用当日上午的旧
测试二进制复现并验证代理排除后恢复，无需改动服务关闭逻辑。并行下两个既有进程
启动测试曾超时，单独重跑及最终串行全量均通过。

界面 diff 仅包含数据去重接线、工具分类和 MCP 既有配置的类型/状态映射，
不修改 JSX 布局、CSS、颜色、间距或导航入口。集成不更新依赖锁、产品版本或发布配置。
