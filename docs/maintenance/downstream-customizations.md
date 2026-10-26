# MaxCode 下游功能清单

2026-10-26 发布检查：Codex 2.2.2 私有适配补丁在匹配前统一 CRLF/LF 换行，兼容 Windows 检出及包文件；保留全部锚点唯一性检查，未知或已转换适配器仍不声明原生插话能力。契约：`codex-native-steering.contract.rs`。

2026-10-26 发布草稿：发布重跑分页查找并复用唯一的同标签草稿，多个草稿或已发布标签明确失败；附件检查和最终发布使用同一个 release ID。保留 Electron 构建、签名和安装包校验，不恢复旧 Tauri 发布链路。契约：`release-draft.contract.test.ts`。

2026-10-26 智能体同步：Claude ACP 0.94.0、Grok 1.0.62、Antigravity 1.4.1、ZCode ACP 0.76.2。同步取消后工具状态、后台中间结果、预测提示、Remote Control 与 fork 子智能体计费修复；保留七智能体目录、托管安装优先级、分组空闲回收及隐藏后台任务条。契约：`agent-updates-20261026.contract.test.ts`、`claude-fork-accounting.contract.rs`。

2026-10-25 依赖安全：CI 在推送、PR 和每周定时扫描前端全部依赖及 Rust 锁文件。`scripts/audit-rust.mjs` 仅在全平台、全 feature 的依赖树均不含 RSA 时，豁免 SQLx 可选 MySQL 锁文件依赖的 `RUSTSEC-2023-0071`（无修复版本）；一旦 RSA 变为可达依赖，CI 必须失败。已知不健全依赖同样阻断 CI，停止维护告警继续显示。

2026-10-25 安全边界：待办附件上传（含 MinIO）限制单文件 100 MiB、元数据大小、请求总量、并发数及读取时间；服务器页面添加 CSP、防嵌入及无引用来源响应头，Office 预览在直接打开时仍强制沙箱。契约：`todo-upload-bounds.contract.rs`、`server-security-headers.contract.rs`。

2026-10-23 手机工作区下载：票据在原有 60 秒有效期内允许 HEAD 探测和重复 GET，兼容浏览器向系统下载器交接；备份仍使用一次性票据。契约：`mobile-download-retries.contract.test.ts`。

2026-10-23 回复操作栏移除模型信息和 Token 统计图标，保留消息操作、完成时间及跳回提问功能。契约：`reply-actions-no-metadata.contract.test.tsx`；热点：`chat.reply-actions-no-metadata`。

2026-10-23 操作反馈：新发送/首次非空回复在进入视口后播放 360ms、12px 入场，完成播放后去重，取消的动画允许重试，等待文案交接淡出，已观察到的回复结束时淡入标题并在末尾短暂显示淡入淡出的 ✓（不显示结束文案）；回到底部按钮淡入淡出，侧栏关闭保留内容至过渡结束，侧栏/终端内容跟随原尺寸动画淡入淡出；复制对勾及已确认的保存成功提示增加轻量反馈。保留执行区层级，减少动态效果时取消新增位移/缩放。契约：`interaction-feedback.contract.test.tsx`；热点：`appearance.interaction-feedback`。

2026-10-23 精简执行状态栏：移除右侧文件数及增删行数（如 `1F +0/-7`）和对应分隔符，保留原有思考/执行状态、独立时钟图标与耗时及 tok/s。独立契约：`live-turn-no-file-stats.contract.test.tsx`；热点：`chat.live-turn-no-file-stats`。

2026-10-23 等待响应动效：首条回复前采用上游样式的三个灰点，间隔 0.2 秒闪动；保留无障碍等待文案及明确的确认提示，回复到达时淡出同一组三点。减少动态效果时停止三点动画，隐藏会话暂停；实时状态栏保留文字流光。独立契约：`waiting-response-motion.contract.test.tsx`；热点：`chat.waiting-response-motion`。

2026-10-23 统一界面动效：弹窗、菜单、页签、工作台及设置切换采用轻量过渡，按钮提供按压反馈，普通折叠内容平滑展开；保留草稿、滚动位置及会话挂载，不对流式消息/虚拟列表逐行施加动画。系统减少动态效果时保留短淡入淡出，取消新增位移、缩放和高度动画。独立契约：`interface-motion.contract.test.tsx`；热点：`appearance.interface-motion`。

2026-10-23 Tab 聚焦输入框：固定定位的工作区可能使 html 高度为零，根元素 overflow 按视口判断，避免将可见输入框误判为已裁切；继续保留编辑区、终端、弹窗和菜单的键盘行为。独立契约：`tab-to-composer.contract.test.tsx`；热点：`chat.tab-to-visible-composer`。

2026-10-20 会话详情文本选择：详情内容显式允许选中复制，覆盖辅助侧栏外层的禁止选择样式，支持标题、模型、分支、用量与时间。独立契约：`session-details-selection.contract.test.ts`。

MaxCode 与 Codeg 共存：独立 `app.maxcode` 数据/缓存、`.maxcode` 私有目录与 `maxcode` 钥匙串；首次默认桌面启动复制旧数据，不移动或删除源目录。迁移包含只读 SQLite 快照、内部路径和链接重定位、凭据一次性复制及失败重试，已有新目录优先。默认网页端口保持 3080，已有端口配置保留，导入后网页服务需手动重新开启。原生智能体登录与历史仍共用。契约：`product-namespace.contract.test.ts`。详见 [共存与迁移](./maxcode-codeg-coexistence.md)。

2026-10-16 手机文本选择：触屏或触控笔长按仅保留浏览器原生菜单和选择手柄，避免与 MaxCode 选区工具栏重叠；混合设备切回鼠标后恢复快捷工具栏。独立契约：`mobile-selection-menu.contract.test.tsx`。

2026-10-16 会话菜单统一：侧栏对话标题右键与三个点直接打开同一份完整菜单，菜单顺序、禁用状态和操作保持一致；保留未完成主会话的“标记完成”，三个点支持键盘打开。独立契约：`conversation-menu-parity.contract.test.tsx`。

已完成待办的看板和列表显示本地完成时间，独立字段不随编辑改变；重新打开时清空，再次完成时重记。旧记录未知时间显示“—”。契约：`todo-completion-time.contract.test.tsx`、`todo-completion-time.contract.rs`。

本清单以 `upstream/main` 为上游基线，综合检查 `upstream/main..HEAD` 的非发布提交
以及当前工作区改动。机器可读、决定合并阻塞范围的权威版本是
`config/maxcode-upstream-hotspots.json`；本文用于评审和维护。

最近审计：2026-08-31。已先执行 `git fetch upstream --prune`；上游基线为
`769610c626f1`，下游 `HEAD` 为 `d2ac1390c974`，相差 81 个下游提交、425 个已提交
差异文件，另将当时工作区中的新增功能一并纳入。审计时没有尚未合并的上游提交。

2026-10-13 待办恢复：已拉取上游 `aff1e6c2`，运行 `pnpm upstream:impact`
并逐项评审工作台路由、导航及 Forge 任务入口差异。按上游接回保留的待办看板、
列表、任务设置与 Issue/PR 任务操作，不进行全量上游合并。沿用当前任务执行后端、
七智能体目录、Electron/HTTP 运行方式、侧栏样式和消息新开对话草稿行为。


2026-10-14 独立待办：个人版/团队版仅切换待办范围；旧 AI 待办与 Forge 任务操作重新隐藏，旧数据和执行实现保留。新待办采用独立表和组件，团队由创建者本机托管，通过含公网地址的团队码加入，成员填写名称和头像且对待办同权。领取、分配和手动完成替代 AI 执行状态，消息悬浮操作与会话标题菜单可转待办，会话分享快照由团队宿主托管。

待办新建对话默认沿用上一次主动新建会话的文件夹；查看历史和启动恢复不会覆盖该记录，已删除目录回退到当前有效目录或聊天模式。只有已完成待办按服务端每页 20 条分页，搜索覆盖全部已完成记录，个人和团队均适用；其他状态完整查询，翻页或断线不借用其他页、搜索条件或范围的数据。独立契约：`todo-last-new-folder.contract.test.tsx`、`todo-completed-pagination.contract.test.tsx`。

侧边栏新增可排序、隐藏及折叠的“按待办”栏目，按已指定或领取的待办标题归组本机对话。待办入口每次打开独立未发送草稿，正文和来源分别保存；绑定分屏替换旧草稿时沿用草稿归档恢复能力。草稿保留当时的个人/团队范围，首次保存对话时写入独立本机关联表，普通新建对话仍沿用现有草稿复用行为。已有对话也可从“更多”搜索并关联已有待办，支持解除关联，目标会话和范围在打开时固定。关联候选默认只查询当前用户被分配或已领取的团队待办（含已完成），搜索与分页在宿主端先按成员筛选；个人范围保留全部个人待办。对话标题的来源按钮直接打开对应待办详情，可编辑及完成，已完成分页或当前范围不同不影响定位。普通对话和分享链接不会自动推断关联。团队宿主只收到待办查询及操作数据，不收到本机会话 ID 或正文。独立契约：`sidebar-todo-groups.contract.test.tsx`、`todo-conversation-origin.contract.test.tsx`、`todo-conversation-groups.contract.rs`、`todo-conversation-links.contract.test.tsx`、`todo-source-navigation.contract.test.tsx`、`todo-conversation-sources.contract.rs`。

2026-10-16 待办 Markdown 与对象存储：编辑器支持 Markdown 和实时预览，粘贴图片/文件先上传再在光标处插入 URL；团队创建者配置 MinIO 的 S3 API、Bucket、访问密钥、Region 及带 Bucket/CDN 映射的可匿名读取文件地址。密钥仅通过宿主凭据存储保存；成员上传由成员令牌确定团队范围。个人附件保存在上传目录的 `todo-attachments/` 下，数据库只记文件元信息，链接为随机 ID 的读取地址。个人本地文件引用合计限制 100 MiB；团队 MinIO 附件取消应用层大小限制。启动迁移会删除旧数据库内嵌附件，保留待办正文及现有 Markdown URL；不再读取或转换旧附件，并拒绝旧客户端写回该格式。旧文件 URL 不随 MinIO 配置变化重写；未引用的已上传对象不自动删除，可由存储管理员按保留策略维护。独立契约：`todo-attachments.contract.test.tsx`、`todo-attachments.contract.rs`、`todo-minio-settings.contract.test.tsx`、`todo-minio.contract.rs`。

## 2026-10-20 选择性上游集成与 ZCode 替换

评审固定上游 `a86f7a11a`。在 `main` 建立临时分支前保存原工作区快照，
恢复原有待办、分享、DeepSeek 与 Office 改动后执行影响扫描；逐块移植选定提交，
保留 Electron、七智能体范围与其他 MaxCode 交互。详见
[本轮评审](./upstream-review-20261020.md)。

| 范围 | 当前行为 | 保护项 |
| --- | --- | --- |
| 手机返回 | 等本批全部提示与回复落盘再补齐结束回复，保留排队后续、去重、耗时与计费 | `runtime.unseen-reply-accounting-20261020` |
| 长会话统计 | 按提示边界对应耗时与用量；Claude 后台回合不计入此前空闲，恢复重复历史只读取一次 | `runtime.unseen-reply-accounting-20261020` |
| 委托临时目录 | socket 避开所有 scratch 清理范围，处理别名和继承路径，清理保留当前采用的临时目录及原有权限防护 | `runtime.upstream-socket-ask-20260919` |
| 安装状态与 Pi | npm 命令消失即清除幽灵安装状态；临时版本探测失败仍保留可启动安装；Pi 项目 MCP 配置纳入代码执行信任检查 | `runtime.install-detection-pi-trust-20261020` |
| 前端依赖与渲染 | 更新编辑器、Markdown、公式、图表依赖及 Vitest/Vite，保留统一代码卡片与紧凑动作按钮，覆盖真实 Streamdown 输出 | `chat.unified-code-card` |
| ZCode | 完整改用上游社区适配器 0.72.0、官方运行时/Node 发现、模式确认、独立 ACP 历史与 MCP 存储；移除旧原生数据库、别名、默认关闭和模型重映射；2026-10-21 起侧栏标题重新与 Codex/Grok/Pi/DeepSeek/Claude Code 一致走结构化自动生成（`supports_dedicated_auto_title`） | `agents.zcode-upstream-20261020`、`agents.acp-compatibility-and-titles` |

`agents.zcode-community-acp-adapter` 已按用户要求退役。旧版描述仅作历史记录，
不得恢复对应定制。历史文件保留在用户磁盘，本轮只移除旧解析代码，不清除外部数据。

## 2026-10-15 上游 v0.35.2 选择性集成

评审上游 `e2a7d3d77`，从 `main` 建立临时集成分支，并在修改前运行
`pnpm upstream:impact`。相对上次记录的 `aff1e6c27`，新增 81 条提交记录
（66 条非合并提交）、225 个变化文件，其中 125 个与下游定制重叠。保留工作区
原有待办、表单焦点、分享和搜索改动，按提交块评审和适配，不做全量合并。

| 范围 | 吸收结果与下游边界 | 保护项 |
| --- | --- | --- |
| ACP 与连接 | 反馈防空轮询、结构化继续指引、大图伴随回合去重、握手取消和终端清理；草稿启动中允许切换智能体，最后选择生效，错误与配置归属所选智能体；保留发送队列、会话模型记忆、暖连接和 ZCode 门控 | `runtime.selected-upstream-20261015`、`chat.startup-agent-switch-20261015` |
| 历史目录 | 按保存的环境变量读取六种维护智能体的数据目录；ZCode 同时保留自定义目录、原生数据库与别名兼容 | `runtime.selected-upstream-20261015` |
| 协议与版本 | Claude ACP 0.90.0、Codex ACP 2.2.2、Grok 1.0.52、Antigravity 1.4.0；补审中间适配，失败回合以系统行进入实时、历史及导出，原生问答支持完整多选标签 | `runtime.selected-upstream-20261015`、`chat.reviewed-acp-rendering-20261015` |
| PDF 与下载 | 现有文件栏和抽屉内只读查看 PDF，资源随静态导出打包，保持安全链接路由；预览头可下载工作区外产物，其他二进制产物仍可系统打开 | `files.pdf-office-download-20261015` |
| Office | 切换标签保留预览、阅读位置和租约；冷启动有界等待，退出同步终止已经启动和尚在启动的进程；沿用 Electron HTTP 与 opaque sandbox | `files.pdf-office-download-20261015` |
| 会话导航 | 现有左侧横条覆盖全历史，校验 outline 与分页指纹后加载跳转；保留问答摘要、溢出显隐和手机隐藏，不恢复旧导航卡片；向上跳转解除自动跟随底部 | `chat.full-history-rail-20261015` |
| PWA 与手机 | 唯一 SW 注册入口按 frontend build ID 隔离缓存，缓存启动页，失败安装不破坏活动缓存，Electron 排除；返回手势按层关闭现有查看器 | `web.offline-mobile-provider-groups-20261015` |
| 委托默认模型 | 按提供商分组并在默认值提示中标出渠道，目录仅显示七种维护智能体 | `web.offline-mobile-provider-groups-20261015` |

本次不吸收 Forge 自动扫描/入队、维护范围外智能体专属更新、旧 Tauri
浏览器和原生远程工作区实现，也不引入新的待办执行入口。Pi、DeepSeek、ZCode
保持已审版本与现有适配器；发布版本号不随上游 Codeg 版本改变。

## 智能体维护范围

维护 Claude Code、Codex、Grok、Pi、DeepSeek、Google Antigravity 和 ZCode。
2026-09-26 将 ZCode 切换为社区 ACP 适配器，并恢复设置与新会话入口。
2026-10-20 起 ZCode 完整跟随上游集成，旧的默认关闭约定已退役。当前说明见 [ZCode](../agents/zcode.md)。
其他智能体保留历史数据、解析器和适配代码，但不出现在设置或新会话目录中，
不执行后台自动更新，也不吸收其专属上游变更。新增自定义智能体入口隐藏。
下方早期版本目录记录仅作为历史来源，不代表当前维护范围。

ZCode 专属模型注册表重映射已于 2026-10-20 删除，模型与思考选项直接遵循上游 ACP 配置更新。

2026-09-30 版本评审依据：[Claude ACP 0.84.0](https://github.com/agentclientprotocol/claude-agent-acp/releases/tag/v0.84.0)、[Codex ACP 2.0.1](https://github.com/agentclientprotocol/codex-acp/releases/tag/v2.0.1)、[Pi ACP 0.0.34](https://github.com/svkozak/pi-acp/releases/tag/v0.0.34)、[Grok 1.0.44 npm 元数据](https://registry.npmjs.org/@xai-official/grok/1.0.44)、[ZCode ACP 0.53.2](https://github.com/william0wang/zcode-acp/releases/tag/v0.53.2)。已比较发布包并检查五个新版的真实 ACP 初始化响应；初始化检查不涉及付费模型请求。ZCode 分叉响应仍使用 `forkedSessionId`，Plan 修复尚未经过原生运行时端到端验证，因此保留相关门控。Pi 0.0.33 的补丁继续按实际安装版本触发，新版不改写包文件。Claude/Codex 的 AIR 目标、审批、子智能体与压缩标记映射到现有消费者；Claude 稀疏更新保留工具身份而不重复终端输出。

## 活跃功能

| 领域 | 功能 | 来源 | 保护项 |
| --- | --- | --- | --- |
| 对话模型记忆 | 模型与思考等级按对话保存在 SQLite；历史恢复自身配置，旧对话优先原生会话值，新对话沿用最近默认值，配置确认后持久化且不改变最近排序；重开时立即展示按对话缓存的已确认选项，连接完成前只读，最多缓存 32 个对话，仅保存已选值和名称，按对话单独读写以避免同步处理完整模型目录；缓存缺失时从对话摘要中的 SQLite 配置显示模型与思考等级，无需等待智能体启动 | `worktree-2026-10-12` | `chat.conversation-model-memory` |
| 设置选项搜索 | 搜索现有设置项名称、说明与关键词，显示所属栏目及无结果提示；懒加载后定位高亮，保留草稿、远程参数与移动导航，不修改设置值或恢复隐藏入口 | `worktree-2026-10-11` | `settings.option-search` |
| 会话状态常驻 | 悬停和打开操作菜单时保持运行中、未读及时间提示；置顶和完成收进独立菜单，支持键盘与触屏且不误选会话 | `worktree-2026-10-11` | `conversations.persistent-sidebar-status` |
| 连接中提交 | 会话及欢迎页连接中可回车入队，消息可编辑、删除；初始化完成后顺序自动发送，慢连接及失败保留消息并提供重连，预览标签自动固定 | `worktree-2026-10-10` | `chat.connection-submit-queue` |
| 设置加载 | npm 元数据探测限时并终止卡住的命令，七种智能体版本并发探测；Electron 安装包冒烟验证设置子窗口加载智能体目录 | `worktree-2026-10-10` | `settings.agent-probe-deadline` |
| 文件标签 | 桌面 Word 等文件标签菜单提供“在访达中打开”，定位并选中文件；Windows/Linux 使用对应文件管理器文案，网页及无路径标签隐藏入口，失败显示提示 | `worktree-2026-10-08` | `files.tab-file-manager` |
| 10 月 8 日八项修复 | 线性历史读取、手机聚焦、任务保存所示智能体、Grok 目录广播、Claude 0.86/Codex 2.1.1 兼容、插话保留编辑及搜索管道无匹配；保留 Electron、七智能体、Codex 插话门控和不确定投递保护 | `f0e6a520` 至 `3b29d2f4`，详见本次评审 | `runtime.selected-upstream-20261008` |
| 9 月 30 日上游稳定性 | Claude/Codex AIR 稀疏更新、Read/审批/插件提示，Codex 搜索上下文与历史思考、压缩摘要，Grok 后台跟进；保留完整工具输入、全部 hunk 和权限门控 | `9d9ce6b0`、`2db8a81b`、`b35282c6`、`757bd8e0`、`58f0fd0e`、`9243c7df` | `runtime.upstream-recommended-20260930`、`history.claude-compaction-compatible` |
| Codex 模型目录 | GPT-6.1 Sol 及官方优先级；安装和托管更新刷新自有目录，保留用户目录、默认、自定义和排除模型 | `155916e6`、`worktree-2026-09-30` | `agents.codex-catalog-refresh-20260930` |
| Pi 运行时与思考 | 离线能力、实际 profile 和原生 selector；保留七档偏好、自定义映射、旧 .33 补丁及托管 CLI | `9cbd5b96` 至 `b9d9e6b6` | `agents.pi-runtime-thinking-20260930` |
| HTML/visualize | 内联预览、延迟提及、会话相对资源，隔离 origin/CSP 与每文件信任，脚本默认关闭，公开分享只读 | `20687bb4` 至 `0e5ac772` | `chat.upstream-html-preview-20260930` |
| Recent 筛选 | 分类先于十条分页，记忆筛选并准确显示余量，保留独立分页、折叠和新建聊天 | `e36c8ed4` 至 `caca52f6` | `sidebar.recent-filters-20260930` |
| 会话通知 | 关闭窗格后按持久会话命名，保留 MaxCode 隐私、静默重放和 owner 登录动作限制 | `09d74bce`、`d2e86448`、`2db8a81b` | `runtime.session-notifications-20260930` |
| 设置页视觉统一 | 参考分组设置界面统一侧栏、页面标题与留白、细边框卡片、输入/复合控件及错误提示；页边距不影响嵌套列表，说明样式不覆盖警告/错误颜色，折叠箭头保持可见 | `worktree-2026-09-26` | `settings.reference-grouped-style` |
| 上游第二批集成 | Antigravity 1.2.1、Grok 1.0.41；共享服务更新目录权限预检且保留 Electron 安装器；聊天/任务图片附件编号框和箭头标注，上传成功原子替换 URI，失败恢复原图 | `f773185a`、`d8c3d54e`、`f0b5bfc5`、`ab8e4fd4` | `runtime.upstream-second-20260926` |
| 上游稳定性集成 | 草稿绑定后跨分栏移动保留运行时，Codex 回退历史、ACP 撤销/断连、Claude 工具参数和附件去重、文件链接、代理本机直连；保留 Electron、标题模型与公开分享策略 | `81163947`、`1a347230`、`6aaac6f9`、`94a17675`、`dd13b595`、`b18fa74d`、`0a802c9e` | `runtime.upstream-priority-20260926` |
| Antigravity 品牌图标 | 共用智能体图标采用 Google 官方彩色 SVG，本地离线加载，保留原始蒙版和色彩滤镜 | `worktree-2026-10-23` | `appearance.antigravity-color-icon` |
| Pi 品牌图标 | 共用智能体图标采用 pi.dev 官方三色 SVG，与 CC Switch 一致，保留原始比例及粉红、蓝、金黄配色，移除旧黑底白色版本 | `worktree-2026-10-23` | `appearance.pi-official-icon` |
| 外观主题 | 设置中可选择默认或 HBuilderX 暖黄；暖纸色画布、蓝灰正文、绿色强调色及编辑器背景同步，选择持久化并在首帧生效，其他高级外观设置继续隐藏 | `worktree-2026-09-24` | `appearance.hbuilderx-warm-theme` |
| Claude 命令审批 | ACP 0.79、PowerShell 归一化、特殊 Shell 命令完整展示，保留显式拒绝优先和独立 CLI 更新 | `afdcfe0b` | `agents.claude-079-command-approval` |
| Pi 上下文容量 | 按 provider/id 读取 models.json，支持默认值、重复声明及覆盖层，保留历史计时和用量 | `07653466`、`7d74c791`、`29e435ef` | `history.pi-declared-model-window` |
| Office 预览清理 | 同步发出终止信号、异步回收，关闭时不依赖任务调度 | `65588b03` | `runtime.office-watch-immediate-reap` |
| 待回答提问卡 | 正常布局中折叠，保留选择；新问题和提交失败自动展开，沿用现有问题卡视觉 | `d3c3ecd6`、`3d81d7cc` | `chat.pending-question-collapse` |
| 模型显示名称 | 按连接所属智能体记录名称，历史回复与会话详情统一；只改显示，不改原始模型 ID 和费用 | `78c9313b` | `chat.agent-model-display-labels` |
| 操作按钮颜色 | 发送、两种运行中停止和正常更新按钮恢复统一使用 `#216AE4`，深浅色一致，白色图标及 90% 不透明度悬停；停止保留方块图标与无障碍标签，保留禁用与错误状态 | `worktree-2026-09-18`、`worktree-2026-09-26`、`worktree-2026-10-11`、`worktree-2026-10-12`、`worktree-2026-10-13` | `appearance.send-button-brand-color` |
| 六种智能体上游适配 | Codex 1.12 / Claude 0.78 协议与推荐值、Grok 1.0.30、DeepSeek 代际恢复、草稿与连接提示、临时目录及缓存迁移；保留现有布局、计时和独立 CLI 自动更新 | `39506eb5`、`bd9b6038`、`d74eec45`、`b84e76c6`、`50fff85f`、`51ded76b`、`86b4bb7a`、`e4c38963`、`594024db`、`worktree-2026-09-17` | `agents.six-agent-upstream-20260917` |
| 智能体维护范围 | 设置、选择器、旧缓存与自动更新保留七种（新增 ZCode），隐藏自定义新增入口 | `worktree-2026-09-17`、`feat/zcode-agent` | `agents.maintained-catalog` |
| ZCode 智能体 | 上游 `zcode-acp-server@0.72.0` 集成，官方 CLI 与兼容 Node 发现、显式路径校验、模式确认、MCP 转发与独立 ACP 会话记录；不读取原生 SQLite 历史，不恢复旧模型/模式适配 | `610b2a36d` 至 `d08c488a1`、`worktree-2026-10-20` | `agents.zcode-upstream-20261020` |
| 科学技能状态 | 保留历史智能体状态，同时为维护范围内有技能目录的 Grok、DeepSeek、Antigravity 补齐状态行；ZCode 跟随上游不声明共享技能目录；不引入其他智能体的新入口 | `45b9a7ec`、`b66f35eb`、`worktree-2026-09-23` | `skills.science-maintained-status` |
| 会话代码块 | 标题与正文统一中性底色、无中间分隔线，缩小语言标签和操作图标；适配深色与工作区背景 | `worktree-2026-09-16` | `chat.unified-code-card` |
| 工具卡片 | 带 `query` 参数的 MCP 调用保留真实工具名；仅在标题/类型明确为网页搜索（含 Codex `web search`/`open page`/`find in page`）时归类为 WebSearch，普通 `kind: "search"` 仍为本地 grep | `fc8cad0c`、`a47c68a9`、`worktree-2026-09-14` | `chat.query-bearing-mcp-names` |
| 消息图片 | 回复里的本地 Markdown 图片在当前会话工作目录内联显示，文件链接徽章与自动路径链接保持不变 | `402d8b09`、`049ef608`、`worktree-2026-09-14` | `chat.local-markdown-images` |
| 输入框右键 | 右键先选中指针下的词，剪切/复制可用；链接/邮箱/本地路径多一行打开，沿用现有打开器白名单 | `06a2a503`、`0ebad4aa`、`worktree-2026-09-14` | `chat.composer-token-action` |
| 文件徽章 | 网页/远程工作区的文件名右键可下载；本机桌面仍用打开/显示/复制路径 | `f39ff3e2`、`worktree-2026-09-14` | `chat.file-badge-download` |
| DeepSeek 模型目录 | 设置页保留 Key/URL 面板，并编辑 Harness 模型列表；适配器 0.9.0。v3 历史与首 token 计时保留 | `5a20a569`、`193046cb`、`worktree-2026-09-14` | `settings.deepseek-model-catalog` |
| 图片 Diff | PNG/JPEG/WebP/GIF/BMP/ICO 等二进制图片在工作区、提交、推送和恢复暂存评审中显示有界的前后对比；缺失、过大与读取失败分别呈现，非预览桌面产物仍交给系统应用 | `504fc279`、`worktree-2026-09-15` | `workspace.binary-image-diffs` |
| 命令颜色 | Agent 命令默认不强制 ANSI；用户可在通用设置显式开启完整颜色环境，保存时不覆盖默认 Shell，Agent 自定义环境仍优先 | `1d4d0074` 至 `c9e25be7`、`worktree-2026-09-15` | `settings.command-color-opt-in` |
| Antigravity 账号 | OAuth 登录可安全退出并切换 Google 账号；退出前阻断新连接并停止存活进程，调用 ACP logout 后恢复认证方式，同时保留 stdout/stderr 双流登录链接识别 | `7861d6ed`、`de096bb4`、`worktree-2026-09-15` | `agents.antigravity-sign-out` |
| Codex 子智能体 | 原生子智能体胶囊显示真实结束状态和最终报告，可打开子会话；`list_agents` 还原为协作胶囊，保留 MaxCode 费用、耗时、上下文过滤与既有会话查看器 | `34b0f7fb`、`worktree-2026-09-15` | `chat.codex-native-subagent-results` |
| 9 月 30 日智能体更新 | Claude ACP 0.84.0、Codex ACP 2.0.1、Pi ACP 0.0.34、Grok 1.0.44、ZCode ACP 0.53.2；恢复 Claude AIR 文件输入、保留 Codex 同文件全部 Diff 片段并同步卡片与行数统计。ZCode 分叉/Plan 限制继续保留，等待原生运行时模式转换验证 | `worktree-2026-09-30` | `agents.release-file-changes-20260930` |
| 智能体版本目录 | 内置安装及强制自动更新目标采用已评审版本；OpenCode 1.18.30 的六个平台资产继续要求独立 SHA256 | `8c461154`、`1055edc4`、`e588125b`、`25882257`、`worktree-2026-09-15` | `agents.reviewed-version-catalog`、`agents.opencode-verified-distribution` |
| 智能体自动更新 | 维护范围内已启用且已安装的智能体强制后台更新，支持 npm（含 ZCode 社区适配器）、二进制、Python，无独立开关；独立目录下载验证，空闲时原子切换，失败保留旧安装 | `worktree-2026-09-14`、`feat/zcode-agent`、`worktree-2026-09-26` | `settings.agent-auto-updates` |
| 智能体安装 | 手动 npm 安装、升级、重试及自定义包查询使用 npm.aifalao.net；在线版本检测与自动安装使用官方 registry.npmjs.org，适配器与 CLI 独立检测 | `worktree-2026-09-14` | `settings.agent-npm-mirror` |
| 自动任务 | 空白及模板新建默认不勾选「每次运行新建 worktree」，使用所选文件夹；编辑保留已保存的隔离设置，允许手动勾选 | `worktree-2026-09-11` | `automations.worktree-opt-in` |
| 跨端已读 | 手机与桌面共享后端已读回执，实时广播并在重连及恢复前台时补同步 | `worktree-2026-09-10` | `conversations.cross-device-read` |
| 手机设置 | 右上角分类菜单显示在设置页之上，可切换分类、点击空白或 Escape 关闭；保留设置及工作区草稿，隐藏后台工作区抽屉并在返回时恢复 | `worktree-2026-09-10` | `settings.mobile-category-navigation` |
| 移动端 | 恢复前台及网络重连后检查并恢复当前会话，连接中、未连接、连接错误均持续 3 秒才显示；状态或会话变化重新计时，已连接立即恢复，持续掉线保留红色提示 | `worktree-2026-09-10` | `chat.mobile-session-recovery` |
| 手机消息恢复 | 唤醒复用会话时补齐遗漏事件及已完成回复；服务器断联覆盖滞留的智能体“已连接”状态，重连只恢复消息链路。连接及应用就绪均有超时，唤醒缩短心跳期限，服务器控制响应不等待自身负责排空的事件队列 | `worktree-2026-10-02` | `web.mobile-live-recovery` |
| 会话 | Pi 启动横幅（pi 版本 / Context / Skills）不进入对话：实时流直接丢弃，与完成后的持久化转写保持一致，不再先显示后消失 | `worktree-2026-09-11` | `chat.pi-startup-banner-suppressed` |
| 对话选择 | Codex 参考样式：加重问题标题、浅灰选项底色与细边框、选中加深描边及反色编号、底部操作分隔；保留显式提交与键盘选择 | `worktree-2026-09-10` | `chat.reference-question-picker` |
| 消息超链接 | 可点击的 Markdown 超链接显示小手光标，流式生成中未完成的链接保持不可点击样式 | `worktree-2026-09-15` | `chat.markdown-link-cursor` |
| 会话列宽 | 桌面会话内容列右缘提供拖宽抓手，悬停热区才浮现发丝线与 grip；拖动居中列实时对称伸缩，钳制 40–80rem，防抖持久化并预水合应用，跨窗口同步，双击或 Enter 恢复默认 48rem；手机端不参与，列始终满宽 | `worktree-2026-09-15` | `chat.column-width-drag` |
| 消息文件链接 | 文件名按容器宽度完整换行，兼容手机；按真实路径、特殊文件名和复合扩展名匹配 VSCode Icons 原生彩色图标，离线资源支持明暗主题，保留紧凑输入框徽标 | `worktree-2026-09-11` | `chat.file-link-presentation` |
| 消息 | Codex 后续建议标记渲染为按钮，点击追加到当前输入框；只读页面显示标签，代码示例保持原文 | `worktree-2026-09-11` | `chat.codex-followup-controls` |
| 消息 | 历史回复正文到操作按钮保持连续悬停区域，悬停/键盘聚焦时抬高实际虚拟行层级（悬停优先），按钮不被下一条消息的透明间距遮挡，提示气泡打开时保持操作区可见及层级，保留原消息间距 | `worktree-2026-09-10` | `messages.action-hover-continuity` |
| 消息 | 消息的新对话操作带入原文草稿并保留项目和智能体，不自动发送；相邻的独立待办操作可另行创建待办 | `worktree-2026-09-10` | `messages.new-chat-from-message` |
| 待办入口 | 侧栏和快捷菜单打开独立的新待办；旧 AI 待办、Forge 任务按钮和新自动化入队入口隐藏，历史数据保留；导航显隐偏好及手机收起行为保留 | `worktree-2026-10-14` | `tasks.workbench-entry-points` |
| 团队待办 | 个人/团队范围隔离并记忆，创建者本机托管，团队码加入、头像名称、成员同权、领取/指定/完成、空标题自动生成及对话双向联动；待办新对话沿用上次新建目录，已完成服务端分页与跨页搜索；独立成员凭据与分享快照，离线不串数据 | `worktree-2026-10-14` | `todos.personal-team-collaboration` |
| 待办会话分组 | 侧边栏按已分配待办归组从待办新建的本机会话；草稿来源记忆及首次保存关联、个人/团队范围切换、独立于已完成分页、复用现有会话卡片与手机导航 | `worktree-2026-10-14` | `todos.sidebar-conversation-groups` |
| 浏览器稳定性 | 跨客户端详情同步合并重复通知，每轮最多五次退避请求，阻断元信息事件反馈造成的请求堆积 | `worktree-2026-09-09` | `chat.viewer-sync-request-bounds` |
| 会话费用刷新 | 回复结束后同步累计计费用量；定价目录缓存 6 小时，前台定时检查、回到前台补查，离线保留旧价格，无需切换会话即可更新输入框底部金额 | `worktree-2026-09-10`、`worktree-2026-09-30` | `composer.conversation-cost` |
| 上下文用量详情 | 参考式大号百分比、已用/容量横条、关闭按钮和彩色累计 Token 明细；累计统计与当前上下文分开标注，未知分类不伪造，窄屏自适应并限高滚动 | `worktree-2026-10-09` | `composer.usage-popover` |
| 会话指标 | 中文回合数显示为「回合2」；状态栏美元费用有金额后才显示，并固定显示两位小数；无金额时隐藏费用及分隔符，详情保留更高精度 | `worktree-2026-09-09` | `composer.metric-layout`、`composer.conversation-cost` |
| 桌面角标 | macOS Electron Dock 显示侧栏可见会话的未读数，读完清除 | `worktree-2026-09-09` | `desktop.electron-dock-badge` |
| 会话状态 | 参考图样式：执行中为 12px 灰色细环，未读为 8px 实心蓝点 | `worktree-2026-09-09` | `conversations.reference-status-indicators` |
| 分隔线 | 面板拖动分隔线默认 1px，悬停和拖动时 2px，保留宽鼠标命中范围 | `worktree-2026-09-09` | `workspace.subtle-resize-handles` |
| 会话标题 | 标题旁常显三个点，点击打开会话操作菜单；重命名收进菜单，移除独立铅笔按钮 | `worktree-2026-09-09` | `conversations.title-overflow-menu` |
| 设置 | 智能体初始顺序固定为 Codex、Grok、DeepSeek、Pi、Antigravity、Claude、Gemini、OpenClaw、OpenCode、Cline、Hermes、CodeBuddy、Kimi、Cursor、Qoder；保留已保存的手动排序 | `worktree-2026-09-08` | `settings.default-agent-order` |
| 手机导航 | 顶部合并为单行会话标题与操作，统一 44px 触摸按钮，搜索/终端/面板/设置收进工具菜单 | `worktree-2026-09-08` | `workspace.mobile-header` |
| 消息 | 已发消息的复制按钮旁提供修改图标，点击即停止当前回复并将原文填入、聚焦底部输入框；修改后由用户正常发送 | `worktree-2026-09-08` | `messages.edit-sent-message` |
| 侧边栏 | “最近”栏目新建入口与“聊天”一致，始终新建不绑定当前文件夹的聊天 | `worktree-2026-09-08` | `conversations.recent-new-chat` |
| 侧边栏 | 收起“文件夹”分区时同步收起所有文件夹的对话列表并重置分页，再展开分区时保留文件夹折叠状态 | `worktree-2026-09-08` | `conversations.folders-section-collapse` |
| 侧边栏 | 保留新对话（简体中文固定文案）、自动任务、待办任务及会话列表，仓库面板不加入侧栏；待办和自动任务支持显隐设置；待办导航及文件夹、最新、聊天新增入口统一在手机/触屏导航后收起侧栏 | `worktree-2026-09-08`、`worktree-2026-10-13` | `workspace.sidebar-navigation` |
| 发布 | Electron 原生架构安装包、打包后启动验证、完整产物与签名门禁；旧 Tauri 壳与兼容 CI 已退役 | `worktree-2026-09-08` | `desktop.electron-release-pipeline` |
| 桌面更新 | Electron 稳定版差分下载、完整包回退、跨窗口进度与后端退出后安装；架构独立清单和 blockmap；GitHub 过慢或不可达时走 maxcode-update.aifalao.net | `worktree-2026-09-08` | `desktop.differential-updates` |
| 桌面 Web 服务 | Electron 独立对外监听供手机 URL 访问，保留端口、Token、自动启动，关闭对外服务不影响桌面连接 | `worktree-2026-09-09` | `desktop.electron-web-service` |
| 手机侧栏 | 搜索、定位当前对话、更多设置与侧栏标题同排，移除独立工具行；44px 触控区域，展开/折叠收进更多菜单，打开搜索时收起侧栏 | `worktree-2026-09-09` | `sidebar.search-tools` |
| 手机布局 | 浏览器由工作区预留底部安全区；Android APP 由原生层避让导航栏/键盘，注入样式取消新旧网页外壳的重复底部安全区（所有机型），输入框仅保留 8px 间距 | `worktree-2026-09-09` | `mobile.composer-bottom-gap` |
| 桌面 | Electron 默认入口、安全原生桥接、认证本机后端、偏好保留、退出清理与安装包更新归属 | `worktree-2026-09-08` | `desktop.electron-runtime` |
| 会话 | Codex AGENTS 指令兼容无路径标题和 Windows CRLF，过滤历史消息、标题与计数，保留普通提问 | `worktree-2026-10-22` | `chat.codex-agents-context-filter` |
| 会话 | Codex 插件推荐上下文不显示为聊天消息，不参与标题或计数 | `worktree-2026-09-07` | `chat.codex-plugin-context-filter` |
| 会话 | 所有聊天顶部不显示后台任务栏，后台任务执行与对话内命令记录继续保留 | `worktree-2026-09-07` | `chat.no-top-background-task-strip` |
| 会话 | 模型工作状态（等待响应、思考中、流式输出、正在使用工具、等待你）只显示文案，左侧不放状态图标；agent 图标、耗时和 tok/s 保留；工具卡片状态图标保留。上游 activity-feedback 不得把左侧图标加回来 | `worktree-2026-09-21` | `chat.live-turn-status-text-only` |
| 思考 | 流式思考默认单行折叠，手动展开后限高滚动，更新及完成时保留手动选择 | `worktree-2026-09-08` | `chat.compact-reasoning` |
| 会话 | 回复运行时摘要展示、完成后折叠过程、保留最终答案及手动偏好 | `108154e4`、当前工作区 | `chat.reply-folding` |
| 会话 | 按文件夹/聊天范围记住智能体，按明确优先级选择新会话默认智能体 | `dc86bec0`、`16941c88` | `conversations.agent-defaults` |
| 会话 | 未读检测、可见会话消除未读、全部已读、状态颜色和状态操作开关 | `53144985`、`06bb8457`、`c283e981`、`8d9cb933`、`1a4a3532` | `conversations.unread-and-status` |
| 会话 | 分享入口仅保留在三个点菜单内，顶部不显示独立分享按钮；以可撤销能力链接分享不含本地元数据路径的只读会话快照，显式公网地址优先、Web/局域网/本机地址依次回退；公开 Markdown 仅开放外部链接，正文中的本地目标保持只读 | 当前工作区 | `conversations.read-only-sharing` |
| 侧边栏 | 完成会话默认隐藏、分区/工作树/分页、文件夹拖动稳定性、新建及重开文件夹排序 | `108154e4`、`bae6751c`、`9eaecc27`、`2245d322`、`7ca7b5b3`、`16941c88`、当前工作区 | `conversations.sidebar-folder-interactions` |
| 导航 | 固定宽度可滚动标签、触控板拖动阈值、移动端导航收起、正文原生选择 | `7a445edf`、`f60fecca`、`eb9cee07`、`7ca7b5b3` | `navigation.tabs-touch-and-selection` |
| 消息 | 普通本地路径自动变成文件引用，安装包等二进制产物可打开或在文件管理器显示；Codex 来源和产物引用显示文件名及工作表/单元格位置 | `7ca7b5b3`、`06bb8457`、`c283e981` | `messages.local-paths-and-artifacts` |
| 消息 | 系统字体默认值及代理未提供耗时时的“提示到完成”耗时推导 | `d61af64a` | `messages.system-font-and-duration` |
| Web | 同步事件/回放/快照处理失败后更换订阅并拉取完整快照，隔离旧帧；连续失败退避重试，清理时取消定时器；恢复允许修复相同序号状态，拒绝更旧快照 | `worktree-2026-09-26` | `web.event-handler-snapshot-recovery` |
| Web | 断线不清凭证、健康探测退避重连、恢复订阅、仅有凭证的 401 判定会话过期 | `352bc868`、`2c859b2a` | `web.auth-and-session-recovery` |
| Web | 服务器/Docker 可安装 PWA，Electron 环境不注册 Service Worker | `cbd85449`、`bddabc51` | `web.pwa-installation` |
| 更新 | MaxCode 更新源、状态栏更新体验、发现/忽略持久化、打开面板时关闭遮挡 Toast | `b558e9bb`、`ba09a7b5`、`dceb62ac`、当前工作区 | `updates.maxcode-channel-and-ui` |
| 会话侧栏 | 主动取消后不显示红色 X，正常显示时间，保留运行中与未读提示 | `worktree-2026-09-08` | `conversations.cancelled-without-error-badge` |
| 会话标题 | 移除会话、侧栏及标签菜单中的手动刷新标题入口和前端请求封装；保留自动标题与重命名 | `worktree-2026-09-10` | `conversations.manual-title-refresh` |
| 会话标题 | 标准化 MMDD｜类型｜主题，重试无效响应；打开会话时按首条用户消息补生成，纯图片消息使用首轮助手文字回复，不跨后续用户轮次、不发送图片载荷；5 分钟冷却、保护锁定名称，失败日志不含凭证 | `worktree-2026-09-07` | `conversations.structured-title-recovery` |
| 智能体 | ACP 注册/预检，Codex、Grok、Pi、DeepSeek Harness、Claude Code 专用模型生成 MMDD｜类型｜主题 标题，Grok 历史 plan/图片读取兼容 | `108154e4`、`53144985`、`bb6949f5`、`16941c88` | `agents.acp-compatibility-and-titles` |
| 智能体 | 设置页对已开启智能体联网检测发布版本，结果写入侧栏徽标和详情里的「版本状态」分类（不另设更新卡片）；npm 查询实际 ACP 包，其余受支持智能体查询 ACP 注册表；缓存 6 小时并支持在版本状态中强制检查，失败和未知版本不误报最新，npm 新版在版本状态中点升级即按该版本安装，自定义版本仍走输入对话框 | `worktree-2026-09-10` | `settings.agent-online-updates` |
| 智能体 | OpenCode 六个平台的固定版本下载均保留 SHA256 校验；1.18.30 的六个摘要直接从官方 GitHub Release 资产流式计算，不能采用上游空摘要 | `1bf8a772`、`25882257`、`worktree-2026-09-07`、`worktree-2026-09-15` | `agents.opencode-verified-distribution` |
| 智能体 | 活跃连接保活、最近 10 个空闲连接保温 10 分钟（切换或替换面板后仍保留）、冷连接只读探测、繁忙保护、Connecting 看门狗和后台空闲页面卸载；备份恢复读取实际会话状态，保护锁定会话与未退出进程 | `2c859b2a`、当前工作区 | `agents.bounded-connection-lifecycle` |
| 设置 | Pi `max` 思考级别及十种语言标签 | `e1fda1d3` | `settings.pi-maximum-thinking` |
| 附件 | 单文件上传与拖放上限 100 MiB，HTTP multipart 额外预留开销，图片回填支持一张满额图片 | 当前工作区 | `attachments.hundred-mib-upload` |
| Android | 多服务器连接、安全令牌存储、健康检查、WebView 引导、OPPO 状态栏安全区和列表细节；本地附件兼容单 URI 与 ClipData 多选返回 | `bddabc51`、当前工作区 | `android.webview-client` |
| iOS | 独立 WKWebView 壳：与安卓一致的连接页布局/文案/主题、无原生顶栏工作区、固定竖屏/1倍视口、键盘隐藏后恢复底部安全区、冷启动连接选择、原生多连接、设备专属 Keychain、健康检查、同源 Token 注入、内存会话隔离、键盘安全区和前后台恢复 | `worktree-2026-09-14` | `ios.webview-client` |
| 品牌 | MaxCode 名称、图标、文档、安装器和个人仓库链接 | `9eaecc27`、`dc86bec0`、`c7a21a24` | `branding.maxcode` |
| 发布 | 平台白名单、Electron 安装包完整性、服务器签名更新、macOS 签名公证及 MaxCode 产物名 | `dceb62ac` 等发布提交 | `release.signed-multiplatform-artifacts` |
| 维护 | 上游影响扫描、热点清单和独立契约 CI | 当前工作区 | `maintenance.upstream-integration-guard` |

消息导航仅保留左侧横条，移除旧卡片入口（`chat.message-tick-rail`）。
Electron 图片粘贴在浏览器数据不可用时读取原生剪贴板，并保留普通文字粘贴
（`chat.attachment-paste-during-ime`）。

Electron 从 Finder 启动时恢复登录 shell 的 PATH，并兜底标准 Node 安装目录；
安装包启动验证使用精简 PATH（`desktop.electron-runtime`）。

### 会话标题分类边界

标题统一为 `MMDD｜类型｜主题`，类型按用户主要诉求和交付结果选择：

| 类型 | 范围与边界 | 示例 |
| --- | --- | --- |
| 功能 | 实现或扩展新的能力、用户可见行为 | 实现登录功能 |
| 设计 | 实现前的需求、架构、交互或视觉方案 | 只设计登录流程，不写代码 |
| 修复 | 恢复出错或失效的行为；为完成修复而排查也归此类 | 修复登录失败 |
| 优化 | 改善已正常工作的性能、可维护性或体验，不新增能力 | 加快登录速度、重构登录代码 |
| 发布 | 版本、打包、部署、发布流水线、分发 | 打包并发布安装程序 |
| 探索 | 理解现有项目、解释行为或仅定位原因，没有要求修复 | 解释认证流程、只查登录失败原因 |
| 文档 | 以编写、更新、翻译、整理说明文档为主要交付 | 更新登录使用指南 |
| 研究 | 技术调研、外部知识和方案比较，为决策提供依据 | 比较 OAuth 库；确定具体架构方案归设计 |
| 其他 | 问候、感谢、闲聊及不属于上述范围的请求 | 日常问候 |

简短技术问题仍按主题分类，不能因字数少直接归其他或未命名。其他也必须提炼
具体主题；仅缺少可理解内容或生成失败且没有已有合规标题时，使用
`MMDD｜其他｜未命名`。读取旧 `未知｜未命名` 时规范化为新兜底，保留手动锁定
名称保护，不自动解锁。所有界面语言及自动、手动生成共用相同分类边界。

## 已退役功能

| 功能 | 来源 | 处理 |
| --- | --- | --- |
| 旧 Tauri 桌面壳及未迁移功能 | `worktree-2026-09-16` | 删除旧壳、透明桌宠浮窗、原生远程工作区连接管理及旧开机启动实现；Electron 开机启动另行通过原生登录项 API 实现。保留共享 Rust、历史数据和服务器签名工具。上游合并不得恢复。保护项：`desktop.tauri-retirement`。 |
| Teambition 任务看板 | `16f8bbbb`、当前工作区删除 | 路由、组件、设置、API、Rust handler 和翻译均已删除。它不再作为活跃功能保护；上游合并不得把它意外恢复。 |

## 与上游比较的结论

这些能力均来自 `upstream/main` 之后的 MaxCode 提交或尚未提交的工作区改动，并非
当前上游的产品契约。部分实现文件上游也在持续修改，Git 即使能无冲突合并，仍可能
改变行为。因此所有活跃项都进入热点清单；上游碰到任一路径时，影响扫描退出码为
`2`，要求人工看对应提交差异并运行独立契约。

纯前端行为由 Vitest 直接验证；Rust、Android、PWA、品牌和发布配置还通过独立
源/配置契约检查关键接线，同时保留各自原有 Rust/Java/组件测试作为更深一层验证。

智能体选择保留原来的胶囊平铺样式，位于欢迎页输入框上方；空间足够时展示全部已启用智能体（`chat.desktop-composer-layout`）。

运行过程中保留所有中间说明文字，直接展示命令组胶囊与独立思考入口，不再套一层步骤摘要；思考详情保留限高滚动（`chat.live-progress-summary`）。

手机顶栏的新对话入口收进右侧工具菜单首项，为标题腾出一个按钮的宽度；新建行为沿用当前文件夹上下文。

手机侧栏底部状态区透出抽屉背景，移除独立灰色背景和顶部分隔线，与列表保持同一画布。

输入框底部的权限、模式、模型、推理强度等选择器统一靠左连续排列，不再将模型推到右侧（`src/maxcode-contracts/reference-chat-style.contract.test.ts`）。

当前对话通过标题操作菜单或 Ctrl/Cmd+F 打开搜索，移除右上角悬浮入口，按匹配消息前后跳转，显示高亮片段并逐页搜索历史；失败时可手动重试（`chat.conversation-find`）。

### 浏览器会话同步请求上限（2026-09-09）

`syncViewerDetail` 将同一会话的重复 WebSocket 通知合并到正在进行的同步，
每轮共享最多五次请求及退避等待，避免读取详情触发元信息广播后反复启动请求。
请求期间的新通知会安排有上限的后续读取，以补齐稍后落盘的回复。
契约：`src/maxcode-contracts/viewer-sync-request-bounds.contract.test.ts`。

手机顶栏工具菜单内在“打开设置”之后提供“刷新界面”，不占用标题栏宽度，只重载当前地址，不清除登录或连接配置，也不额外保存未发送内容。每次前端构建生成独立编号并导出 `/frontend-version.json`；手机在回到前台、恢复页面或 WebSocket 重连时读取它，发现与当前页面不同则提示点击刷新。HTML、版本文件与 service worker 脚本使用 `Cache-Control: no-cache`，带内容哈希的 Next.js JS/CSS 保留一年 immutable 缓存（`web.frontend-refresh`）。

手机端对话标题栏直接显示带框铅笔图标的新建对话按钮，隐藏标题旁的会话操作菜单；沿用当前项目与智能体。最右侧工作区操作菜单使用横向三个点图标。新建按钮与导航按钮统一使用 ghost 样式和 rounded-xl 圆角，操作图标为 18px，左侧菜单图标为视觉补偿放大至 20px、线宽设为 1.8；左侧侧边栏、右侧新建和设置三个按钮统一使用 32px 宽、44px 高的点击区域，缩小图标之间的留白。契约：`mobile-header-new-conversation.contract.test.ts`。

手机端最右侧三个点的工作区菜单提供“分享会话”，复用桌面分享弹窗和公开地址、复制链接、停止分享流程；只针对当前已保存会话，草稿和无会话时禁用，其他工作台页面隐藏。请求按窗格 tabId 定位，多个窗格挂载时只打开目标会话的弹窗；弹窗打开后切换会话不改变分享或撤销的目标。契约：`mobile-conversation-sharing.contract.test.ts`；热点：`conversations.read-only-sharing`。

分享前先预览并选择全部或指定轮次，再主动创建链接；工具日志和思考过程各自默认关闭，后端在写入快照时过滤，旧快照也在公开读取时按默认范围过滤。系统消息、内部消息 ID、工具元数据和图片本地 URI 不进入公开响应，工具结果中的图片仍作为正文图片保留。已存在的链接可直接停止分享，无需先重新发布。公开页面按提问轮次合并助手片段，每轮只显示一次身份，复制的会话信息折叠在提问之后，执行详情按需展开，长会话每次加载十轮。完整性契约：`conversation-share-content.contract.test.tsx`、`conversation-share-content.contract.rs`；热点：`conversations.read-only-sharing`。

### 回复文件变更汇总卡片

- 来源：`worktree-2026-09-11`；热点：`chat.reply-artifacts-summary`。
- 新增、修改、删除统一汇总，默认显示三行相对路径与增删统计，可展开剩余文件；审核包含全部文件差异，保留打开文件和定位操作。
- 明确失败或被拒绝的写入不计入回复/会话变更统计、文件索引和差异；保留缺少状态的旧历史及成功重试。
- 契约：`src/maxcode-contracts/reply-artifacts-summary.contract.test.tsx`、`src/maxcode-contracts/failed-file-writes.contract.test.ts`。

## 2026-09-11 功能移植补充

在 `main` 的隔离集成分支选择吸收上游 v0.30.7 之前的功能修复，评审见
[upstream-functional-20260911.md](./upstream-functional-20260911.md)。未整体合并上游历史。

| 领域 | 功能及保留项 | 保护项 |
| --- | --- | --- |
| Codex 历史 | 恢复 MCP 工具身份与结果；保留现有卡片、费用、耗时和上下文过滤 | `history.codex-semantic-mcp` |
| 工作树导入 | 同批导入也归属仓库，拒绝循环/悬空/多层父节点，保留当前侧栏分组 | `history.import-worktree-grouping` |
| Claude | 0.75.1 分叉定位、压缩历史和实时摘要；沿用现有分隔线及回复折叠 | `history.claude-compaction-compatible` |
| 运行时 | Pi 历史、Cline 解析、进程回收、Antigravity 登录、Pi MCP 扩展配置；保留扩展字段与现有界面 | `agents.functional-upstream-runtime` |


## 2026-09-19 选择性上游吸收

范围与逐项评审见 [upstream-review-20260919.md](./upstream-review-20260919.md)。

| 范围 | 保留的下游行为 | 保护项 |
| --- | --- | --- |
| Codex 原生插话 | 对 codex-acp 2.2.2 在每次启动的临时目录生成兼容副本，保留原安装的模块和 Codex 路径；只有副本确认支持 `promptRequired` 才开启原生通道。轮次结束或请求所属轮次改变时交回主机处理，不自动另开轮次。原安装不修改；未知版本或兼容失败保留 MCP 待读备注。来源：`worktree-2026-10-17`。 | `chat.codex-native-steering` |
| 队列追加 | 回复中按回车继续加入等待队列，每条消息只提供一个「调整方向」按钮：Codex 已确认原生通道时直接追加到当前轮次；其他六种智能体均沿用停止后优先发送，Codex 未确认原生通道时也保留原逻辑。投递期间锁定队列操作。完整附件和队列持有的在途状态禁止降级为待读备注、重复发送或面板卸载丢失。 | `chat.claude-native-queued-steering` |
| 输入历史 | 文档整体首尾的 ↑/↓ 召回当前会话提示词；保留草稿徽标、附件、IME、菜单及队列编辑。 | `chat.sent-prompt-history` |
| 流式更新 | 按连接独立自适应刷新，断连丢弃旧增量、迁移前完成刷新；保留唤醒恢复、归属、实际到达时间及费用统计。 | `runtime.connection-streaming-cadence` |
| 运行时 | 私有短临时目录与 socket 路径限额、精确识别自带提问工具的一次授权、Grok 1.0.34。 | `runtime.upstream-socket-ask-20260919` |


### 自动化复用聊天与消息触发（2026-10-13）

自动化编辑器支持“每次新建会话”和“继续同一聊天”。复用限定于聊天目标，
通过持久化绑定恢复同一原生智能体会话；历史配置保持每次新建的默认行为。
“钉钉新消息”使用 `dws event +listen-im` 实时事件进程，可立即处理或从首条
待处理消息起按选定分钟数合并处理。无消息或聊天正忙时不创建运行记录。

消息在 SQLite inbox 按自动化、监听范围和稳定消息 ID 去重，并以事务认领到
运行记录；失败或中断批次不自动重放，避免重复业务操作。存在待处理消息时
不得更换监听范围或触发方式。订阅失败需要显式重新连接；关闭服务、禁用或
删除自动化时干净停止事件进程。监听依赖服务主机已安装并登录 `dws`，仅在
服务运行期间接收事件，不承诺停机期间的历史消息补齐。

契约：`automation-reuse-messages.contract.test.ts`、
`automation-reuse-messages.contract.rs`、`automation-chat-editor.contract.test.tsx`、
`automation-message-listener-ui.contract.test.tsx`；热点：`automation.reuse-message-listener`。

待办截止日期和优先级（`todos.deadlines-priority`）：新建与编辑均可选填截止日期、低/普通/高/紧急优先级，个人和团队同样支持。截止日期按查看者本地日历当天结束计算，已完成不标逾期。看板和列表支持今天到期、逾期、紧急筛选；已完成筛选先在宿主数据库执行再统计及分页，离线缓存不混用不同筛选条件。来源待办详情保持相同编辑及版本冲突规则。独立契约：`todo-schedule.contract.test.tsx`、`todo-schedule.contract.rs`。

待办创建确认（`todos.confirmed-compose`）：消息“一键添加待办”和整个对话的分享待办入口在当前对话上打开预填的创建弹窗，不跳转看板；用户可调整内容、标题、指定人、截止日期及优先级。整个对话入口先生成或复用所选范围的分享链接，并以“详情见对话：链接”（随界面语言翻译）预填待办内容；单条消息仍填入消息原文。仅点击保存后创建待办，取消不创建待办。分享失败或关闭后的迟到响应不会打开错误的创建弹窗。弹窗由工作区常驻组件承接，重复打开重新初始化草稿。独立契约：`todo-compose-confirmation.contract.test.tsx`、`todo-message-handoff.contract.test.tsx`。

待办对话分享弹窗限制网格与子项最小宽度，分享范围选项及底部按钮可换行，长文件名预览限制为两行；窄窗口与放大字号时保持纵向滚动且不产生横向裁切。单条消息入口直接预填原文，不进入对话分享范围选择。验证：`todo-share-options.contract.test.tsx`、`todo-compose-confirmation.contract.test.tsx`，并使用实际浏览器检查内容宽度和按钮可达性。

整段对话创建待办时，原标题默认带入待办标题，并在待办内容首行保留原标题，空行后附“详情见对话：分享链接”；使用打开分享窗口时固定的会话标题，切换会话不串标题。用户可修改或清空标题再保存；单条消息入口仍只预填消息原文。

普通新建对话、聊天及消息转新对话，不再复用带待办来源的草稿，避免将旧待办关联误带入普通会话。原待办草稿内容与来源继续保留；只有指定 `draftTabId` 的目录/聊天模式选择器才重定向同一草稿。取消创建待办不会写入会话关联，既有合法关联也不会被取消操作清除。回归契约：`todo-conversation-origin.contract.test.tsx`。

侧边栏待办分组标题旁支持直接新建独立会话草稿，沿用该待办下最近活跃关联会话的有效文件夹；无有效关联会话时必须先选择文件夹，确认后才创建草稿，取消不创建。选择不受侧边栏排序、已完成显示开关或当前焦点文件夹影响。任务正文与来源写入独立未发送草稿，首次发送后才保存会话及待办关联。

待办新会话首次创建数据库记录后，同时清理原草稿键的文本与富文本版本、内存缓存和待落盘内容；包括异步创建完成时原面板已卸载的情况。输入框草稿键切换时取消旧键的延迟保存，避免旧草稿清理后又被计时器写回。其他未发送草稿和已保存对话的来源关联保留。独立契约：`todo-conversation-origin.contract.test.tsx`、`composer-focus-draft.contract.test.tsx`。

手机待办验收：触屏或粗指针设备无需悬停即可看到用户消息的“添加到待办”、回复操作行及待办分组的“＋”（含横屏宽度）；历史回复为操作行保留高度，避免被后续虚拟列表条目遮挡。桌面鼠标继续悬停显示。独立契约：`message-action-hover.contract.test.tsx`。

手机对话适配：用户消息的复制、转新对话及图片下载按钮在触屏上直接显示；回复操作行可换行并占据实际高度。工作区与通用弹窗跟随 VisualViewport 的键盘可视高度和偏移，关闭键盘恢复原布局；双指缩放和已处理键盘的原生壳不重复调整。保留移动端隐藏消息编辑与会话内搜索的既定规则。契约：`mobile-conversation-layout.contract.test.tsx`、`mobile-chat-viewport.contract.test.tsx`。

待办创建信息（`todos.creation-metadata`）：看板卡片、列表及看板/来源详情均展示创建人和创建时间；创建人与指定人独立匹配，成员资料缺失时显示创建人 ID。时间按界面语言与查看者时区显示。独立契约：`todo-creation-metadata.contract.test.tsx`。

待办 Codex 会话迁移（`todos.codex-session-import`）：将整个 Codex 对话添加到待办时，可显式勾选允许导入完整原生会话（仅全部轮次可用）。完整工具调用、思考及原生恢复记录保存在团队宿主，使用成员凭据读取，不进入公开分享快照。接收方在待办卡片、看板详情或来源详情点击“导入并继续”，选择本机项目后以新 UUID 保存到当前 Codex 配置的会话目录，并自动关联指定来源待办；同一待办与目录重复导入打开已有会话。只映射执行目录及身份，不替换消息正文内的路径，不迁移项目文件、凭据配置或正在运行的命令。迁移前会展开 fork/revert 引用历史，缺少依赖时拒绝导出；旧待办及未勾选的分享保持只读查看。契约：`todo-codex-import.contract.rs`、`todo-codex-import.contract.test.tsx`。

2026-10-19 修正 Codex 待办导入的分享入口：普通“分享对话”和“添加到待办”均展示完整会话导入选项；生成公开分享链接后仍可勾选并创建带恢复数据的待办。公开链接仍只返回阅读快照，原有仅包含快照的待办需重新从源会话创建。集成验证覆盖普通分享直接创建待办及先生成链接后创建待办两条路径。

2026-10-19 分享页默认突出每轮用户提问和最后一条助手正文，较早的助手过程片段及明确的工作预告收进默认关闭的“过程说明”，展开后可阅读原文。旧快照没有消息阶段信息，采用消息边界兼容整理，不删除原文；图片继续直接展示。开头完整的 AGENTS 指令及环境包络默认折叠为会话信息，混合消息中的实际提问保持可见，不匹配未闭合标记或正文内普通提及。公开接口既有的思考/工具过滤和私有原生导入数据隔离继续生效。独立契约：`conversation-share-content.contract.test.tsx`。


2026-10-20 待办 MCP（`todos.mcp-operations`）：`codeg-mcp` 新增独立 `todos` 工具组，MaxCode 管理且支持 MCP 的会话默认注入，不依赖多智能体委托或执行任务创建开关。提供范围列表、分页搜索、详情、创建、部分更新、领取、释放、完成、重开、删除及关联/取消关联当前会话。创建及搜索未指定范围时沿用当前个人/团队选择，显式范围覆盖但不改变界面选中项；创建必须携带 UUID `operation_id`，重试复用同一值；编辑和状态变更使用当前 `revision` 防止覆盖他人更新。远程团队通过成员凭据和新增 `team_todo_create` 接口创建，宿主需要升级到支持该接口的版本。会话 ID 仅由启动令牌解析。“把当前对话添加到待办”使用 `create_todo_from_conversation`，复用界面分享流程生成净化快照与 `source_url`，不导出原生 Codex 会话；`link_todo_to_conversation` 仅供显式本地关联，不可替代对话分享。团队缺失、离线或分享地址未配置时报错，不回退到个人或普通待办。待办变更通知可见看板刷新，保留五秒轮询恢复机制。新增工具需重启已有智能体会话并使用更新后的后端和 `codeg-mcp` 二进制。契约：`todo-mcp.contract.rs`、`todo-mcp.contract.test.tsx`。


## 2026-10-26 选择性上游吸收

评审和滚动复现记录见 [upstream-review-20261026.md](./upstream-review-20261026.md)。
流式解析使用有界/弱引用缓存，保留现有消息语义；Grok 自定义模型可配置思考
等级且保留手写配置；ZCode 支持协商图片/资源、按提示累计统计和取消尾部保留。
滚动仅移植已复现的点击失效修复，不替换聊天时间线和底部定位策略。
保护项：`runtime.streaming-parse-cache-20261026`、`chat.streaming-scroll-interaction`、
`agents.grok-reasoning-levels`、`agents.zcode-upstream-20261020`。


### 宿主统一侧栏偏好

侧栏导航入口显隐、分区顺序、会话排序和筛选、各组展开状态、左右侧栏宽度及开关，
由 `workspace-preferences-store.ts` 统一读写宿主 `app_metadata`。
桌面端和连接同一后端的 Web 客户端共享这份设置，通过
`workspace-preferences://changed` 广播和重连补拉保持同步。
每个设置独立保存，不用整份旧快照覆盖其他客户端的修改。

首次升级仅 Electron 将旧 `localStorage` 设置按键迁移，使用原子仅插入操作，
已有后端值优先；成功后清理对应旧键，失败保留以便重试。
Web 不导入浏览器旧值。手机首次打开时临时收起侧栏，不将该默认行为回写宿主。
此设置属于宿主工作区，连接同一后端的客户端共享，并非按浏览器或账号隔离。
