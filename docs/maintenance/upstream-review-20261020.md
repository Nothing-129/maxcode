# 2026-10-20 上游选择性集成

固定评审上游 `a86f7a11a1dc`，下游起点 `dbc7c8fb4ae2`。本轮仅吸收用户指定的
六组稳定性与依赖修复，以及完整替换 ZCode 集成；不合并其他新功能和智能体。

## 工作区与影响评审

先通过 `maxcode-before-upstream-20261020` stash 保存全部已跟踪及未跟踪改动，
从干净的 `main` 建立 `integrate/upstream-selected-20261020`，再恢复原工作区。
备份保留，原有待办 MCP、分享、DeepSeek 拒绝提示记录和 Office 偏好改动继续存在。

首次 `pnpm upstream:impact` 被既有 DeepSeek 契约登记阻断：清单将 Rust 行为测试
直接作为仅接受 TypeScript 入口的 `contracts`。补上对应入口后重新扫描，得到预期
退出码 2：共同基点 `4f0bd5f31fd1` 至所选上游有大量重叠与热点。因此按以下提交块
逐项移植，不使用整文件取舍、`ours` 或 `theirs`。不修改上游远程或向其推送。

## 提交与行为

| 范围 | 上游来源 | 评审与最终行为 |
| --- | --- | --- |
| 手机后台返回 | `23831d93b`、`af51be137` | 错过回合结束时标记重同步，等待本批所有提示及回复落盘再替换本地回复；排队中的下一轮、去重、时间与计费保持独立。既有 snapshot 回退也使用同一完整性判断。 |
| 长会话耗时与用量 | `92349d532` | 按提示边界对应本地与落盘回复，不再依赖时间戳划分；历史窗口或分叉变化后重新确定批次位置。Claude 后台回合从任务通知开始计时，恢复重写的历史仅读取一次。 |
| 临时目录与委托 socket | `391f6ab00`、`b65cfd1ed`、`a3147f8d0`、`fc200620a`、`dbe20198e` | socket 避开本机与其他进程的 scratch 根，覆盖别名与相对路径；清理保留本进程采用的临时目录。继续使用 Electron 的直接 socket 绑定，不引入上游 staged rebind；保留所有者、0700 和符号链接拒绝。 |
| 安装状态 | `7dd0f9822` | npm 命令已消失则清空已安装版本并广播刷新；仍可启动但暂时读不到版本时保留缓存。额外保留 MaxCode 对 bootstrap/native npm 包的实际运行时验证。 |
| Pi 信任 | `b837329a1` | `.pi/mcp.json` 纳入项目资源清单，并明确标记其中可能启动代码；只有该文件的项目同样触发已有授权确认。 |
| 依赖与渲染 | `b260371b0`、`950659fb8` | 更新 Tiptap/ProseMirror、Streamdown、Mermaid、KaTeX、Monaco 与相关兼容依赖，迁移 Vitest 4/Vite 8；真实渲染覆盖浅色高亮、单层边框、公式晚加载和全屏表格工具栏。保留 MaxCode 统一中性代码卡片与紧凑按钮，适配新版 actions 容器。 |
| ZCode | `610b2a36d`、`67d257faf`、`a71e06cb1`、`2d2d85a9e`、`1517ac94e`、`d08c488a1`、`55ed789f6` | 按用户要求完整采用上游社区 `zcode-acp-server@0.72.0` 集成，包含运行时发现、显式路径校验、Node 选择、新会话模式确认、stdio MCP 与 ACP 历史。保留宿主 Electron 和七智能体范围。 |

ZCode 删除下游原生 SQLite 历史解析、ACP/原生 ID 别名、旧环境变量与模型/模式
迁移、默认关闭、模型提供者重映射、隐藏 Plan、恢复时强制模式重置及专属自动标题。
共享技能目录也遵循上游不声明的行为，科学技能状态列表不再包含 ZCode。
历史文件不删除。新会话采用上游独立 ACP 记录；旧原生会话不会通过已删除的解析器
继续导入。上游暂未验证的附件与消息级 fork 限制照常保留。

原 `agents.zcode-community-acp-adapter` 转入 `retired`，新约定登记为
`agents.zcode-upstream-20261020`。新增手机恢复与统计、安装探测和 ZCode 的独立
行为契约，并扩展已有 scratch 与代码卡片契约。更新 `AGENTS.md` 防止未来恢复
已经明确删除的 ZCode 定制。

## 验证

- `pnpm upstream:guard --maxWorkers=4`：清单有效，229 个契约文件、1213 项测试通过。
- `pnpm test --maxWorkers=4`：740 个文件、8680 项测试通过。
- `pnpm eslint .`：通过。
- `pnpm build`：通过，Next.js 16.4.2 静态导出成功。
- `cargo test --no-default-features --bin codeg-server --lib`：共享库 4422 项通过，
  2 项原有忽略；服务器入口 2 项通过。
- `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings`：通过。
- `cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp`：通过。
- `git diff --check`：通过。原 stash 内六个未跟踪文件逐字节比对保持一致。

首轮 Rust 的两项失败均来自测试适配：安装探测测试改用 MaxCode 实际支持的
`~/.codeg/npm-global/bin`，科学技能测试移除上游 ZCode 不再声明的共享目录预期；
修正后全量重跑通过。ZCode 模式门控使用内存 ACP 对端验证，尚未执行登录真实
ZCode 后的付费模型端到端请求。

`pnpm audit --json` 剩余 4 项：Monaco 固定 DOMPurify 3.4.15 的两项低危、
开发工具链 braces 3.0.3 的一项高危、Electron 构建工具可选 sprintf-js 1.1.3 的
一项中危。本轮未通过改审计结果或忽略规则消除这些报告；可兼容更新的相关依赖已
实际更新，未将审计状态描述为全绿。
