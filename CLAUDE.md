# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 工作协议

- 如果涉及上传或推送，只允许上传或推送到用户自己的 GitHub 仓库，禁止上传或推送到上游仓库。
- 合并上游前必须从 `main` 创建临时集成分支，并在合并提交前运行
  `pnpm upstream:impact`。命中下游重叠文件或行为热点时，需要评审对应上游提交，
  不得用 `ours` / `theirs` 批量覆盖。
- 下游专属或与上游不同的用户可观察行为，必须在
  `src/maxcode-contracts/` 添加独立契约测试，并登记到
  `config/maxcode-upstream-hotspots.json`。完整流程见
  `docs/maintenance/upstream-integration.md`。

## 智能体维护范围

- 仅维护 Claude Code、Codex、Grok、Pi、DeepSeek、Google Antigravity 六种智能体。
- 设置、创建会话的智能体目录及后台自动更新仅面向这六种；隐藏新增自定义智能体入口。
- 其他智能体的实现和历史数据暂时保留；上游集成跳过其专属适配、版本和界面改动。
- 共用功能仅吸收对上述六种有价值的部分，不恢复其他智能体入口。

## 项目概述

MaxCode 是一个多智能体编码工作台，它将六种智能体（Claude Code、Codex CLI、Grok、Pi、DeepSeek、Google Antigravity）统一到一个工作区中，支持会话聚合和多智能体协作，支持桌面安装，服务器/Docker 部署。

## 技术栈

- **桌面运行时**: Electron（`electron/` 主进程 + preload，复用共享 Rust 服务）；旧 Tauri 壳已退役
- **服务器运行时**: 独立 Rust 二进制（Axum HTTP + WebSocket）
- **前端**: Next.js 16（静态导出模式）+ React 19 + TypeScript（strict）
- **样式**: Tailwind CSS v4 + shadcn/ui（radix-maia 风格）
- **国际化**: next-intl
- **数据库**: SeaORM + SQLite
- **包管理器**: pnpm

## 代码检查与测试（任务完成后进行必要的检查）

### 前端

```bash
pnpm eslint .                  # lint
pnpm test                      # vitest 全跑（CI 用同一条命令）
pnpm test:watch                # 开发时增量重跑
pnpm test:coverage             # 覆盖率报告（输出到 coverage/index.html）
pnpm build                     # 静态导出构建
```

### 后端 Rust（在 `src-tauri/` 目录下执行）

```bash
# Electron 桌面后端
cargo check --no-default-features --features native-keyring --bin codeg-server --bin codeg-mcp
cargo test --no-default-features --features native-keyring --bin codeg-server --lib

# 服务器模式
cargo check --no-default-features --bin codeg-server
cargo test --no-default-features --bin codeg-server --lib
cargo clippy --no-default-features --bin codeg-server --lib -- -D warnings

# codeg-mcp 协作伴生进程（多智能体委托）
cargo check --no-default-features --bin codeg-mcp
cargo clippy --no-default-features --bin codeg-mcp -- -D warnings

# 解析器快照评审（输出变化时）
cargo insta review
INSTA_UPDATE=auto cargo test --features test-utils     # 自动写新 .snap
```

### 本地桌面安装包（macOS Apple Silicon）

当前桌面入口使用 Electron：

```bash
pnpm desktop:dev
pnpm desktop:build:dmg
```

产物位于 `electron/dist/`；详细流程见 `electron/README.md`。Electron 复用
`src-tauri/target/release` 中无默认 feature 的后端和 MCP 伴生进程。

默认 CI 和发布流程使用 Electron。`pnpm desktop:pack` 生成解包应用，
`pnpm desktop:smoke` 验证包内前端和后端的启动链路。

Electron 开机启动使用原生登录项 API，支持已打包的 macOS/Windows 应用。
旧 Tauri 壳、透明桌宠浮窗、原生远程工作区连接管理及旧开机启动实现已退役，
不得在上游合并时恢复。共享 Rust 后端继续位于 `src-tauri/`，该目录名不代表
依赖 Tauri。`@tauri-apps/cli` 仅供 `pnpm server:sign` 生成兼容的服务器签名。
范围和数据兼容说明见 `docs/maintenance/desktop-runtime-migration.md`。

## 架构

### 运行模式

Electron 桌面入口位于 `electron/main.cjs`，由主进程管理本机
`codeg-server` 子进程，通过 HTTP/WebSocket 复用共享业务。`electron/preload.cjs`
提供受限原生能力，打包配置为 `electron/electron-builder.cjs`。

共享 Rust 包包含两个二进制，默认 feature 为空：

- **`codeg-server`**（无 feature，`--no-default-features`）：独立服务器模式，仅编译 Axum HTTP API + WebSocket
- **`codeg-mcp`**（无 feature）：per-launch stdio MCP 伴生进程，被注入到代理 CLI 的 MCP 配置中，向 LLM 暴露**异步**子智能体委托工具。

### 共享核心

- **`app_state.rs`** — `AppState` 共享状态结构，Electron 与服务器共用
- **`web/event_bridge.rs`** — `EventEmitter` 将后端事件广播给 WebSocket 客户端
- **`web/router.rs`** — Axum 路由，接受 `Arc<AppState>`
- **`web/handlers/`** — HTTP API 端点，全部使用 `Extension<Arc<AppState>>`

### Rust 后端（`src-tauri/src/`）

后端负责读取和解析本地文件系统上的代理会话文件：

- **`app_state.rs`** — 共享状态（db、连接管理器、终端管理器、事件广播器）
- **`models/`** — 共享数据结构
- **`parsers/`** — 每个智能体一个解析器
- **`commands/`** — 业务逻辑，`_core` 函数由 HTTP handlers 调用
- **`web/`** — Axum HTTP API + WebSocket + 静态文件服务 + 认证中间件
- **`acp/`** — Agent Client Protocol 连接管理
- **`db/`** — SeaORM + SQLite

### 前端（`src/`）

#### 核心库（`lib/`）

- **`transport/`** — HTTP/WebSocket Transport，供 Electron 和浏览器共用
- **`adapters/`** — AI 响应到组件渲染的适配器
- **`types.ts`** — Rust 模型的 TypeScript 镜像
- **`api.ts`** — 主 API 客户端
- **`platform.ts`** — Electron 原生桥接及浏览器回退

#### 国际化（`i18n/`）

- 支持 10 种语言：英语、简体中文、繁体中文、日语、韩语、西班牙语、德语、法语、葡萄牙语、阿拉伯语
- 使用 next-intl 框架，消息文件存放在 `i18n/messages/`

### 数据流

Electron 桌面：前端 `fetch()` / WebSocket → 本机 Rust 服务 → 共享业务；原生操作通过 preload → Electron IPC
服务器模式：前端 `fetch()` → Axum HTTP API → 同一业务逻辑 → 返回 JSON
实时通信：后端事件 → EventEmitter（WebSocket 广播）→ 前端

### 条件编译约定

- `native-keyring` — Electron 后端启用系统钥匙串，沿用已有凭据；服务器默认关闭
- `test-utils` — 仅测试启用的共享测试工具
- `_core` 后缀函数 — 接受普通引用参数（`&AppDatabase`、`&EventEmitter`），供 HTTP handlers 调用

## 关键约束

- **仅支持静态导出**：`next.config.ts` 设置 `output: "export"`，不支持动态路由（`[param]`），必须使用查询参数替代
- **路径别名**：`@/*` 映射到 `./src/*`，导入写法为 `@/lib/utils`、`@/components/ui/button`
- **服务器部署**：通过环境变量配置（`CODEG_PORT`、`CODEG_HOST`、`CODEG_TOKEN`、`CODEG_DATA_DIR`、`CODEG_STATIC_DIR`）
- **Docker 支持**：多阶段构建（Node.js + Rust），支持 `docker-compose` 一键部署

## 代码风格

- Prettier：无分号、尾逗号（es5）、2 空格缩进、80 字符宽度
- ESLint：next/core-web-vitals + typescript + prettier
- TypeScript：strict 模式，启用 `noUnusedLocals` 和 `noUnusedParameters`
- Rust：2021 edition，使用 `thiserror` 定义错误类型
