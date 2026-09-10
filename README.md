# MaxCode

MaxCode 是一个多智能体编码工作台，支持 Claude Code、Codex、Gemini、OpenCode 等智能体，将会话管理、多智能体协作和代码操作集中在同一个界面中。可作为桌面应用、独立服务器或 Docker 容器运行。

本项目基于 [Codeg](https://github.com/xintaofei/codeg) 二次开发，主要改进会话体验、智能体兼容性和桌面运行方式。

## 主要功能

- **会话管理**：按项目管理和搜索历史会话，查看未读标记与运行状态。
- **多智能体协作**：通过 `@` 委派任务，查看子智能体的执行进展。
- **代码工作区**：文件编辑、代码差异、Git 操作和内置终端，支持多会话分屏。
- **任务与扩展**：支持独立工作树任务、定时自动化、MCP 和自定义技能。

## 安装与运行

**桌面端**：从 [MaxCode Releases](https://github.com/Nothing-129/maxcode/releases) 下载对应系统的安装包。当前桌面端使用 Electron，旧 Tauri 版本需手动安装新版。

**源码运行**：准备 Node.js 22.12+、项目指定版本的 pnpm 和 Rust 工具链后执行：

```bash
git clone https://github.com/Nothing-129/maxcode.git
cd maxcode
corepack pnpm install
corepack pnpm desktop:dev
```

**Docker**：在本仓库根目录执行 `docker compose up -d --build`，然后访问 `http://localhost:3080`。通过 `CODEG_TOKEN` 设置登录令牌，或在 `docker compose logs codeg` 中查看生成的令牌。项目目录挂载见 [docker-compose.yml](./docker-compose.yml)。

**独立服务器**：从 [Releases](https://github.com/Nothing-129/maxcode/releases) 获取服务器包，或使用本仓库的 [Linux / macOS 安装脚本](./install.sh)及 [Windows 安装脚本](./install.ps1)。

## 文档与反馈

- [桌面开发、打包与手机访问](./electron/README.md)
- [桌面迁移说明](./docs/maintenance/desktop-runtime-migration.md)
- [问题反馈](https://github.com/Nothing-129/maxcode/issues)
- [上游 Codeg 文档](https://docs.codeg.app)：通用功能参考，MaxCode 的安装和发布信息以本仓库为准。

## 鸣谢与许可

感谢 [Codeg](https://github.com/xintaofei/codeg) 及其贡献者，以及项目使用的 [Agent Client Protocol](https://agentclientprotocol.com)、[Superpowers](https://github.com/obra/superpowers)、[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 和 [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills)。

本项目遵循 [Apache-2.0](./LICENSE) 许可证。
