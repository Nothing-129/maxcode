# MaxCode Electron 桌面端

桌面窗口由 Electron 承载。主进程、预加载桥接、启动脚本和打包配置均位于本目录。
界面继续使用根目录的 Next.js 静态导出；会话、数据库、终端、Git 和智能体业务
继续复用 `src-tauri/` 中的 Rust 核心，以
`--no-default-features --features native-keyring` 编译，运行时不依赖 Tauri。
独立的 `native-keyring` 功能保留系统钥匙串访问，兼容旧桌面端的账号凭证。

## 运行

先安装 Node.js 22.12+、项目指定的 pnpm 和 Rust 工具链，在项目根目录执行：

```bash
corepack pnpm install
corepack pnpm desktop:dev
```

`desktop:dev` 会构建前端、编译调试版 `codeg-server` 与 `codeg-mcp`，然后启动
Electron。本机未安装全局 pnpm 时可直接使用 `corepack pnpm`。

```bash
# 使用已经构建好的前后端快速启动
corepack pnpm electron:start

# 修改前端后重新导出，再快速启动
corepack pnpm build
corepack pnpm electron:start

# 隔离数据目录的自动启动验证，完成后退出
corepack pnpm electron:start --smoke-test
```

开发入口使用静态导出，与安装包的资源加载方式一致，目前没有热更新。
普通开发启动与安装版使用同一份 `codeg.db`；需要独立数据时设置
`CODEG_DATA_DIR` 和 `CODEG_HOME` 为测试目录。`--smoke-test` 自动隔离数据。

开发时可通过 `CODEG_ELECTRON_BACKEND_PATH` 指定后端可执行文件，或通过
`CODEG_ELECTRON_STATIC_DIR` 指定前端导出目录；安装版固定使用包内资源。

## 手机访问

在桌面端「设置 → Web 服务」开启服务，手机连接同一局域网后打开该页显示的
局域网 URL，并使用页面中的 Token 登录。端口默认 3080，也可沿用旧版保存的端口；
勾选自动启动后，下次打开桌面应用会恢复服务。电脑的局域网 IP 和端口保持不变时，
手机原有 URL 可继续使用。

对外服务和桌面内部连接使用独立监听与凭证。关闭 Web 服务只断开手机等外部客户端，
桌面聊天仍可继续；退出桌面应用会一并关闭对外服务。自动启动遇到端口占用时，
桌面仍会打开，可在 Web 服务设置中更换端口或释放占用后重试。

## 打包

```bash
# 当前系统的安装包
corepack pnpm desktop:build

# 仅生成解包后的应用，用于本机验证
corepack pnpm desktop:pack

# macOS DMG
corepack pnpm desktop:build:dmg
```

产物位于 `electron/dist/`，文件名以 `MaxCode-` 开头，不包含运行时名称。macOS 默认生成
DMG 和 ZIP，Windows 生成 NSIS 安装包，Linux 生成 AppImage 和 DEB。
每个平台应在对应系统和架构上构建；脚本默认复用 `src-tauri/target/release`
缓存，不额外传入 `--target`。打包不会上传或发布任何文件。

安装包包含 `resources/web/` 静态前端，以及 `resources/backend/` 下并列的
`codeg-server` 和 `codeg-mcp`。Electron 应用代码放入 ASAR，Rust 可执行文件
保留在 ASAR 外，以便启动和智能体委托。签名、公证需要在构建环境配置自己的
Electron Builder 凭据（如 `CSC_LINK` / `CSC_NAME`）；未显式配置时 macOS 使用
ad-hoc 临时签名，仅用于本地开发验证，不会自动使用机器上发现的发布证书。

## CI 与发布

`test.yml` 在 macOS、Windows、Linux 上编译无 Tauri feature 的后端，
执行 `desktop:pack` 后用 `desktop:smoke` 启动包内应用，验证工作区、认证、
原生桥接与后端退出。Linux 通过 `xvfb-run -a` 提供显示服务。

```bash
corepack pnpm desktop:pack
corepack pnpm desktop:smoke
```

`release.yml` 按 `DESKTOP_TARGETS` 使用原生架构 runner 构建 Electron 安装包，
生成 SHA-256、架构独立的 `latest-*.yml` 与差分 blockmap，并验证元数据中的
SHA-512、文件大小及版本后上传到当前仓库的草稿发布。全部选中平台构建、签名和启动
验证成功，且安装包齐全后才发布；仓库限定为 `Nothing-129/maxcode`。
macOS 发布使用现有 Apple 证书 secrets，详见
[签名说明](../docs/releasing/macos-signing.md)。本地打包始终使用 `--publish never`。

新发布不再生成 Tauri `latest.json`。旧 Tauri 用户需手动安装 Electron；
Electron 发布版现支持差分更新，缺少缓存或差分失败时回退完整包；详见
[差分更新说明](../docs/maintenance/electron-differential-updates.md)。启用 `SERVER_TARGETS` 时，服务器仍沿用
原来的 minisign 签名和 `TAURI_SIGNING_PRIVATE_KEY`，与桌面更新分开。
迁移保留项及删除条件见[桌面运行时清理清单](../docs/maintenance/desktop-runtime-migration.md)。

## 通信与生命周期

Electron 主进程启动仅绑定 `127.0.0.1` 的 Rust 服务，由操作系统分配空闲端口。
后端通过私有 ready 文件返回实际端口；Electron 验证认证健康接口后加载工作区。
每次运行生成独立令牌，由隔离的 preload 提供给 HTTP/WebSocket 认证，不写入
页面地址或浏览器持久存储。原生文件选择、通知、文件保存和系统打开操作通过
受限 IPC 桥接；渲染器不开启 Node.js 集成。

数据库默认沿用旧桌面端的 `app.codeg` 数据目录，`CODEG_HOME` 保持其独立含义。
Electron 自己的窗口偏好通过私有配置文件跨端口保存；旧 Tauri WebView 的
localStorage 不会自动导入。备份恢复完成后通过 Electron 重启整个应用。

关闭应用会结束由它启动的后端；后端异常退出会显示错误。Electron 模式禁用
服务器原地更新、回滚和重启；桌面更新由主进程的 `electron-updater` 完成。
版本号右侧显示实心圆形更新图标，不弹更新通知或详情。点击后下载并校验，然后自动退出后端、安装并重启；主进程共享下载进度。

## 迁移范围

Electron 已作为 `desktop:*`、默认 CI 和桌面发布的入口。旧 Tauri 壳仅保留兼容用途，
不再由默认发布流程产出安装包；兼容检查通过 `legacy-tauri.yml` 手动运行。
共享 Rust 核心仍位于 `src-tauri/`，便于继续集成上游。
前端原有 `isDesktop()` 表示 Tauri IPC 能力；Electron 使用独立运行时检测，
业务请求走 WebTransport，原生能力走 `window.maxcodeElectron`。

Electron 的 macOS 主工作区使用隐藏系统标题栏与原生交通灯，
窗口拖拽由页面标题区域承担；子窗口和 Windows/Linux 保留系统标题栏。Tauri 专属的透明桌宠浮窗、原生远程工作区
连接管理和开机启动设置尚未迁移；对应入口不会在 Electron
中启用。跨窗口业务界面、附件上传、文件预览与备份使用现有 Web 模式实现。

实现参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
和 [Electron Builder 配置](https://www.electron.build/v26/docs/configuration/)。
