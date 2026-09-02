# MaxCode 下游功能清单

本清单以 `upstream/main` 为上游基线，综合检查 `upstream/main..HEAD` 的非发布提交
以及当前工作区改动。机器可读、决定合并阻塞范围的权威版本是
`config/maxcode-upstream-hotspots.json`；本文用于评审和维护。

最近审计：2026-08-31。已先执行 `git fetch upstream --prune`；上游基线为
`769610c626f1`，下游 `HEAD` 为 `d2ac1390c974`，相差 81 个下游提交、425 个已提交
差异文件，另将当时工作区中的新增功能一并纳入。审计时没有尚未合并的上游提交。

## 活跃功能

| 领域 | 功能 | 来源 | 保护项 |
| --- | --- | --- | --- |
| 会话 | 回复运行时展开、完成后折叠过程、保留最终答案及手动偏好 | `108154e4`、当前工作区 | `chat.reply-folding` |
| 会话 | 按文件夹/聊天范围记住智能体，按明确优先级选择新会话默认智能体 | `dc86bec0`、`16941c88` | `conversations.agent-defaults` |
| 会话 | 未读检测、可见会话消除未读、全部已读、状态颜色和状态操作开关 | `53144985`、`06bb8457`、`c283e981`、`8d9cb933`、`1a4a3532` | `conversations.unread-and-status` |
| 会话 | 以可撤销能力链接分享不含本地元数据路径的只读会话快照，显式公网地址优先、Web/局域网/本机地址依次回退；公开 Markdown 仅开放外部链接，正文中的本地目标保持只读 | 当前工作区 | `conversations.read-only-sharing` |
| 侧边栏 | 完成会话默认隐藏、分区/工作树/分页、文件夹拖动稳定性、新建及重开文件夹排序 | `108154e4`、`bae6751c`、`9eaecc27`、`2245d322`、`7ca7b5b3`、`16941c88`、当前工作区 | `conversations.sidebar-folder-interactions` |
| 导航 | 固定宽度可滚动标签、触控板拖动阈值、移动端导航收起、正文原生选择 | `7a445edf`、`f60fecca`、`eb9cee07`、`7ca7b5b3` | `navigation.tabs-touch-and-selection` |
| 消息 | 普通本地路径自动变成文件引用，安装包等二进制产物可打开或在文件管理器显示 | `7ca7b5b3`、`06bb8457`、`c283e981` | `messages.local-paths-and-artifacts` |
| 消息 | 系统字体默认值及代理未提供耗时时的“提示到完成”耗时推导 | `d61af64a` | `messages.system-font-and-duration` |
| Web | 断线不清凭证、健康探测退避重连、恢复订阅、仅有凭证的 401 判定会话过期 | `352bc868`、`2c859b2a` | `web.auth-and-session-recovery` |
| Web | 服务器/Docker 可安装 PWA，Tauri 环境不注册 Service Worker | `cbd85449`、`bddabc51` | `web.pwa-installation` |
| 更新 | MaxCode 更新源、状态栏更新体验、发现/忽略持久化、打开面板时关闭遮挡 Toast | `b558e9bb`、`ba09a7b5`、`dceb62ac`、当前工作区 | `updates.maxcode-channel-and-ui` |
| 智能体 | ACP 注册/预检、CLI 自动标题、Grok 本地化标题与历史 plan/图片读取兼容 | `108154e4`、`53144985`、`bb6949f5`、`16941c88` | `agents.acp-compatibility-and-titles` |
| 智能体 | 活跃连接保活、最近 2 个连接真热续期 10 分钟、冷连接只读探测、繁忙保护、Connecting 看门狗和后台空闲页面卸载 | `2c859b2a`、当前工作区 | `agents.bounded-connection-lifecycle` |
| 设置 | Pi `max` 思考级别及十种语言标签 | `e1fda1d3` | `settings.pi-maximum-thinking` |
| Android | 多服务器连接、安全令牌存储、健康检查、WebView 引导、OPPO 状态栏安全区和列表细节 | `bddabc51`、当前工作区 | `android.webview-client` |
| 品牌 | MaxCode 名称、图标、文档、安装器和个人仓库链接 | `9eaecc27`、`dc86bec0`、`c7a21a24` | `branding.maxcode` |
| 发布 | 平台白名单、签名更新产物、`latest.json` 完整性、macOS 签名公证及 MaxCode 产物名 | `dceb62ac` 等发布提交 | `release.signed-multiplatform-artifacts` |
| 维护 | 上游影响扫描、热点清单和独立契约 CI | 当前工作区 | `maintenance.upstream-integration-guard` |

## 已退役功能

| 功能 | 来源 | 处理 |
| --- | --- | --- |
| Teambition 任务看板 | `16f8bbbb`、当前工作区删除 | 路由、组件、设置、API、Rust handler 和翻译均已删除。它不再作为活跃功能保护；上游合并不得把它意外恢复。 |

## 与上游比较的结论

这些能力均来自 `upstream/main` 之后的 MaxCode 提交或尚未提交的工作区改动，并非
当前上游的产品契约。部分实现文件上游也在持续修改，Git 即使能无冲突合并，仍可能
改变行为。因此所有活跃项都进入热点清单；上游碰到任一路径时，影响扫描退出码为
`2`，要求人工看对应提交差异并运行独立契约。

纯前端行为由 Vitest 直接验证；Rust、Android、PWA、品牌和发布配置还通过独立
源/配置契约检查关键接线，同时保留各自原有 Rust/Java/组件测试作为更深一层验证。
