# 2026-09-14 上游聊天与 DeepSeek 设置吸收

## 范围

用户确认「本地 Markdown 图片 / 输入框右键 / 文件徽章下载」以及
「DeepSeek 0.9.0 模型面板」与已重写界面没有产品冲突，要求接上。
从 `752fa502` 创建 `integrate/upstream-chat-deepseek-20260914`。
没有整包合并上游。

## 已吸收

| 功能 | 上游来源 | MaxCode 适配 |
| --- | --- | --- |
| 本地 Markdown 图片内联 | `402d8b09`、`049ef608` | 新增 remark 插件与 confined reader；`MessageListView` 包一层 provider。文件链接徽章、自动路径链接、公开分享链接策略不变 |
| 输入框右键选中词并打开 | `06a2a503`、`0ebad4aa` | 在现有剪切/复制/纯文本粘贴菜单之上加一行；不替换现有菜单 |
| 文件徽章下载 | `f39ff3e2` | 网页/远程工作区显示下载；保留打开、访达显示、复制路径 |
| DeepSeek 模型列表 + 0.9.0 | `5a20a569`、`193046cb` | 保留 Key/URL 面板，其下增加模型目录编辑器；适配器钉到 0.9.0。v3 历史契约与 `assistant/chunk` 首 token 计时保留 |

## 上游影响评审

在提交前执行 `pnpm upstream:impact`。守卫按设计拦截了自
`4f0bd5f3` 至 `18046ea4` 的重叠范围；逐项评审本次采用的上游提交后，确认：

- 新增的 Markdown 图片、输入框 token 操作与 DeepSeek 目录实现保持上游原样；
- MaxCode 的消息布局、输入框菜单、DeepSeek Key/URL 面板与历史解析行为均保留；
- 为四项用户可观察行为新增独立契约并登记热点，没有使用 `ours` / `theirs`
  批量覆盖。

## 验证

- 针对性前端测试：12 个文件、169 项通过；
- DeepSeek Rust 单元测试：34 项通过；
- MaxCode 契约：118 个文件、579 项通过；
- 全量 Vitest：572 个文件、6972 项通过；
- 改动文件 ESLint：通过；
- Next.js 静态导出构建：通过；
- Electron Rust 后端与 MCP（`native-keyring`）：`cargo check` 通过；
- 浏览器桌面端：本地 PNG 内联并可打开预览，输入框右键 URL 可准确打开，
  文件徽章下载成功且内容一致，DeepSeek 模型列表可保存并恢复代理默认；
- 浏览器移动端（390×844）：本地图片、文件徽章和 DeepSeek 模型面板正常，
  页面无横向溢出。
