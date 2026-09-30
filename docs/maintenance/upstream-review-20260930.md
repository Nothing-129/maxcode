# 2026-09-30 推荐上游同步

## 基线与流程

main 基线 `d70656d3`，原工作区快照 `10e2392a`，上游评审点 `478ff2fd`（v0.32.4），此前 `2774a7e0`（v0.32.2）。从 main 创建临时集成分支 `integrate/upstream-recommended-20260930-113147`，保存已有改动后按功能移植。合并前执行 `pnpm upstream:impact`，共同祖先 `4f0bd5f3`，退出码 2 表示需评审；逐个检查重叠与行为热点，未用 ours/theirs 批量覆盖。

中途断连清理了临时文件系统，已提交补丁保留；恢复至持久 worktree `../maxcode-integration-20260930`，重建未提交的收尾保护和独立契约，重新验证。原工作区仅应用快照之后的集成增量，不提交原有改动。

## 来源与适配

| 内容 | 来源 | MaxCode 适配 |
| --- | --- | --- |
| Claude/Codex AIR | `2db8a81b`、`757bd8e0` | 稀疏 ledger、权限命名空间、plan review、Claude Read 输出、Fable 模型别名、插件失败提示。保留 ask 开关、整数版本校验、完整原始输入与所有 hunk；diffPatch/rawInputRendering/planFile 不新增广告，沿用本地告警。 |
| Codex 搜索与历史 | `9d9ce6b0`、`58f0fd0e`、`9243c7df` | 搜索用量不虚增上下文，保留连续思考与费用，压缩摘要折叠进 divider。精确 callId 去重，counter 仍跨来源一对一匹配。 |
| Codex 模型目录 | `155916e6` | GPT-6.1 Sol、官方优先级；安装和托管更新按实际 runtime 刷新自有目录，保留用户表、intent、自定义/排除项和默认；失败不读取另一份旧安装冒充 live。 |
| Grok 后台回合 | `b35282c6` | 跟进、结束、取消、迟到帧和已准入 prompt 的门控；任务条继续隐藏。 |
| Pi | `9cbd5b96`、`2f18466e`、`ad9e3224`、`fbd615d4`、`0c307991`、`a946bfde`、`04d656ab`、`b9d9e6b6` | 离线模型能力、实际 thinking 级别、profile/HOME/PATH 修复、过旧 runtime 提示；保留托管 CLI、七档偏好、自定义映射、旧 .33 补丁，.34 原生 selector 权威。 |
| Cmd+K / Git log | `e20e4558`、`5c62248f`；`e5358d4e`、`df937897`、`0d22c939`、`9e4f8c83`、`bd48be95` | 匹配项排序、提交详情/行选择同步；保留当前平台与菜单约定。 |
| Provider 绑定 | `0c0d9e29`、`348725b9`、`27edaf2e` | 重新绑定同步状态和配置，保留七智能体与分组设置样式。 |
| 通知 | `09d74bce`、`d2e86448` | 持久会话身份、关闭窗格仍可命名、MaxCode 隐私和 echo/snapshot 去重；仅 owner 有登录动作。 |
| Recent | `e36c8ed4`、`b409cf33`、`ae54cc7e`、`062b935f`、`fa3236e8`、`caca52f6` | 筛选先于十条分页，切换重置、持久化和准确余量；保留 Chat/Folder 独立分页、折叠与 New chat。 |
| HTML / visualize | `20687bb4`、`917ad0b7`、`e8b97ee5`、`66f21e27`、`0e28ccf3`、`85d7c635`、`251528b0`、`0e5ac772` | transcript 根、confined 相对/兄弟资源读取、延迟提及、opaque origin/CSP 和每文件信任，所有脚本默认关闭；保留正文与文件操作、公开分享只读。 |

未纳入多画布、待办/Forge task、统一告警大改、latest-release 流程、未维护智能体专属升级、Tauri Cmd+W 或可选导航样式。保留 Electron/共享服务器、七种智能体和 MaxCode 0.30.24。已有 adapter pins 达到本次目标，不重复安装或回退。

## 验证

新增独立 runtime、catalog、Pi、HTML、Recent、通知契约并扩展压缩契约；已登记清单和功能表。

- `pnpm test`：650 个文件、7825 项测试全部通过。
- `pnpm upstream:guard`：168 个契约文件、854 项测试通过，清单校验通过。
- 全仓 ESLint、`tsc --noEmit --incremental false` 通过。
- `pnpm build --webpack` 静态导出通过；worktree 的 node_modules 位于另一目录，使用 webpack 避免 Turbopack 对跨根符号链接的限制，构建 ID 与导出元数据一致。
- `cargo test --no-default-features --features native-keyring --bin codeg-server --lib`：4103 项共享库测试通过、1 项既有忽略；2 项服务器入口测试通过。测试清除继承的 `CODEG_RUNTIME` 环境变量。
- `cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp` 通过。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings` 通过，覆盖无 native-keyring 的服务器与 MCP 编译路径。
- 提交前 impact 扫描按预期退出 2（已评审热点和未选取上游差异）；`git diff --check` 通过。

首轮前端回归修正三处旧源码形状断言，计时断言在独立重跑和最终全量中通过；未改动性能实现或放宽计时阈值。新增 Rust symlink 契约比较真实 canonical path，兼容 macOS `/tmp` 与 `/private/tmp` 别名；修正后后端全量通过。

应用增量前逐个核对原工作区 2302 个快照文件均未发生新变化；应用后核对 2331 个集成文件与原工作区一致。main HEAD 保持 `d70656d3`，原有改动仍未提交；本次审计提交保存在集成分支。

未执行真实智能体安装或付费模型请求，未打包、发布或推送。
