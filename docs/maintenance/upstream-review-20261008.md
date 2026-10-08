# 2026-10-08 八项上游修复

## 范围与基线

从 `main`（`6fbae22f`）创建临时集成分支
`integrate/upstream-selected-20261008`，在持久 worktree
`../maxcode-integration-20261008` 保存原工作区快照 `1c98f145` 后移植。
上游评审点为 `592131c7`（v0.34.0）。集成增量不包含快照中的既有改动。

用户明确仅授权下列八项。Computer Use、会话标签、多画布、内嵌浏览器、
Grok/Antigravity 的额外版本更新、其他智能体适配、上游地址及发布配置均不在范围内。

合并前执行 `pnpm upstream:impact`，共同祖先 `4f0bd5f3`；退出码 2 表示
重叠及行为热点须人工评审。逐项比较所选提交和 MaxCode 实现，没有批量接受
ours/theirs，也没有整体合入上游历史。冲突分别保留完整工具输入、七智能体目录、
Electron、手机恢复和已有队列投递保护。

## 所选修复及适配

| 修复 | 来源 | MaxCode 处理 |
| --- | --- | --- |
| 大历史追加内存 | `f0e6a520` | 一次扫描完整行、独立保存尾部；保留非法 UTF-8 水位及失败读入后重试行为。独立契约实际检验字符串容量、尾行和水位。 |
| 手机自动聚焦 | `d93f359b`、`0b78dcec`、`1c452ed5` | 聚焦时读取 primary pointer，不增加监听；触摸设备不自动抢焦点，撤销失效帧，手动点击沿用现有行为。 |
| 任务保存智能体 | `d60820c9` | 只有所示智能体与继承结果一致时保存 null；回退智能体不沿用旧智能体的模式/选项，未操作模板仍继承。没有引入上游任务分支编辑改动。 |
| Grok 目录广播 | `09caedd5` | 连接级消费 `_x.ai/models/update`；锁内构建事件，保留当前模型/思考选择、去掉重复广播、忽略空目录，并隔离分叉前的旧广播。保留 MaxCode setup/MCP 通知处理。 |
| Codex 2.1.1 | `6bd62250` | typed writer-lock 提示；支持 close 时异步释放分叉父会话；自定义问答历史、压缩错误及 Desktop 附件解析。附件通过本地 `user_blocks_from_prompt` 投影，保持显示与去重一致；Desktop 附件独立转义标签/目标，避免影响其他 prompt 投影；url/percent-encoding 原已在依赖树中，仅增加直接依赖。 |
| Claude 0.85–0.86 | `78402121`、`6d0257b2`、`2e5b46b4` | 升至 0.86.0；插话前及回合结束回收问答；后台 Bash 通知仅结算子智能体启动卡；仅将已失效模型 id 映射到唯一同模型/版本行，保存偏好不被改写。保留 AIR、权限、全部 diff hunk 及原生插话门控。 |
| 插话期间草稿 | `8f9fc05d` | 成功或回合结束转队列后，仅当 editor、draft key 和当前完整草稿仍与发送时一致才清空；保留期间编辑的文字、附件。现有队列同步锁及不确定投递禁止自动重发继续保留。 |
| 搜索无匹配展示 | `3b29d2f4` | 新增谨慎的单管道识别，通过共享 `search-no-match` 接入，而非替换 MaxCode 多智能体搜索策略。只读空输出的 exit 1 标记，诊断、exit 2、否定/复合命令及危险重定向仍失败。 |

Claude/Codex pins 及既有独立版本契约一并更新；其余智能体 pins 不变。
上游 `44f98f5c` 开放 Codex 原生插话的尝试后来由 `47244aaf` 撤回，
本次没有引入该尝试及相关队列重构。

新增独立 runtime、历史内存、Desktop 历史、手机聚焦/草稿和任务保存契约；
已登记 `runtime.selected-upstream-20261008` 并更新下游功能清单。

## 验证

- `pnpm test`：659 个文件、7,997 项测试全部通过。
- `pnpm upstream:guard`：176 个契约文件、921 项测试通过，清单校验通过。
- 全仓 ESLint 与 `tsc --noEmit --incremental false` 通过。
- `pnpm build --webpack` 静态导出通过；使用 webpack 兼容 worktree 跨目录的 node_modules 符号链接。
- 提交前 `pnpm upstream:impact` 按预期退出 2：命中重叠/热点的所选差异已逐项评审；其余上游差异未选取。`git diff --check` 通过。

- `cargo test --no-default-features --features native-keyring --bin codeg-server --lib`：4,168 项共享库测试及 2 项服务器入口测试通过，1 项既有忽略；测试清除继承的 `CODEG_RUNTIME`。
- `cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp` 通过。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings` 通过，覆盖无 native-keyring 的服务器与 MCP 编译路径。

首轮后端全量发现 Desktop 附件的特殊文件名需要 Markdown 转义：在新增 Desktop 模块内按前端 reference 编码规则转义标签和目标，不改变其他 prompt 投影；加入包含方括号、换行及路径括号的独立回归契约。

应用前逐个核对原工作区 2,341 个快照文件均未发生新变化；通过快照之后的集成增量回写当前工作区，原有改动仍保持未提交。集成审计提交保存在临时分支。

未安装真实智能体或发起付费模型请求，未打包、发布或推送。
