# 2026-09-20 选择性上游集成

用户明确选择吸收 Claude 兼容、Pi 上下文容量、Office 子进程清理、提问卡折叠及模型名称显示；不升级 Motion，不引入浏览器。

## 基线与工作区保护

- MaxCode 基线：`ed347ffd`（0.30.21）。
- 上游评审范围：`a425e41d..ac3a336c`（v0.31.1）。
- 从 `main` 创建隔离分支 `integrate/upstream-selected-20260920`。
- 原工作区的未提交改动在隔离分支保存为 `596a3c85`，原目录保持不动；最后只向原目录回填此快照之后的增量，不自动提交原有改动。
- 集成前和完成后均执行 `pnpm upstream:impact`，返回 2：逐项评审重叠，不使用 ours/theirs。由于以往按功能移植，上次评审点不是 main 的祖先，默认扫描还包括更早的已评审差异。

## 吸收范围与适配

| 范围 | 来源 | 实际处理与边界 |
| --- | --- | --- |
| Claude ACP 0.79 | `afdcfe0b` | 仅推进 Claude 适配器目录及 preflight 预期。命令标题与命令重复时使用原始 description；保留显式 default-to-no。支持以括号开头及写 patch 的 Shell 命令；PowerShell 归一为命令卡。现有 renderer 已使用归一化命令，不引入退役桌宠卡片。官方 CLI 独立更新、原生队列及其他智能体版本不变。 |
| Pi 上下文容量 | `07653466`、`7d74c791`、`29e435ef` 的最终 parser 差异 | 按 provider/id 查 models.json，显式模型省略容量为 128000，重复声明取最后一项，modelOverrides 优先；缺失 provider 只接受一致值。自定义 agent/session 路径分别解析，保留原计时和用量。显式非法 override 不回用较大的底层声明。没有引入缓存命中率 UI 或无效 schema bump。 |
| Office 子进程 | `65588b03` | 当前线程发送 kill，异步只负责 wait；测试子进程增加 kill_on_drop。独立 Rust 契约在完全不轮询 runtime 的情况下验证子进程确实收到终止信号。 |
| 提问卡折叠 | `a425e41d..ac3a336c` 的最终 ask-question-card 差异，包含 `d3c3ecd6`、`3d81d7cc` | 保留 MaxCode 圆角、选项面、问题标题、显式提交和底栏；只加正常布局中的折叠。选择保留，新问题/提交失败重新展开；只读记录永不被旧折叠状态隐藏。没有浮动、拖拽或 body portal。十种语言补齐两个文案。 |
| 模型显示名 | `78c9313b` | 保留下游 updateCachedSelectors/ensureCachedSelectors，只旁路记录连接所属 agent 的 live/replay model selector。按 agent 持久化，用于回复页脚、会话详情和身份 chip；未知 ID 原样展示，计费/请求/历史原始 ID 不改。目录缩减保留旧名，显式改名回原始 ID 时清掉旧映射，防止 stale label。 |

## 防回归

新增独立契约：

- `upstream-selected-20260920.contract.test.tsx`：审批展示与拒绝优先、提问卡状态、版本及 Rust 契约挂载。
- `model-display-labels.contract.test.tsx`：可见历史更新、跨 agent 隔离、原始 ID 不变、持久化、旧名称清理及下游缓存接线。
- `pi-model-window.contract.rs`：真实 parser 路径下的 provider 切换、无 provider 歧义、默认值/最后声明/override。
- `office-watch-reap.contract.rs`：不调度异步任务时也能终止进程。

已登记五个热点，并更新 `downstream-customizations.md`。既有 six-agent 契约仅将 Claude 预期升级为 0.79。另修正原工作区侧栏测试中一处 Prettier 换行，不改变其断言或产品行为。

## 验证

- 前端全量：606 文件、7319 项通过。
- 独立契约：146 文件、735 项通过；只读提问卡补充防护后重新跑过全部契约。
- TypeScript `--noEmit`、全量 ESLint、`pnpm build` 静态导出通过。
- `env -u CODEG_RUNTIME cargo test --no-default-features --features native-keyring --bin codeg-server --lib`：共享库 3786 项通过、1 项既有忽略；服务器 2 项通过。
- `cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp` 通过。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings` 通过。

未运行真实智能体升级，未发布或生成桌面安装包，未推送。Motion、Tauri/browser、非维护智能体专属改动及工作任务入口均不在本次范围。
