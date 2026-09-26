# 2026-09-26 第一批上游稳定性集成

## 基线与范围

- MaxCode 基线：`95b0599f`，版本保持 0.30.24。
- 上游评审点：`2774a7e0`（v0.32.2）。
- 从干净的 `main` 创建 `integrate/upstream-priority-20260926`。
- 用户授权第一批七类修复；未纳入第二批版本升级、浏览器或统一告警改造。
- 集成前运行 `pnpm upstream:impact`，按共同祖先 `4f0bd5f3` 扫描，退出码 2。
  历史按功能移植使默认范围包含已评审提交，因此逐个评审本次选取的补丁。

## 来源与适配

| 功能 | 来源提交 | 处理 |
| --- | --- | --- |
| ACP 2.x 生命周期 | `81163947` | 进程退出优先报告退出状态/stderr；未知请求明确答复；用协议取消事件撤销权限及 Codex 问题卡；类型化请求和原始 dispatch。保留 rmcp、Tokio time/signal、Grok models 捕获、下游原生队列与委托取消。移除未使用的 end-turn usage feature，计费仍读原生历史。 |
| Claude/Codex 适配 | `1a347230` | Claude ACP 0.81.1、Codex ACP 1.13.1；Claude 文件参数别名在实时/历史/子会话中归一化；不重放已撤销模式；更新内置 Codex 目录及布尔字段校验。其他智能体固定版本和目录不变。 |
| Codex 回退历史 | `6aaac6f9` | 按 thread/rollout 精确解析文件名、选取最新 rollout；按 ordinal 拼接 history_base，支持多次回退、分叉和环检测；保留现有计时、用量及解析器契约。 |
| 标签与运行时 | `d965dd26`、`94a17675` | 重排仅接受完整排列并使用当前 tab 对象；跨组移动交接虚拟运行时 ID、保留 transcript 与元数据同步；同任务重挂载可撤回清理。保留 MaxCode 直接拖动分栏、项目区域和草稿规则，不带入上游撤销关闭标签等无关上下文。 |
| 代理直连 | `dd13b595`、`3ade0124` | 新增持久化 no_proxy 设置，启动智能体时合并大小写环境变量并保证本机直连，更新 forge 客户端缓存指纹。保留标题模型设置，未恢复旧开机启动或更新入口。十种语言补齐说明。 |
| Claude 附件去重 | `b18fa74d` | 按适配器实际写入的资源文本生成自身 prompt 指纹，避免附件消息被 transcript watcher 当作后台活动再次渲染。 |
| 相对路径与链接 | `40eeb6fd`、`515d21da`、`5724e1b5`、`5763e298`、`baf7b554`、`0a802c9e`、`b9de87bd`、`31d5afac`、`f6cffc28`、`5f073a6c`、`ef1c3766` | 使用最终的元素 WeakMap 在 sanitize 后保存相对路径、harden 后恢复；修复下载根路径、思考区引用和流式未闭合链接。保留本地路径自动徽标、Codex followup、公开分享只读策略；保留 renderer 对直接传入 incomplete-link 的防御及原测试。 |

## 下游契约

- `upstream-priority-runtime.contract.test.ts`：真实 MaxCode 直接分栏操作的草稿绑定 ID 交接、旧拖动数据不覆盖新 tab、即时重挂载保留/真实关闭释放、适配器版本与共享 Rust 契约接线。
- `proxy-loopback.contract.rs`：跨大小写代理环境合并、本机服务直连、旧保存设置兼容及关闭代理清理；从共享 Rust network/proxy 模块挂载。
- 在 `config/maxcode-upstream-hotspots.json` 和下游功能清单登记本次集成；既有版本契约推进到本次选定适配器版本。

## 验证

- `pnpm upstream:guard`：153 个契约文件、755 项测试通过。
- `pnpm test`：623 个文件、7513 项测试通过。
- `pnpm exec tsc --noEmit`、`pnpm eslint .`、`pnpm build` 静态导出均通过。
- `cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp` 通过。
- `env -u CODEG_RUNTIME cargo test --no-default-features --features native-keyring --bin codeg-server --lib`：共享库 3928 项通过、1 项既有忽略，服务器入口 2 项通过。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings` 通过。
- 提交前再次执行 `pnpm upstream:impact`，仍按预期返回 2（包含本次已评审热点和未选取上游变化）；`git diff --check` 通过。

首轮前端回归发现上游设置页测试夹具依赖本地已移除的更新 provider，以及两处旧适配器版本断言；修正后重跑全量通过。新增分栏契约按 MaxCode 单标签分栏创建新草稿的规则补齐同组第二标签，再验证真实移动。

未执行真实智能体安装/升级，未生成桌面安装包或发布、推送。
