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

## 打包

```bash
# 当前系统的安装包
corepack pnpm desktop:build

# 仅生成解包后的应用，用于本机验证
corepack pnpm electron:pack

# macOS DMG
corepack pnpm electron:build:dmg
```

产物位于 `electron/dist/`，文件名以 `MaxCode-Electron-` 开头。macOS 默认生成
DMG 和 ZIP，Windows 生成 NSIS 安装包，Linux 生成 AppImage 和 DEB。
每个平台应在对应系统和架构上构建；脚本默认复用 `src-tauri/target/release`
缓存，不额外传入 `--target`。打包不会上传或发布任何文件。

安装包包含 `resources/web/` 静态前端，以及 `resources/backend/` 下并列的
`codeg-server` 和 `codeg-mcp`。Electron 应用代码放入 ASAR，Rust 可执行文件
保留在 ASAR 外，以便启动和智能体委托。签名、公证需要在构建环境配置自己的
Electron Builder 凭据（如 `CSC_LINK` / `CSC_NAME`）；未显式配置时 macOS 使用
ad-hoc 临时签名，仅用于本地开发验证，不会自动使用机器上发现的发布证书。

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
服务器原地更新、回滚和重启，桌面更新通过新的 Electron 安装包完成。

## 迁移范围

Electron 已作为 `desktop:*` 的默认桌面入口。旧 Tauri 壳和发布配置暂时保留，
共享 Rust 核心仍位于 `src-tauri/`，便于继续集成上游。
前端原有 `isDesktop()` 表示 Tauri IPC 能力；Electron 使用独立运行时检测，
业务请求走 WebTransport，原生能力走 `window.maxcodeElectron`。

Electron 当前使用系统窗口标题栏。Tauri 专属的透明桌宠浮窗、原生远程工作区
连接管理、开机启动设置和 Tauri 自动更新流程尚未迁移；对应入口不会在 Electron
中启用。跨窗口业务界面、附件上传、文件预览与备份使用现有 Web 模式实现。

实现参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
和 [Electron Builder 配置](https://www.electron.build/v26/docs/configuration/)。
