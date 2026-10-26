# 2026-10-26 智能体版本同步评审

上游：`spacering-net/codeg`，`95fd81df4`（v0.40.0）。从 `main` 的
`9c9766f45` 创建 `integrate/agent-updates-20261026`，运行 `pnpm upstream:impact`，
按热点逐项移植，未合并整个上游历史。

| 智能体 | 原版本 | 同步版本 |
| --- | --- | --- |
| Claude ACP | 0.90.0 | 0.94.0 |
| Grok | 1.0.52 | 1.0.62 |
| Antigravity | 1.4.0 | 1.4.1 |
| ZCode ACP | 0.72.0 | 0.76.2 |

Codex ACP 2.2.2、Pi ACP 0.0.34、DeepSeek ACP 0.9.0 保持原版本。

- `80269fa71`：接回取消后的延迟工具结果、后台子任务中间结果及错误围栏清理。
  保留本地生成耗时、乐观消息分区和后台通知去重。
- `efdce2c01`：预测提示只填入空编辑器，Tab 不直接发送；自动化和机器人会话禁用预测。
- `c9e6329c4`：Remote Control 状态、链接、二维码及停止入口；保留 Electron
  `openUrl`，保护分组回收的候选筛选和执行前复检，不恢复后台任务条。
- `f88b372a2`：ACP runtime/derive 锁定 3.4.0；fork 子智能体忽略继承的父上下文，
  等待真正结果，计费使用独立下游事实版本触发重建。本项目沿用三元历史解析返回值。
- `7a66537fb`、`84cbc38a2`：Grok 1.0.62 及原生安装回退；托管安装、PATH、
  用户目录和 npm 的优先级保持，npm 安装遗留的 `.grok/bin` 不误报为独立原生安装。
- `08513b573`：Antigravity 1.4.1 和全部平台下载地址一起升级，保留现有模型恢复逻辑。
- `e2961c264`、`a7cd74b18`：ZCode 0.76.2；不恢复本地 SQLite 历史或旧别名迁移。
  现有按版本启用的模型目录修复继续覆盖 0.76.2。

不接入上述混合提交中的其他智能体版本、专属适配或新入口，不恢复 Tauri。
独立契约在 `agent-updates-20261026.contract.test.ts` 和
`claude-fork-accounting.contract.rs`，并登记到热点清单。

验证记录：隔离集成工作区的全量前端 776 个测试文件 / 8,855 项测试、
独立契约 261 个文件 / 1,348 项测试、TypeScript、ESLint 和静态构建通过。
合并回当前工作区后，275 个契约及关键回归文件 / 1,613 项测试、
TypeScript、受影响文件 ESLint 和热点清单校验通过。

合并后的 Rust 检查：`cargo test --no-default-features --bin codeg-server --lib`
通过，库测试 4,507 项通过、2 项忽略，服务器入口 2 项通过；0 失败。
