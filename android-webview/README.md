# MaxCode for Android

一个只使用系统 WebView 的轻量 Android 外壳。它不内置 MaxCode 前端或浏览器内核，
安装后连接正在运行的 MaxCode Server，并继续使用完全相同的 Web 界面。

## 使用方式

1. 确保 MaxCode Server 可以被手机访问，例如监听 `0.0.0.0:3030`。
2. 安装并打开应用。
3. 输入一个便于识别的连接名称和 HTTP(S) 网页地址，支持路径、查询参数和片段。
4. Token 可留空，点击“连接”直接保存并打开，不检查地址是否可达或 Token 是否有效。

首次保存后，应用会记住连接名称、URL 和 Token。之后每次冷启动先显示独立的
连接选择页使用 MaxCode 原版图标、纯白浅色背景和灰色「＋ 添加连接」文字入口（深色模式使用对应中性色）。
轻点列表名称即可连接，通过右侧「···」菜单编辑或删除连接；删除前仍会确认。
添加和编辑使用可滚动的底部表单，支持键盘避让与取消。Web 工作区本身不叠加连接工具栏；
需要切换时，从后台任务中完全退出应用后重新打开即可选择。

所有连接保存在应用本地，每个 Token 都使用 Android Keystore 的 AES-256-GCM 密钥
独立加密。旧版保存的单个连接会自动迁移到新的多连接格式；应用备份和设备迁移均被
禁用。

## 行为

- 键盘弹出时应用随 IME inset 调整可视高度（Android 11+；edge-to-edge 下 manifest 的
  `adjustResize` 不再生效，必须在代码里消费键盘 inset），输入框不再被键盘遮挡。
- 底部导航栏和键盘安全区统一由原生布局预留；APP 注入样式取消新旧网页工作区
  重复的底部安全区，避免输入框下方出现大块空白。浏览器直接访问不受影响。
- 添加、编辑和选择连接均不请求 `/api/health`，不可达地址也可保存，Token 可为空。
- 普通链接按原路径、查询参数和片段打开，不追加刷新参数，不强制跳转工作区。
- 仅“根地址 + 非空 Token”保留 MaxCode 自动登录：在同源 `localStorage` 写入
  `codeg_token` 后打开 `/workspace`；Token 不会放进 URL。普通深链接不注入 Token。
- 只有配置的服务器同源页面留在 WebView，外部链接交给系统浏览器。
- 支持网页文件选择，兼容单文件 URI 与多选 ClipData 返回（包括多选模式下只选一张图片）；相机、麦克风、定位和第三方 Cookie 默认禁用。
- 应用回到前台或网络恢复时，会触发现有 Web Transport 的立即心跳/重连。
- 窗口重新获得焦点时会重新申明 WebView 焦点并再次请求输入法，规避部分 ROM
  （ColorOS 上可见）上回到前台后点击已聚焦输入框不再弹键盘的问题；页面没有
  聚焦输入框时该请求为无害空操作。
- 应用在前台打开期间保持屏幕常亮；进入后台后恢复系统原有的自动锁屏策略。
- 所有页面均允许系统截图和录屏，包括连接选择、连接编辑与 Web 工作区。
- MaxCode 自动登录工作区使用透明沉浸式状态栏，保留时间、电量和信号图标；普通网页链接（包括无 Token 根地址）、连接选择和编辑页使用原生顶部安全区，避免状态栏或刘海遮挡网页按钮。普通网页不注入 MaxCode 专用安全区 CSS，底部导航栏和键盘避让仍然生效。
- 手机端左侧抽屉只在顶部控件区域应用 Android 实际状态栏/刘海高度，避免按钮被系统图标遮挡而不产生全页白边。
- Web 版原本通过弹窗打开的同源设置、提交等功能页在 APP 内改为当前 WebView 导航；系统返回键可回到工作区，外部链接仍交给系统浏览器。
- HTTPS 证书错误永远不会被绕过；HTTP 仅为可信局域网场景保留。

Android 在锁屏和省电模式下仍可能暂停 WebView。这个应用的目标是亮屏后快速恢复，
而不是保证后台 WebSocket 永远在线。

为兼容现有 Web 前端，连接期间 Token 也会存在于该服务器同源的 WebView
`localStorage` 中。它受 Android 应用沙箱和禁用备份策略保护，但这份副本不是
Keystore 密文。

## 页面更新

Android 0.3.9 起，每次连接会为登录页和工作区入口生成独立的刷新参数，绕过旧版本留下的 HTML 缓存。JS/CSS 的内容哈希缓存、登录信息和已保存连接不清除。已有旧页面内的刷新按钮只有加载到新版前端后才可用，因此从旧版恢复应重新打开连接或更新 APK。

## 构建

需要 JDK 17 和 Android SDK 35：

```bash
cd android-webview
./gradlew test lintDebug assembleDebug
```

可直接安装的调试包位于：

```text
app/build/outputs/apk/debug/app-debug.apk
```

安装到已开启 USB 调试的手机：

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

项目没有运行时三方依赖，也不打包浏览器内核。加入 MaxCode 的高分辨率品牌图标后，
当前 Debug APK 约 207 KB，R8 后的未签名 Release APK 约 185 KB；实际签名包会略大。

## 已发布 APK 的覆盖升级签名

当前 GitHub Android 下载包沿用 `app.codeg.web.debug` 包名。发布升级包必须同时
保持包名和原签名，并递增 `versionCode`，不能改用 `app.codeg.web` 的 Release 包。
已发布 0.3.9 和 0.3.10 的签名证书 SHA-256 均为：

```text
e661f8a488ad380f62c6ee4272836c4350e720bfd2673a8001421412a1f82a05
```

**不要直接发布默认 `assembleDebug` 的产物**：本机 `~/.android/debug.keystore`
已是另一把密钥。0.3.10 构建使用临时 Gradle init script 显式把 debug signing config
指向留存的 `~/.android/debug.keystore.backup-e661f8a4`，未替换全局密钥。
后续打包须继续显式指定经核验的旧密钥；缺失时停止发布，不得自动生成或更换签名。
上传前用 `apksigner verify --print-certs` 比对上一版和新包的证书指纹，并用
`aapt dump badging` 核对包名与递增的版本号。此处证书指纹不是 APK 文件 SHA-256；
每版 APK 文件的校验值会变化。

## Release 签名

复制 `keystore.properties.example` 为本机的 `keystore.properties`，填写发布密钥信息：

```properties
storeFile=release.jks
storePassword=your-store-password
keyAlias=maxcode-web
keyPassword=your-key-password
```

然后运行：

```bash
./gradlew test lintRelease assembleRelease
```

`keystore.properties`、`*.jks` 和所有构建目录都已加入子项目的 `.gitignore`，不要提交
发布密钥。

## 当前限制

- 支持任意格式正确的 HTTP(S) 网页链接；不支持其他协议或 URL 内嵌用户名密码。
- 保存不验证连通性；页面能否使用仍取决于网络、网站权限和系统 WebView 兼容性。
- HTTP 下载链接交给系统浏览器；`blob:` 下载暂未接入原生保存流程。
- Web Notification API 不等同于原生推送，锁屏任务通知需要后续单独接入 FCM。
