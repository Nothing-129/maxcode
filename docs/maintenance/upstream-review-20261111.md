# 2026-11-11 定向上游集成评审

分支：`integrate/upstream-selected-20261111`，从 `main` 的 `1376455a7` 创建。
评审区间：上次已检查的 `39fe4cc09` 至 `1bc86a301`（v0.42.3）。
本次保留开始前的未提交修改，不执行整分支合并、不推送、不恢复退役功能。

## 接受的改动与适配

| 上游提交 | 内容 | 下游处理 |
| --- | --- | --- |
| `9a565b2d0` | Codex fork 携带 MCP 服务 | 保留本地 bool 型 Claude 会话参数；Codex/Claude 携带服务，DeepSeek 仍由 resume 注入；补独立 Rust 契约及连接级测试 |
| `80fd043f6`、`cd35a36c7`、`6677de432` | 共享有界高亮、取消旧请求、保留文件预览高亮 | 适配本地 `file-viewer-drawer.tsx`；保留原依赖安全 overrides；仅引入 Streamdown 补丁、精确固定 2.7.1；Docker 在 frozen install 前复制补丁 |
| `0fe09eb34` | Grok 后台子智能体跨回合进度 | 迁入本地 `agent-tool-call.tsx`；保留 runtime store 的排队发送分流和即时耗时；不引入上游组件重构 |
| `6ee6f1fe5` | Codex 2.6.0 / 异步提问 / 提供商拒绝 | 保留本地 `session_provider_missing` 优先分类；新增 `provider_mismatch` 不允许重绑空历史；保留 Fast 会话记忆、用户文本空白和手机去重；不引入本地尚不存在的 ToolResult `exit_code` 字段 |
| `38dbe5fea`、`325d98213`、`598451b8d` | Claude 0.106.0 / Fable 5.2 / 压缩摘要重放 | 吸收模型选择迁移、摘要包装清理、加载阶段压缩重放抑制；只更新现有设置字段 |
| `31b220117`、`dbcbbb61d` | ZCode 0.83.3 | 只更新维护范围内 ZCode 的固定版本和断言；保留 William ACP、运行时发现和 ACP 历史 |

注意：上游说明中 Start Plan 指 ZCode 套餐/认证路径，不是本次新增 MaxCode 的计划模式权限逻辑。
本次未重新进行真实账号下的适配器网络 A/B 实测。

## 明确排除

- Tauri API、原生 transport、WKWebView 的事件回调修复。
- OverlayScrollbars 2.15.1 补丁：本地为 2.17.x，需另行验证 Safari 后再决定。
- OpenCode、Kimi、Hermes、Qoder、CodeBuddy、MiniMax、Command Code 专属更新。
- 自定义智能体入口和专属磁盘 Skills 菜单。
- 上游应用版本号、包名、发布配置与不相关的 OpenCode 模型目录变化。

## 影响扫描与契约

修正 `chat.mobile-running-transcript-dedup` 的 `contracts`：只登记可由 Vitest
发现的 `.contract.test.ts` 入口；Rust 契约保留原文件及 Rust 测试引用。
未放宽校验器规则。

`pnpm upstream:impact` 已从清单错误（退出码 1）恢复为正常的热点阻塞
（退出码 2）。默认共同基点较老，报告覆盖历史下游差异；本次逐提交评审
上表中的更新，不通过假合并移动上游基点。

新增独立契约 `src/maxcode-contracts/upstream-selected-20261111.contract.test.ts`
及 `.contract.rs`，登记 `runtime.selected-upstream-20261111`。
现有版本目录契约仅更新维护范围内三种适配器的当前目标版本，不改变历史门槛测试。
Claude 模型迁移契约调整为：只在具体旧模型已消失时，允许迁移到唯一、更新的
同族别名；仍在列表中的具体模型、其他族、旧版本和歧义项均不迁移。
同时对齐工作区原有输入框 `pb-1` 和手机/桌面侧边栏分支的两项陈旧样式断言，
不改变对应生产行为。

## 测试环境注意事项

当前智能体进程设置了 `CODEG_ACP_HOST_TOOLS=agent`。两个握手终端回收测试
使用继承环境构造策略，因此在该环境下会拒绝模拟代理的 `terminal/create`，
并等待 `terminal started` 超时。复验只在测试子进程中使用
`env -u CODEG_ACP_HOST_TOOLS cargo test ...`，没有修改服务器配置或默认安全策略。

全量前端首次并行执行遇到 5 秒超时，使用
`pnpm test --maxWorkers=2 --testTimeout=20000` 复验；不修改全局测试配置。
附件上传测试还存在 React 提交时序竞争：等待上传函数被调用，不代表附件状态
已提交。将原有三条断言一起放入 `waitFor`，不放松断言、不改生产代码。
最终不带额外参数的 `pnpm test` 也已全量通过。

## 最终验证

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 875 个测试文件、9389 项测试全部通过 |
| `pnpm upstream:guard` | 清单有效；357 个契约测试文件、1810 项测试通过 |
| `pnpm upstream:impact` | 正常扫描，退出码 2：历史重叠/热点需要人工评审；本次已按上表定向评审，不宣称全量上游可直接合并 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm eslint .` | 0 错误；已有 `src/lib/transport/web-auth.ts:26` 导航警告 1 条 |
| `pnpm build` | 静态导出构建通过 |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 通过，补丁和 lockfile 一致 |
| Rust 无默认 feature 的 server / MCP 编译 | 通过 |
| Rust `native-keyring` 的 server / MCP 编译 | 通过 |
| 隔离测试环境的 Rust server / lib 测试 | 库 4685 通过、2 忽略；服务器二进制 2 通过；0 失败 |
| `git diff --check` | 通过 |

未执行真实账号代理端到端、Docker 镜像构建或桌面安装包实机验证。
实现与验证阶段未提交或推送。随后用户授权将可合并的本地分支全部合入主分支，
因此将当前已验证的集成及原有工作区改动一并提交，再合入 `main`；不推送远程。

## 本地分支收拢

- `codex/startup-hotfix-03046`、`integrate/upstream-fixes-20261027`、
  `integrate/upstream-agents-20261104` 的提交已全部是 `main` 的祖先，无需重复合并。
- `integrate/upstream-selected-20261109` 的唯一独立提交 `aef632a3c` 与
  `main` 中的 `ce210c826` 补丁完全相同，仅合并历史关系，不回退后续输入框契约。
- 当前 `integrate/upstream-selected-20261111` 的已验证改动提交后合入 `main`。
- 不合并上游远程开发分支，不删除本地分支，也不改动其他 worktree。
