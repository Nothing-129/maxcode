# 桌面运行时清理清单

当前默认桌面技术栈是 Electron + 无 Tauri feature 的 Rust 后端。
本轮完成入口、CI、发布与文档迁移；旧 Tauri 壳保留为兼容实现，尚未退役。

## 已完成

- `desktop:dev`、`desktop:build`、`desktop:build:dmg`、`desktop:pack` 和
  `desktop:smoke` 统一使用 Electron。原有 `electron:*` 别名继续兼容。
- 默认 CI 覆盖 Electron 原生 keyring、Rust 集成测试、MCP，以及三平台打包后
  的真实应用启动；不再安装 WebKit 或编译 Tauri 壳。
- 发布按原生架构构建 Electron，验证安装包、SHA-256、macOS 签名及公证。
  选中平台失败时保留草稿，不发布不完整版本；只允许写入个人 MaxCode 仓库。
- 旧 Tauri 构建入口标为 `legacy:tauri:*`，兼容 CI 移入仅手动触发的
  `legacy-tauri.yml`。默认发布不再生成 Tauri 安装包和 `latest.json`。
- 服务器发布仍保留原 minisign 密钥、`.sig` 格式和校验逻辑。`tauri` CLI
  仍被服务器签名使用，不能随旧桌面发布一起删除。

Electron 自动更新已接入稳定版差分下载及完整包回退，见
[差分更新说明](electron-differential-updates.md)。旧 Tauri 更新器仅为兼容壳保留。

## 暂时保留及原因

| 内容 | 原因与后续处理 |
| --- | --- |
| `src-tauri/src/`、Cargo、数据库、解析器、MCP | Electron 与服务器共用的业务核心，长期保留 |
| `src-tauri/icons/` | Electron 安装包仍引用；需要整理时迁移引用后再移动 |
| `src-tauri/` 目录名 | 保持上游路径一致，避免制造大面积合并冲突 |
| `tauri-runtime`、旧入口、capabilities、Tauri 插件 | 兼容壳仍可构建，待功能去留确定后一起删除 |
| 前端 Tauri transport、事件及窗口分支 | 与兼容壳成套保留，不能只卸载 npm 包 |
| Cargo 默认 `tauri-runtime` feature | 兼容上游裸 Cargo 命令；所有正式 Electron / server 命令显式传 `--no-default-features` |
| `tauri:before-*`、sidecar 准备脚本 | 旧 Tauri 配置仍引用，只由兼容构建调用 |

## 尚未迁移的功能

这些能力继续留在兼容实现中，Electron 中对应入口保持关闭：

| 功能 | 后续迁移要求 |
| --- | --- |
| 透明桌宠浮窗 | Electron 透明窗口、拖拽、置顶及跨窗口事件契约 |
| 原生远程工作区连接管理 | 连接配置、远程 transport、窗口与认证生命周期契约 |
| 开机启动设置 | Electron 原生登录项能力及设置持久化契约 |

本轮不将上述功能视为已弃用。逐项迁移并验证，或明确决定停止支持后，才能
删除对应旧实现；新行为须在 `src/maxcode-contracts/` 添加契约并登记热点。

## 用户数据和旧版本升级

新 Electron 发布不提供 Tauri 自动更新清单，旧用户需手动下载安装。
Electron 继续使用旧 `app.codeg` 数据目录及原生 keyring，不删除数据库和凭据。
旧 Tauri WebView 的 localStorage 不自动迁移；Electron 的窗口偏好独立持久化。
清理源码不包含删除本机应用数据、卸载旧应用或清空共享 Rust 构建缓存。

## 下一阶段删除顺序

1. 完成上表功能迁移或确定其退役范围，补齐契约测试。
2. 删除前端 Tauri transport 与原生能力分支，再卸载无引用 npm 插件。
3. 删除旧壳入口、Tauri 命令包装和配置，保留 `_core` 共享业务及 HTTP 入口。
4. 清理 Cargo Tauri feature、插件与构建钩子；替换服务器签名工具后再移除 CLI。
5. 删除手动兼容 CI 和 legacy 脚本，运行前端、Rust、打包和启动验证。

原生 runner 标签依据 [GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)，
目标映射与完整产物检查集中在 `electron/scripts/release.cjs`。
