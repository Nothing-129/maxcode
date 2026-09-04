# MaxCode for Android

一个只使用系统 WebView 的轻量 Android 外壳。它不内置 MaxCode 前端或浏览器内核，
安装后连接正在运行的 MaxCode Server，并继续使用完全相同的 Web 界面。

## 使用方式

1. 确保 MaxCode Server 可以被手机访问，例如监听 `0.0.0.0:3030`。
2. 安装并打开应用。
3. 输入一个便于识别的连接名称和服务器根地址，例如 `http://192.168.1.20:3030`，不要添加
   `/workspace` 或其他路径。
4. 输入服务器的 `CODEG_TOKEN`，点击“连接”。

首次连接成功后，应用会记住连接名称、URL 和 Token。之后每次冷启动先显示独立的
连接选择页，列表只展示名称；也可以在这里添加、编辑或删除连接。Web 工作区本身不叠加连接工具栏；
需要切换时，从后台任务中完全退出应用后重新打开即可选择。

所有连接保存在应用本地，每个 Token 都使用 Android Keystore 的 AES-256-GCM 密钥
独立加密。旧版保存的单个连接会自动迁移到新的多连接格式；应用备份和设备迁移均被
禁用。

## 行为

- 键盘弹出时应用随 IME inset 调整可视高度（Android 11+；edge-to-edge 下 manifest 的
  `adjustResize` 不再生效，必须在代码里消费键盘 inset），输入框不再被键盘遮挡。
- 连接前使用 Bearer Token 请求 `/api/health`，验证地址和 Token。
- 选择已保存的连接后直接打开；如果凭据发生变化，可在启动选择页编辑并重新验证。
- 验证成功后，在服务器同源的 `localStorage` 写入 `codeg_token`，然后打开
  `/workspace`；Token 不会放进 URL。
- 只有配置的服务器同源页面留在 WebView，外部链接交给系统浏览器。
- 支持网页文件选择；相机、麦克风、定位和第三方 Cookie 默认禁用。
- 应用回到前台或网络恢复时，会触发现有 Web Transport 的立即心跳/重连。
- 窗口重新获得焦点时会重新申明 WebView 焦点并再次请求输入法，规避部分 ROM
  （ColorOS 上可见）上回到前台后点击已聚焦输入框不再弹键盘的问题；页面没有
  聚焦输入框时该请求为无害空操作。
- 应用在前台打开期间保持屏幕常亮；进入后台后恢复系统原有的自动锁屏策略。
- 所有页面均允许系统截图和录屏，包括连接选择、连接编辑与 Web 工作区。
- Web 工作区使用透明沉浸式状态栏，保留时间、电量和信号图标，网页延伸到状态栏下方；连接选择和编辑页恢复普通状态栏与安全区。
- 手机端左侧抽屉只在顶部控件区域应用 Android 实际状态栏/刘海高度，避免按钮被系统图标遮挡而不产生全页白边。
- Web 版原本通过弹窗打开的同源设置、提交等功能页在 APP 内改为当前 WebView 导航；系统返回键可回到工作区，外部链接仍交给系统浏览器。
- HTTPS 证书错误永远不会被绕过；HTTP 仅为可信局域网场景保留。

Android 在锁屏和省电模式下仍可能暂停 WebView。这个应用的目标是亮屏后快速恢复，
而不是保证后台 WebSocket 永远在线。

为兼容现有 Web 前端，连接期间 Token 也会存在于该服务器同源的 WebView
`localStorage` 中。它受 Android 应用沙箱和禁用备份策略保护，但这份副本不是
Keystore 密文。

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

- 只支持部署在 URL 根路径的 MaxCode Server。
- HTTP 下载链接交给系统浏览器；`blob:` 下载暂未接入原生保存流程。
- Web Notification API 不等同于原生推送，锁屏任务通知需要后续单独接入 FCM。
