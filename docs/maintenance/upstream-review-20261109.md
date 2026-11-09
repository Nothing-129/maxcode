# 2026-11-09 上游稳定性选择性集成

下游起点 a56112596；上游固定 39fe4cc09（v0.42.1）。从 main 创建
integrate/upstream-selected-20261109。原有未提交改动保留，补丁与未跟踪文件
备份在 /tmp/maxcode-upstream-20261109。未执行整分支合并或推送。

- b182303ee：后台工作统一保活，补齐 AIR、Remote Control、委托子连接与删除
  会话清理；保留 MaxCode warm pool、surface release 和连接恢复。
- 6d7aa101d / a58491dc1：读取 DeepSeek v3 包装结果及 v4 一等工具消息，保留
  first-token timing 和拒绝消息恢复；各代日志均识别 cacheWriteTokens。
- 785d5fde7 / 54c7fb632：Grok 1.0.77；安装及重试显式允许 npm 生命周期脚本；
  npm 遗留副本不再被识别为独立安装。保留 DeepSeek 安装脚本和运行时验证。
- 503645bca：Claude ACP 0.101.0，观察空闲压缩，保留配置错误路径。
  新建会话遵循上游 Auto；已保存的模式继续生效，Manual 仍可选择。
  API 网关不支持 Auto 权限检查时可能拒绝执行，应切换 Manual。
- cfa6c8462 / 577e73491：Office 仅接受本轮工具写入并经文件时间确认的路径，
  时间窗口允许 50 ms 内核时钟差；保持 v2 显式开关默认关闭与窗口内关闭记忆。
- 54c7fb632：ZCode 桥接 0.82.1，保留 ACP 历史与运行时发现。

未吸收其他智能体、Tauri 壳、浏览器实现或 Forge 多 Issue 功能。
独立契约入口 upstream-selected-20261109.contract.test.ts；Rust 私有行为契约
从安装器和 DeepSeek 解析器注册。热点 runtime.selected-upstream-20261109。

已完成：

- `pnpm upstream:impact`：退出码 2，命中既有下游热点，逐块评审后移植。
- `pnpm upstream:guard --maxWorkers=2`：348 个文件、1778 项测试通过。
- `pnpm build`、`pnpm exec tsc --noEmit`、`git diff --check` 通过。
- `pnpm eslint .`：零错误，保留 web-auth.ts 的一项已有导航警告。
- native-keyring 桌面后端与 codeg-mcp 编译通过。
- 前端第二轮全量：9328 项通过，6 项失败。其中 5 项连接状态夹具在修正快照
  稳定性后独立复跑全部通过，且最终下游契约全量通过；另 1 项为并行界面改动
  与原有手机抽屉宽度断言不一致（conversation-detail-panel-layout.test.ts:62），
  本轮未修改该布局或断言。
- Rust 首轮：4653 项通过、1 项旧 ZCode 版本断言失败、2 项已有忽略；旧断言
  已更新为 0.82.1；最终 `cargo test --no-default-features --lib -j 1`：
  4654 项通过、零失败、2 项已有忽略。
- Clippy 首轮发现新增文档注释缩进问题，已修正；最终严格检查通过：
  `cargo clippy --no-default-features --bin codeg-server --bin codeg-mcp --lib -- -D warnings`。

Grok 本地隔离自动更新路径另补 npm 12 的 allow-scripts 参数，保留私有
GROK_HOME，不影响用户现有目录。全程未安装或更新机器上的智能体。
