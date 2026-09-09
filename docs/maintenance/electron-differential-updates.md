# Electron 差分更新

Electron 使用固定版本 `electron-updater@6.8.9` 更新完整桌面应用，包括
Electron 运行时、前端、Rust 服务和 MCP。服务器自己的原地更新接口继续禁用，
避免单独替换应用包内的 Rust 可执行文件。

## 用户流程

现有版本入口定期检查个人仓库 `Nothing-129/maxcode` 的最新稳定版。
点击版本号可直接手动检查更新，检查期间显示加载状态。
发现新版本时，仅在版本号右侧显示更新图标，不发送通知，也不打开更新详情弹层。
用户点击图标后开始下载，优先复用缓存中的旧安装包，仅传输发生变化的数据块。
下载进度由主进程统一管理，切换页面、打开子窗口不会中断下载或重复启动任务。
校验通过后自动停止受管后端、安装并启动新版本，无需再次点击重启。
重启由全局更新 provider 驱动，更新入口卸载或切换页面不影响完成流程。
下载期间图标显示忙碌状态并禁用重复点击，失败后可从同一图标重试。

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
