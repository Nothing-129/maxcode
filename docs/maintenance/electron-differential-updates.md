# Electron 差分更新

Electron 使用固定版本 `electron-updater@6.8.9` 更新完整桌面应用，包括
Electron 运行时、前端、Rust 服务和 MCP。服务器自己的原地更新接口继续禁用，
避免单独替换应用包内的 Rust 可执行文件。

## 用户流程

现有版本入口定期检查个人仓库 `Nothing-129/maxcode` 的最新稳定版。
检查前会并行探测 GitHub 与 Cloudflare Tunnel 备用源的清单耗时。
GitHub 超过 800ms 且慢于备用源、或探测失败时，直接改走
`https://maxcode-update.aifalao.net`；GitHub 仍作为失败后的回退。
该镜像只转发 MaxCode 的清单、安装包和 blockmap，
通过 222 上的 Mihomo 拉取 GitHub。客户端使用公网 HTTPS 域名，不依赖局域网连通性。
发布仍只上传到 GitHub，镜像不作为 publish 目标。
点击版本号可直接手动检查更新，检查期间显示加载状态。
发现新版本时，由主进程自动在后台下载，不发送通知，也不打开更新详情弹层。
优先复用缓存中的旧安装包，仅传输发生变化的数据块。
下载进度由主进程统一管理，切换页面、打开子窗口不会中断下载或重复启动任务。
下载完成且校验通过后，才在版本号右侧显示实心圆形更新图标。
用户点击图标后，停止受管后端、安装并重启到新版本；未点击时不会自动重启，
切换页面、重新加载窗口或正常退出应用也不会触发自动安装。
下载期间不显示更新按钮；下载失败后可点击版本号重新检查并重试。
服务器端仍保留原有下载完成后自动重启的流程。

macOS 需要 Developer ID 签名发布包，本地 ad-hoc 包不启用自动安装。
Windows 使用 NSIS 更新，Linux AppImage 使用内嵌块信息；DEB 安装继续采用
手动安装方式。开发启动和 smoke 模式禁用更新网络请求及安装。
预发布包也只跟随最新稳定版，不自动安装其他预发布版本。

## 何时下载完整包

- 首次安装后没有可复用的更新缓存。macOS 通常需要先完整下载一次 ZIP，之后
  才能利用缓存差分；不要把第一次升级也承诺成小流量更新。
- 旧块信息已被发布源删除，或旧缓存缺失、损坏。
- 差分请求失败或重建后的 SHA-512 校验不匹配。

回退完整下载仍执行安装包校验。无法下载或校验失败时不会进入可安装状态。
Electron 内核升级、Rust 重编译和打包方式变化都可能增大差异，下载量不作固定保证。

## 发布约定

构建始终使用 `--publish never`，生成元数据不等于上传。
GitHub Actions 显式上传且仅允许个人仓库发布。

| 平台 | 更新清单 | 差分数据 |
| --- | --- | --- |
| macOS arm64 | `latest-arm64-mac.yml` | ZIP + ZIP.blockmap |
| macOS x64 | `latest-x64-mac.yml` | ZIP + ZIP.blockmap |
| Windows x64 | `latest-x64.yml` | EXE + EXE.blockmap |
| Windows arm64 | `latest-arm64.yml` | EXE + EXE.blockmap |
| Linux x64 | `latest-x64-linux.yml` | AppImage 内嵌 blockmap |

不同架构各自上传自己的清单，避免矩阵构建相互覆盖。上传前校验版本、文件大小、
SHA-512 和 blockmap 格式；发布前要求所有选中平台的清单与差分文件齐全。
保留历史发布的 ZIP/EXE 与 blockmap，客户端可从旧版本 tag 获取旧块信息。
旧 Tauri 用户及此前没有更新器的 Electron 用户需手动安装一次包含更新器的新版本。

## Cloudflare Tunnel 备用源部署

隧道名使用 `maxcode-update`，Public Hostname 为 `maxcode-update.aifalao.net`，
服务类型为 HTTP，origin 为 `http://192.168.10.222:17896`。
222 上的 `maxcode-update-mirror.service` 保留现有监听地址和 Mihomo 代理。
`cloudflare/cloudflared:latest` 容器须使用 `network_mode: host`，
避免 Docker bridge 到该监听地址超时。配置容器自动重启。
Tunnel token 仅存放在 222 本地权限为 `0600` 的 env 文件中，
通过容器环境变量 `TUNNEL_TOKEN` 传入，不写入仓库或文档。

generic provider 从域名根路径读取 `latest-<arch>[-mac|-linux].yml`；
旧版本 blockmap 从 `/download/v<当前运行版本>/<file>.blockmap` 获取。
镜像将这些路径映射到个人 GitHub Releases；非更新资产路径返回 404。

## 验证

`src/maxcode-contracts/electron-*.contract.test.ts` 覆盖主进程生命周期、IPC 路由、
发布清单、真实 HTTP Range 差分下载，以及缺缓存、坏块信息和缓存损坏时的回退。

可对两次真实 ZIP 构建运行本地测量，两个 ZIP 旁边都需有同名 `.blockmap`：

```bash
node electron/scripts/differential-check.cjs /path/to/old.zip /path/to/new.zip
```

脚本仅启动 loopback HTTP 服务，使用应用同版本的差分下载器重建文件、验证
SHA-512，并报告变化块、完整下载和块信息各自传输的字节数。不会安装或发布。

2026-09-08 本地测量：完整 ZIP 172,425,213 字节，变化块 20,302,278 字节，
块信息 353,921 字节，合计约 19.7 MiB，约为完整包的 12%。这是本轮两次本地
构建之间的测量，不代表所有版本或首次安装的下载量。远端已发布版本到新版的
签名安装，需要在正式发布环境另行验证。
