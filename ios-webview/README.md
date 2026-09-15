# MaxCode for iOS

使用系统 WKWebView 的轻量 iPhone / iPad 外壳，支持 iOS 16.0 及以上。
不内置前端、Rust 服务或智能体 CLI，连接电脑或服务器上正在运行的 MaxCode，
加载同一个 `/workspace` 网页。独立于 README 中链接的上游原生 iOS 客户端。

## 使用

1. 确保手机可以访问 MaxCode Server，例如 `http://192.168.1.20:3030`。
2. 打开应用，点击「添加连接」，填写名称、服务器根地址和 `CODEG_TOKEN`。
   服务未配置 Token 时可留空。地址不要包含 `/workspace`、账号或查询参数。
3. 点击「验证并保存」，返回列表后点击连接名称进入工作区。
4. 点击连接右侧信息按钮或左滑可编辑，左滑删除需要确认。
5. 工作区不显示原生顶部操作栏，支持侧滑前后导航网页；完全退出应用后重新
   打开，回到连接选择页。加载失败时可在错误提示下重试或选择连接。

首次访问局域网时请允许系统的本地网络权限。拒绝后需在系统设置里重新开启。

## 已实现的行为

- 原生连接列表和可滚动编辑表单，支持浅色、深色及键盘避让。
- 连接目录（含 Token）原子写入 Keychain，使用
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`，不通过 iCloud 同步或设备备份迁移。
  安全存储读取失败时不会用空目录覆盖旧数据。
- 保存和连接前执行带 Bearer Token 的 `POST /api/health`，不跟随重定向，
  区分认证失败、重定向和 HTTP 错误；网络请求有超时。
- 在选定服务器同源主框架的 document-start 阶段写入 `codeg_token`，
  先于网页应用启动。Token 经 JSON 编码，不放入 URL。
- 每次连接创建独立的内存 WebView 数据存储，防止同一服务器不同账号之间串用
  Cookie 或 localStorage。返回连接列表并释放工作区后不保留网页本地数据；
  未发送的草稿和网页偏好不会跨连接或冷启动保留，服务器上的会话不受影响。
- 入口使用随机刷新参数绕过旧 HTML 缓存；服务端前端更新无需重新打包 iOS 壳。
- 同源链接和弹出的设置页在当前 WebView 打开，外链通过系统浏览器打开。
  支持网页 JavaScript 提示、确认和输入框。
- 使用 WKWebView 的系统文件选择器上传附件，支持选照片、文件和系统拍照入口。
  网页实时相机、麦克风采集默认拒绝。
- 原生布局预留状态栏、Home 指示条和键盘区域；注入样式移除网页重复安全区。
- 回到前台或网络恢复时触发现有 Web Transport 的立即心跳和重连，不自动重载
  正在编辑的页面。WebKit 进程被系统释放时显示手动刷新提示。
- 不添加埋点、广告、原生消息推送或后台常驻任务。

为兼容用户指定的 HTTP 服务器，Info.plist 设置 `NSAllowsArbitraryLoads`。
这允许 URLSession 健康检查与 WKWebView 使用 HTTP，但不会绕过 HTTPS 证书校验。
HTTP 请仅用于可信网络，公网部署使用有效证书的 HTTPS。
相关平台行为参见 Apple 的 [ATS 配置说明](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html)、
[内存网页数据存储](<https://developer.apple.com/documentation/webkit/wkwebsitedatastore/nonpersistent()>)
及 [主框架脚本限制](https://developer.apple.com/documentation/webkit/wkuserscript/isformainframeonly)。

## 打开与构建

工程已提供，不依赖 CocoaPods、Swift Package 第三方库或 XcodeGen。
需要完整 Xcode（含 iOS SDK；建议 Xcode 16 或更新版本）；仅安装 Command Line Tools
无法构建 iOS 应用。最低部署目标为 iOS 16。

```bash
open ios-webview/MaxCode.xcodeproj
```

选择 `MaxCode` scheme 和 iPhone 模拟器，然后运行。命令行无签名模拟器构建：

```bash
xcodebuild -project ios-webview/MaxCode.xcodeproj \
  -scheme MaxCode -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios-webview/build build
```

真机安装时，在 Xcode 的「Signing & Capabilities」选择自己的 Team，
必要时将 Bundle Identifier 改为自己账号可用的唯一标识；连接 iPhone，开启
开发者模式，选择设备并运行。当前默认 Bundle ID 为 `app.maxcode.ios`。
不随仓库提供证书、描述文件或已签名 IPA。TestFlight / App Store 分发需配置
对应账号和分发签名，并完成 Apple 的审核流程。

新增 Swift 文件或调整默认工程设置时，修改生成器并重新生成：

```bash
python3 ios-webview/scripts/generate-project.py
```

生成器只使用 Python 标准库。Debug / Release 均加载 `Signing.xcconfig`，
自动签名默认开启。将个人配置写入 Git 忽略的 `Signing.local.xcconfig`，
重新生成工程也会保留：

```xcconfig
DEVELOPMENT_TEAM = 你的团队ID
PRODUCT_BUNDLE_IDENTIFIER = 你的唯一应用标识
```

该配置只选择团队，不会凭空生成证书。仍需在 Xcode 登录拥有该团队权限的 Apple
开发者账号，由自动签名创建 iOS 开发证书和描述文件。已有 macOS Developer ID
证书不能用于 iOS 签名。命令行也可用 `DEVELOPMENT_TEAM=...` 和
`PRODUCT_BUNDLE_IDENTIFIER=...` 覆盖配置。

## 验证

Mac 命令行工具即可运行原生核心测试（不依赖 XCTest / iOS SDK），需要 Node.js：

```bash
bash ios-webview/scripts/test-core.sh
pnpm upstream:guard
```

测试覆盖 URL 规范化与拒绝规则、源隔离、缓存键、Token 编码、健康请求和重定向拒绝，
并在 Node VM 中运行 Swift 实际生成的引导脚本。脚本另做 Swift 语法和 plist 校验；
**这些检查不等于 iOS 编译或真机验证**。

在具备 Xcode 的机器上还应完成上面的模拟器构建，并手工验证：新增/编辑/取消/
删除、错误 Token、局域网权限、HTTPS 错误证书、外链与同源弹窗、单图与多图上传、
输入框和键盘、iPad 竖屏、前后台及断网恢复、同源不同账号切换。

## 当前限制

- 仅支持根路径部署。
- 文件下载（包括 `blob:`）暂未接入原生保存；请使用电脑端保存文件。
- iOS 在后台或锁屏后可能暂停 WebView，没有后台 WebSocket 常驻保证或原生任务通知。
- 原生连接页当前为简体中文；工作区语言沿用服务器前端设置。
- 本机已于 2026-09-14 完成 Xcode 26.6 / iOS 26.5 SDK 初始化；Release 归档、
  模拟器构建及开发签名 IPA 导出均成功，导出应用通过 `codesign --verify --deep --strict`。
  本地产物为 `output/ios-0.1.0/MaxCode-iOS-0.1.0.ipa`，不提交仓库。
- 开发签名使用本机公司团队，当前描述文件包含 3 台设备；该包用于已登记设备的开发
  测试，不是 TestFlight 或 App Store 分发包。尚未完成真机安装与实际服务器端到端验证。
- iPhone 17 Pro / iOS 26.5 模拟器已验证首页、新增连接、健康请求、Keychain 保存、
  WebView Token 注入、同源新窗口导航、网页确认框和文本输入；使用本机受控测试服务。
  模拟器构建应保留 Xcode 默认临时签名，禁用签名会造成 Keychain 返回 `-34018`。
- 首次安装运行组件曾遇到系统磁盘镜像挂载异常；重启 macOS 后恢复。

### 原生界面一致性

连接页沿用 Android 壳的品牌栏、标题文案、细边框卡片、设备图标底色、更多菜单、
独立添加按钮和底部安全存储提示；新增/编辑使用底部面板，颜色随系统切换深浅主题。
样式集中于 `MaxCode/ShellStyle.swift`，契约测试将主要文案与浅色主题色同 Android
资源比较，后续调整两端时需一起更新。2026-09-14 已在模拟器检查深浅色首页、
新增表单和管理菜单；更新包为 `output/ios-0.1.0/MaxCode-iOS-0.1.0-aligned.ipa`。

工作区隐藏原生导航操作栏，网页从系统顶部安全区开始显示；网页前后导航仍支持
WebView 手势。加载失败或网页进程被系统回收时才显示重新加载/选择连接入口。
每次冷启动固定进入连接选择页，不自动恢复上次工作区；仅切到后台再回来仍保留
当前页面。2026-09-14 已通过模拟器进入工作区、终止应用进程、重新启动的验证。
最新签名包：`output/ios-0.1.0/MaxCode-iOS-0.1.0-clean.ipa`。

### 固定方向与缩放

按产品要求，iPhone/iPad 仅声明正向竖屏，应用代理同样返回竖屏方向；iPad 声明
全屏兼容模式。工作区视口固定为 1 倍，禁用双指页面缩放、双击放大和输入聚焦放大。
原生 WKWebView 遵守视口缩放限制并禁用 pinch 手势；文档开始阶段注入并维护 viewport，
防止服务端或 React 替换 meta 标签后恢复缩放。可编辑区域使用至少 16px 字号。
已验证 iPhone 模拟器旋转时保持竖屏，自动测试覆盖 viewport 新建和动态替换。
最新包：`output/ios-0.1.0/MaxCode-iOS-0.1.0-portrait.ipa`。

底部安全区由 UIKit 单独负责。注入视口使用 `viewport-fit=contain`，避免 WebKit
在已内缩的容器内再次预留底部安全区；保留原生键盘避让。2026-09-14 已在实际
工作区检查键盘弹出和收起，消除约 34pt 重复留白。最新包：
`output/ios-0.1.0/MaxCode-iOS-0.1.0-insets.ipa`。

键盘隐藏时显式切换到底部安全区约束，避免 `UIKeyboardLayoutGuide` 残留键盘附件
高度。工作区原生外层滚动固定在原点，消息列表等网页内部滚动由网页处理，防止
WebKit 聚焦时整体上移。已在实际工作区验证软键盘弹出与收起后底部位置一致。
