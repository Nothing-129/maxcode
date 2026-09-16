# 桌面运行时迁移与退役记录

桌面技术栈统一为 Electron + 共享 Rust 后端。2026-09-16 明确停止支持旧
Tauri 壳及其尚未迁移的三个功能：透明桌宠浮窗、原生远程工作区连接管理、
旧开机启动实现。开机启动现已通过 Electron 原生登录项 API 重新实现，
位于「设置 → 通用」，支持已打包的 macOS/Windows 应用；不自动启用。
后续上游合并不得恢复退役入口或 Tauri 运行时依赖。

## 已清理

- 旧桌面二进制、Tauri feature、插件、命令包装、窗口事件与构建钩子。
- 前端 Tauri transport、原生远程代理及对应窗口/更新/通知分支。
- 三个退役功能的前端入口、专属界面和旧桌面实现。
- Tauri 配置、capabilities、sidecar 准备脚本、legacy 命令和兼容 CI。

`desktop:dev`、`desktop:build`、`desktop:build:dmg`、`desktop:pack` 和
`desktop:smoke` 继续使用 Electron。业务请求统一使用 HTTP/WebSocket，原生
文件选择、通知、窗口控制、剪贴板与更新继续通过 Electron preload 提供。

## 保留项

| 内容 | 原因 |
| --- | --- |
| `src-tauri/src/`、Cargo、数据库、解析器、MCP | Electron 与服务器共用的业务核心 |
| `src-tauri/icons/` | Electron 安装包继续引用的品牌图标 |
| `src-tauri/` 目录名 | 保持上游路径一致，减少合并冲突；不代表依赖 Tauri |
| `native-keyring` | Electron 继续访问原系统钥匙串凭据 |
| `@tauri-apps/cli` | 仅用 `pnpm server:sign` 签署服务器更新，保持原 minisign 密钥和 `.sig` 格式 |
| 历史数据库结构与迁移 | 保持已有数据和备份兼容，不因源码清理删除用户数据 |

Cargo 默认 feature 为空，只保留 `codeg-server` 和 `codeg-mcp` 两个二进制。
Electron 构建显式启用 `native-keyring`；服务器/Docker 沿用原构建方式。

## 保持的用户行为

- Electron 与服务器的会话、智能体、终端、Git、文件、备份和更新功能继续保留。
- 浏览器访问远程服务器、手机 Web 服务与 Android/iOS 客户端不依赖已退役的原生
  远程工作区窗口，继续正常使用。
- Electron 更新继续使用差分下载及完整包回退，见
  [差分更新说明](electron-differential-updates.md)。服务器更新继续校验既有签名。
- Electron 继续使用旧 `app.codeg` 数据目录和原生 keyring；源码清理不删除
  数据库和凭据，不卸载本机应用，也不清空共享 Rust 构建缓存。
- 旧 Tauri 用户仍需手动安装 Electron；不提供旧 Tauri `latest.json` 更新清单。
  旧 WebView localStorage 不自动迁移，Electron 窗口偏好独立持久化。

退役契约位于 `src/maxcode-contracts/tauri-retirement.contract.test.ts`，并登记到
`config/maxcode-upstream-hotspots.json`。清理后应运行前端检查/测试/构建、两种
Rust feature 组合的测试，以及 Electron 打包和启动验证。
