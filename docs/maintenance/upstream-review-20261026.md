# 2026-10-26 上游选择性集成

上游固定为 `95fd81df4`（v0.40.0），下游起点 `9c9766f45`。
按用户要求只吸收流式重复解析优化、ZCode 附件/统计/取消修复、Grok 自定义
模型思考等级。滚动问题先验证，仅移植确认复现的部分；最近会话排序保持原样。

## 工作区保护与影响评审

从 `main` 创建 `integrate/upstream-selected-20261026`，原已跟踪和未跟踪改动
保存到 `maxcode-before-upstream-selected-20261026` stash 后原样恢复，备份保留。
逐块应用和适配补丁，不使用整文件 ours/theirs 覆盖。初轮集成未提交、未推送；
后续与当日智能体版本更新及工作区改动统一整理，验证后合入本地 `main`。

`pnpm upstream:impact` 最初被原工作区待办校验登记阻断：Rust 契约直接列在
仅允许 Vitest 入口的 `contracts`。保留已有 TSX 入口，将 Rust 文件移到
`paths`，不修改待办行为或测试。随后扫描以预期退出码 2 完成，命中共享运行时、
设置、ZCode、聊天布局等热点，按下表逐项评审。

## 移植范围

| 来源 | 最终行为与下游适配 |
| --- | --- |
| `433d67706` | 普通工具输出先按 XML 标签/JSON 开头过滤，跳过不相关的后台任务解析；保留 Claude/Grok 解析，不新增 CodeBuddy 专属格式。 |
| `d968412b0` | 工具名称规范化使用有界缓存；实时工具名称按不可变 ToolCallInfo 引用缓存，更新对象后重新推断；目标解析跳过不含 objective 键的载荷。保留 MaxCode 工具输出、计费与展示。 |
| `e3e8b9340`、`a6f30fae5`、`ace77d678` | ZCode 按协商能力开放图片和嵌入资源，音频仍关闭；验证附件字节落盘、回显去重与冷启动读取。补齐原有 ACP 历史中资源/资源链接的投影；嵌入图片保留图像，其他文件显示附件标记，正文/二进制不泄露到标记，回放后的正文不粘连附件链接。 |
| `79279a6bf`、`899a77dfd`、`546605db5` 的 ZCode 必要部分 | ZCode 每个提示独立跟踪 busy windows，累计实际计费；canonical cache-read/write 字段优先且不重复扣减。仅一个 window 时采用 native turnMs，多窗口沿用提示实测耗时。取消不提前写结束边界，尾部消息仍属于原回复，迟到统计不计到下一提示。实测发现下游空闲循环未记录取消尾部，补齐上游必要依赖，仅对已发送首个提示的 ZCode 记录空闲消息，避免启动/恢复回放混入历史。保留 ACP 历史及运行时发现，不恢复原生 SQLite/别名兼容。桥接版本仍为已有 0.72.0，本轮不带入其他版本升级。 |
| `7b372f960` | Grok 自定义模型配置 reasoning_efforts，选项变动后才发送等级。未触碰的手写 TOML、未知等级和等级元数据保留，重命名继续携带。适配已拆分的 Rust 设置测试和当前 Codex 设置改动，保持七智能体范围。 |
| `c83aab6c7` | 确认现有虚拟列表滚动时禁用按钮点击后，只移植保持 pointer events 的容器。保留自定义 MessageThreadItem、滚动定位与现有聊天布局。 |

## 滚动验证

通过 ego-browser 在本机 Vite 临时页面载入实际的 MessageThread、
VirtualizedMessageThread 和 useCollapsibleOverflow，使用 200 条长短混合的
模拟消息。验证对象是当前共享前端组件，不是 Tauri 壳，也不连接真实模型。

- 修改前：滚动 100px 后按钮 computed pointer-events 为 none，命中测试返回 DIV；
  停止滚动后恢复 auto。
- 修改后：同场景 pointer-events 为 auto，命中测试返回 BUTTON。
- 接近底部、长消息折叠及不同根字号下进行滚动位置采样：布局最初有一次调整，
  随后稳定，没有复现上游描述的持续往返抖动。因此不移植 `014859820` 的
  keepMounted 策略，也不移植 `d0843bafa` 的溢出缓存。此结论限定于本轮场景，
  不声称所有真实会话均不会抖动。

新增/更新独立契约覆盖工具缓存失效、普通输出跳过解析、真实 virtua 滚动交互、
Grok 设置面板与 TOML 保留、ZCode 回合统计/取消/协商能力。Rust 运行时契约使用
内存 ACP 对端，未调用付费模型。

## 验证结果

- `pnpm upstream:guard --maxWorkers=2`：270 个文件、1391 项契约通过。
- `pnpm eslint .`：通过。临时浏览器测试页面移出仓库后执行。
- `pnpm build`：Next.js 16.4.2 静态导出通过。
- `pnpm test --maxWorkers=4`：780 个文件通过，8859 项测试通过，Git 面板
  2 项在并行构建负载下超时。降低负载后原命令按该文件复跑，17/17 通过；
  同一文件在本轮修改前 stash 快照的隔离工作树中也为 17/17 通过。
  没有修改该测试或提高超时阈值。
- 初轮 Rust 4463 项通过、2 项失败、2 项忽略；失败揭示缺失的空闲记录和
  资源附件投影前置改动，已补齐后重新执行完整套件。
- `git diff --check` 和本轮 Rust 文件 rustfmt 检查通过。
- 原有未跟踪文件逐字节核对全部不变；原有已跟踪改动中仅本轮重叠的设置、
  Grok 翻译、热点清单和维护文档发生追加修改。

- 最终 `cargo test --no-default-features --bin codeg-server --lib`：共享库
  4472 项通过、2 项原有忽略，服务器入口 2 项通过。取消尾部、附件冷读取、
  回放正文边界及全部新增 Grok/ZCode 契约通过。

- `cargo check --no-default-features --features native-keyring --bin codeg-server
  --bin codeg-mcp`：通过。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib
  -- -D warnings`：通过。

两项检查曾等待另一个工作树占用的共享 Cargo 构建锁，最终均成功退出。
所有运行时测试使用本地模拟或内存对端，未执行真实 ZCode 登录/付费模型调用。

## 当日改动合入主分支

以智能体更新提交 `b57d4ffed` 为基础，保留当前工作区已完成的选择性集成、
待办校验、工作区偏好、安全修复和运行时性能改动，统一合入本地 `main`。
合入前保留完整 Git 快照，不向上游仓库推送。

- 全量前端：787 个文件、8914 项测试通过。
- Rust：共享库 4508 项通过、2 项忽略，服务器入口 2 项通过。
- TypeScript、全仓 ESLint、静态导出构建、热点清单校验通过。
- Electron 后端及 MCP 的 `native-keyring` 编译检查通过。
- 验证期间新增的待办卡片按钮顺序改动，补跑独立契约 2 项及相关 ESLint 通过。
