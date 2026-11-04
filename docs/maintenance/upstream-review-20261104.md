# 2026-11-04 智能体运行时选择性集成

下游起点 `55c90155c`，审阅的上游固定为 `e2b4cb11a`。从 `main` 创建
`integrate/upstream-agents-20261104`，逐块移植，不做上游整分支合并。
开始时另存原有暂存改动的二进制补丁备份。处理期间其他任务将原有改动
提交为 `a5852f523`（v0.30.53）和 `497bec54e`；本轮新增运行时移植继续
保留为独立的未提交改动，不回退或重新提交其他任务内容。

## 评审范围

| 来源提交 | 吸收行为及下游适配 |
| --- | --- |
| `70ee1db46` | Pi 优先按会话头查找，再按文件名 UUID 回退；返回请求的原 ID，避免改写 ACP external_id。 |
| `6ff9e53b6` | Claude ACP 0.100.0：启动失败原因区分忙碌、工作树不可恢复、机器配置拒绝与需要登录；机器拒绝不创建新空会话；用户错误文本去除重复的原因 JSON；MCP prompt 兼容 CLI 实际命令名称，且只匹配命令记录、只消费一次。 |
| `af23b44f7` 必要前置部分 | Claude 0.99 起 PDF blob 的回显去重和附件历史投影。沿用 MaxCode 的 user_blocks_from_prompt 投影，不移植上游 Tauri 剪贴板实现或新增设置界面。 |
| `47aeb140b`、`54f07a112` | Codex ACP 2.5.0：2.4 起按实际运行版本开放原生 steering；审批打开时反馈退回队列；保留 MaxCode 2.2.2 私有兼容副本及显式证明门槛。历史文件引用还原为链接，包含代码/转义和跨平台路径规则。共用 promptSuggestions 事件与既有桌面/手机采纳组件，无人值守连接强制关闭预测。更新 0.165 的离线模型目录及 GPT-6.1 Terra 475K 上下文估算，保存配置不向内建 gcp 表写入自定义 endpoint 字段，绑定 endpoint 改用 codeg 表。 |
| `5424b5396` 必要部分 | Grok 1.0.70：无显式窗口的自定义模型，按实际发送模型名称及 TOML 文件顺序继承窗口；显式窗口优先，零值与非法值遵循上游规则。 |
| `febefc08f`、`6b14e28ef` 必要部分 | Antigravity 1.4.5：单次读取上限放宽到现有 16 MiB 文件上限，各路径策略均适用，但 strict 路径边界与其他智能体的 2 MiB 上限继续有效。ZCode 0.82.0：继续 ACP 历史、运行时发现、模式确认、附件及统计；其新 steering 无 promptRequired，仍走既有反馈通道。 |

未吸收其他智能体版本或专属行为、Tauri 壳、系统指令编辑器、聊天时间线改版、任务按钮改版。
所有升级均修改内建安装/自动更新目标，不修改机器上已安装的 CLI 或用户配置。

## 下游保护与验证

`pnpm upstream:impact` 命中运行时、解析器、设置及行为热点，以预期退出码 2
要求人工评审。上述提交按智能体与行为逐块审阅，不批量接受任一侧文件。

新增独立 Rust 契约覆盖 Pi 身份、Claude 启动错误和命令去重、Codex 新旧版本
steering 与预测策略、gcp 配置保护、Antigravity 读取/路径边界及 Grok 窗口继承。
契约从 `agent-upstream-20261104.contract.test.ts` 登记到热点清单；原有手机
采纳提示契约继续执行。Rust 测试使用本地夹具或内存 ACP 对端，不调用付费模型。

- `pnpm upstream:guard --maxWorkers=2`：337 个文件、1709 项测试通过。
- 新契约入口、手机提示采纳组件及日期/主题契约单独复跑：3 个文件、11 项测试通过。
- `pnpm test --maxWorkers=4`：852 个文件、9247 项测试通过。
- `pnpm build`：Next.js 静态导出与 TypeScript 检查通过。
- `pnpm eslint .`：0 错误；已有 `src/lib/transport/web-auth.ts` 导航警告 1 项。
- `git diff --check` 与热点清单校验通过。
- 首轮 Rust 全量：4596 项通过、2 项原有忽略、1 项现有标题断言失败；
  该断言仍要求已退役的类型字段。按现有日期/主题契约更新断言，保留密钥、
  请求参数和不保存草稿的全部验证。最终全量共享库 4597 项通过、2 项原有忽略；
  服务器入口 2 项通过。
- `native-keyring` 桌面后端及 MCP 编译检查通过。
- Clippy 发现现有 `QuestionSettings` 的手写 false 默认实现可派生，已改为
  等价 `derive(Default)`，不修改功能默认值；最终严格 Clippy 通过：
  `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings`。
