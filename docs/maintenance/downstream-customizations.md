# MaxCode 下游功能清单

本清单以 `upstream/main` 为上游基线，综合检查 `upstream/main..HEAD` 的非发布提交
以及当前工作区改动。机器可读、决定合并阻塞范围的权威版本是
`config/maxcode-upstream-hotspots.json`；本文用于评审和维护。

最近审计：2026-08-31。已先执行 `git fetch upstream --prune`；上游基线为
`769610c626f1`，下游 `HEAD` 为 `d2ac1390c974`，相差 81 个下游提交、425 个已提交
差异文件，另将当时工作区中的新增功能一并纳入。审计时没有尚未合并的上游提交。

## 智能体维护范围

自 2026-09-17 起仅维护 Claude Code、Codex、Grok、Pi、DeepSeek 和 Google Antigravity。
其他智能体保留历史数据、解析器和适配代码，但不出现在设置或新会话目录中，
不执行后台自动更新，也不吸收其专属上游变更。新增自定义智能体入口隐藏。
下方早期版本目录记录仅作为历史来源，不代表当前维护范围。

## 活跃功能

| 领域 | 功能 | 来源 | 保护项 |
| --- | --- | --- | --- |
| 操作按钮颜色 | 发送、运行中停止和正常更新按钮统一使用 `#3CA1EF`，深浅色一致；保留禁用与错误状态 | `worktree-2026-09-18` | `appearance.send-button-brand-color` |
| 六种智能体上游适配 | Codex 1.12 / Claude 0.78 协议与推荐值、Grok 1.0.30、DeepSeek 代际恢复、草稿与连接提示、临时目录及缓存迁移；保留现有布局、计时和独立 CLI 自动更新 | `39506eb5`、`bd9b6038`、`d74eec45`、`b84e76c6`、`50fff85f`、`51ded76b`、`86b4bb7a`、`e4c38963`、`594024db`、`worktree-2026-09-17` | `agents.six-agent-upstream-20260917` |
| 智能体维护范围 | 设置、选择器、旧缓存与自动更新仅保留六种，隐藏自定义新增入口 | `worktree-2026-09-17` | `agents.maintained-catalog` |
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
| 智能体版本目录 | 内置安装及强制自动更新目标采用已评审版本；OpenCode 1.18.30 的六个平台资产继续要求独立 SHA256 | `8c461154`、`1055edc4`、`e588125b`、`25882257`、`worktree-2026-09-15` | `agents.reviewed-version-catalog`、`agents.opencode-verified-distribution` |
| 智能体自动更新 | 维护范围内已启用且已安装的六种智能体强制后台更新，支持 npm、二进制、Python，无独立开关；独立目录下载验证，空闲时原子切换，失败保留旧安装 | `worktree-2026-09-14` | `settings.agent-auto-updates` |
| 智能体安装 | 手动 npm 安装、升级、重试及自定义包查询使用 npm.aifalao.net；在线版本检测与自动安装使用官方 registry.npmjs.org，适配器与 CLI 独立检测 | `worktree-2026-09-14` | `settings.agent-npm-mirror` |
| 自动任务 | 空白及模板新建默认不勾选「每次运行新建 worktree」，使用所选文件夹；编辑保留已保存的隔离设置，允许手动勾选 | `worktree-2026-09-11` | `automations.worktree-opt-in` |
| 跨端已读 | 手机与桌面共享后端已读回执，实时广播并在重连及恢复前台时补同步 | `worktree-2026-09-10` | `conversations.cross-device-read` |
| 手机设置 | 右上角分类菜单显示在设置页之上，可切换分类、点击空白或 Escape 关闭；保留设置及工作区草稿，隐藏后台工作区抽屉并在返回时恢复 | `worktree-2026-09-10` | `settings.mobile-category-navigation` |
| 移动端 | 恢复前台及网络重连后检查并恢复当前会话，连接中、未连接、连接错误均持续 3 秒才显示；状态或会话变化重新计时，已连接立即恢复，持续掉线保留红色提示 | `worktree-2026-09-10` | `chat.mobile-session-recovery` |
| 会话 | Pi 启动横幅（pi 版本 / Context / Skills）不进入对话：实时流直接丢弃，与完成后的持久化转写保持一致，不再先显示后消失 | `worktree-2026-09-11` | `chat.pi-startup-banner-suppressed` |
| 对话选择 | Codex 参考样式：加重问题标题、浅灰选项底色与细边框、选中加深描边及反色编号、底部操作分隔；保留显式提交与键盘选择 | `worktree-2026-09-10` | `chat.reference-question-picker` |
| 消息超链接 | 可点击的 Markdown 超链接显示小手光标，流式生成中未完成的链接保持不可点击样式 | `worktree-2026-09-15` | `chat.markdown-link-cursor` |
| 会话列宽 | 桌面会话内容列右缘提供拖宽抓手，悬停热区才浮现发丝线与 grip；拖动居中列实时对称伸缩，钳制 40–80rem，防抖持久化并预水合应用，跨窗口同步，双击或 Enter 恢复默认 48rem；手机端不参与，列始终满宽 | `worktree-2026-09-15` | `chat.column-width-drag` |
| 消息文件链接 | 文件名按容器宽度完整换行，兼容手机；按真实路径、特殊文件名和复合扩展名匹配 VSCode Icons 原生彩色图标，离线资源支持明暗主题，保留紧凑输入框徽标 | `worktree-2026-09-11` | `chat.file-link-presentation` |
| 消息 | Codex 后续建议标记渲染为按钮，点击追加到当前输入框；只读页面显示标签，代码示例保持原文 | `worktree-2026-09-11` | `chat.codex-followup-controls` |
| 消息 | 历史回复正文到操作按钮保持连续悬停区域，悬停/键盘聚焦时抬高实际虚拟行层级（悬停优先），按钮不被下一条消息的透明间距遮挡，提示气泡打开时保持操作区可见及层级，保留原消息间距 | `worktree-2026-09-10` | `messages.action-hover-continuity` |
| 消息 | 消息操作直接打开新对话并带入原文草稿，保留项目和智能体，不创建待办、不自动发送 | `worktree-2026-09-10` | `messages.new-chat-from-message` |
| 待办 | 移除待办全部界面入口及 Issue/PR 任务操作，旧路由回到对话；保留消息新开对话 | `worktree-2026-09-10` | `tasks.no-ui-entry-points` |
| 浏览器稳定性 | 跨客户端详情同步合并重复通知，每轮最多五次退避请求，阻断元信息事件反馈造成的请求堆积 | `worktree-2026-09-09` | `chat.viewer-sync-request-bounds` |
| 会话费用刷新 | 回复结束后同步累计计费用量，无需切换会话即可更新输入框底部金额 | `worktree-2026-09-10` | `composer.conversation-cost` |
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
| 侧边栏 | 移除待办任务与仓库面板导航入口，保留新对话（简体中文固定文案）、自动化及会话列表；文件夹、最新、聊天新增入口统一在手机/触屏导航后收起侧栏 | `worktree-2026-09-08` | `workspace.sidebar-navigation` |
| 发布 | Electron 原生架构安装包、打包后启动验证、完整产物与签名门禁；旧 Tauri 壳与兼容 CI 已退役 | `worktree-2026-09-08` | `desktop.electron-release-pipeline` |
| 桌面更新 | Electron 稳定版差分下载、完整包回退、跨窗口进度与后端退出后安装；架构独立清单和 blockmap；GitHub 过慢或不可达时走 maxcode-update.aifalao.net | `worktree-2026-09-08` | `desktop.differential-updates` |
| 桌面 Web 服务 | Electron 独立对外监听供手机 URL 访问，保留端口、Token、自动启动，关闭对外服务不影响桌面连接 | `worktree-2026-09-09` | `desktop.electron-web-service` |
| 手机侧栏 | 搜索、定位当前对话、更多设置与侧栏标题同排，移除独立工具行；44px 触控区域，展开/折叠收进更多菜单，打开搜索时收起侧栏 | `worktree-2026-09-09` | `sidebar.search-tools` |
| 手机布局 | 浏览器由工作区预留底部安全区；Android APP 由原生层避让导航栏/键盘，注入样式取消新旧网页外壳的重复底部安全区（所有机型），输入框仅保留 8px 间距 | `worktree-2026-09-09` | `mobile.composer-bottom-gap` |
| 桌面 | Electron 默认入口、安全原生桥接、认证本机后端、偏好保留、退出清理与安装包更新归属 | `worktree-2026-09-08` | `desktop.electron-runtime` |
| 会话 | Codex 插件推荐上下文不显示为聊天消息，不参与标题或计数 | `worktree-2026-09-07` | `chat.codex-plugin-context-filter` |
| 会话 | 所有聊天顶部不显示后台任务栏，后台任务执行与对话内命令记录继续保留 | `worktree-2026-09-07` | `chat.no-top-background-task-strip` |
| 思考 | 流式思考默认单行折叠，手动展开后限高滚动，更新及完成时保留手动选择 | `worktree-2026-09-08` | `chat.compact-reasoning` |
| 会话 | 回复运行时摘要展示、完成后折叠过程、保留最终答案及手动偏好 | `108154e4`、当前工作区 | `chat.reply-folding` |
| 会话 | 按文件夹/聊天范围记住智能体，按明确优先级选择新会话默认智能体 | `dc86bec0`、`16941c88` | `conversations.agent-defaults` |
| 会话 | 未读检测、可见会话消除未读、全部已读、状态颜色和状态操作开关 | `53144985`、`06bb8457`、`c283e981`、`8d9cb933`、`1a4a3532` | `conversations.unread-and-status` |
| 会话 | 分享入口仅保留在三个点菜单内，顶部不显示独立分享按钮；以可撤销能力链接分享不含本地元数据路径的只读会话快照，显式公网地址优先、Web/局域网/本机地址依次回退；公开 Markdown 仅开放外部链接，正文中的本地目标保持只读 | 当前工作区 | `conversations.read-only-sharing` |
| 侧边栏 | 完成会话默认隐藏、分区/工作树/分页、文件夹拖动稳定性、新建及重开文件夹排序 | `108154e4`、`bae6751c`、`9eaecc27`、`2245d322`、`7ca7b5b3`、`16941c88`、当前工作区 | `conversations.sidebar-folder-interactions` |
| 导航 | 固定宽度可滚动标签、触控板拖动阈值、移动端导航收起、正文原生选择 | `7a445edf`、`f60fecca`、`eb9cee07`、`7ca7b5b3` | `navigation.tabs-touch-and-selection` |
| 消息 | 普通本地路径自动变成文件引用，安装包等二进制产物可打开或在文件管理器显示 | `7ca7b5b3`、`06bb8457`、`c283e981` | `messages.local-paths-and-artifacts` |
| 消息 | 系统字体默认值及代理未提供耗时时的“提示到完成”耗时推导 | `d61af64a` | `messages.system-font-and-duration` |
| Web | 断线不清凭证、健康探测退避重连、恢复订阅、仅有凭证的 401 判定会话过期 | `352bc868`、`2c859b2a` | `web.auth-and-session-recovery` |
| Web | 服务器/Docker 可安装 PWA，Electron 环境不注册 Service Worker | `cbd85449`、`bddabc51` | `web.pwa-installation` |
| 更新 | MaxCode 更新源、状态栏更新体验、发现/忽略持久化、打开面板时关闭遮挡 Toast | `b558e9bb`、`ba09a7b5`、`dceb62ac`、当前工作区 | `updates.maxcode-channel-and-ui` |
| 会话侧栏 | 主动取消后不显示红色 X，正常显示时间，保留运行中与未读提示 | `worktree-2026-09-08` | `conversations.cancelled-without-error-badge` |
| 会话标题 | 移除会话、侧栏及标签菜单中的手动刷新标题入口和前端请求封装；保留自动标题与重命名 | `worktree-2026-09-10` | `conversations.manual-title-refresh` |
| 会话标题 | 标准化 MMDD｜类型｜主题，重试无效响应；打开会话时按首条用户消息补生成，纯图片消息使用首轮助手文字回复，不跨后续用户轮次、不发送图片载荷；5 分钟冷却、保护锁定名称，失败日志不含凭证 | `worktree-2026-09-07` | `conversations.structured-title-recovery` |
| 智能体 | ACP 注册/预检，Codex、Grok、Pi、DeepSeek Harness、Claude Code 专用模型生成 MMDD｜类型｜主题 标题，Grok 历史 plan/图片读取兼容 | `108154e4`、`53144985`、`bb6949f5`、`16941c88` | `agents.acp-compatibility-and-titles` |
| 智能体 | 设置页对已开启智能体联网检测发布版本，结果写入侧栏徽标和详情里的「版本状态」分类（不另设更新卡片）；npm 查询实际 ACP 包，其余受支持智能体查询 ACP 注册表；缓存 6 小时并支持在版本状态中强制检查，失败和未知版本不误报最新，npm 新版在版本状态中点升级即按该版本安装，自定义版本仍走输入对话框 | `worktree-2026-09-10` | `settings.agent-online-updates` |
| 智能体 | OpenCode 六个平台的固定版本下载均保留 SHA256 校验；1.18.30 的六个摘要直接从官方 GitHub Release 资产流式计算，不能采用上游空摘要 | `1bf8a772`、`25882257`、`worktree-2026-09-07`、`worktree-2026-09-15` | `agents.opencode-verified-distribution` |
| 智能体 | 活跃连接保活、最近 2 个连接真热续期 10 分钟、冷连接只读探测、繁忙保护、Connecting 看门狗和后台空闲页面卸载；备份恢复读取实际会话状态，保护锁定会话与未退出进程 | `2c859b2a`、当前工作区 | `agents.bounded-connection-lifecycle` |
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

运行过程中保留所有中间说明文字，文字之间连续的思考和工具步骤合并成可展开摘要；只对展开的步骤详情限高滚动（`chat.live-progress-summary`）。

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

### 回复文件变更汇总卡片

- 来源：`worktree-2026-09-11`；热点：`chat.reply-artifacts-summary`。
- 新增、修改、删除统一汇总，默认显示三行相对路径与增删统计，可展开剩余文件；审核包含全部文件差异，保留打开文件和定位操作。
- 契约：`src/maxcode-contracts/reply-artifacts-summary.contract.test.tsx`。

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
| 队列追加 | 仅 Claude Code 已确认原生通道时追加到当前轮次；其余保留停止后优先发送。完整附件和队列持有的在途状态禁止降级为待读备注、重复发送或面板卸载丢失。 | `chat.claude-native-queued-steering` |
| 输入历史 | 文档整体首尾的 ↑/↓ 召回当前会话提示词；保留草稿徽标、附件、IME、菜单及队列编辑。 | `chat.sent-prompt-history` |
| 流式更新 | 按连接独立自适应刷新，断连丢弃旧增量、迁移前完成刷新；保留唤醒恢复、归属、实际到达时间及费用统计。 | `runtime.connection-streaming-cadence` |
| 运行时 | 私有短临时目录与 socket 路径限额、精确识别自带提问工具的一次授权、Grok 1.0.34。 | `runtime.upstream-socket-ask-20260919` |
