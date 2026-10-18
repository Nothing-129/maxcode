# ZCode 接入扩大测试记录

日期：2026-09-26；Web 实测补充：2026-09-27。环境：macOS Apple Silicon、本机 ZCode 桌面运行时、`zcode-acp-server@0.48.0`、Node 24。

## 实测结果

| 场景              | 结果与证据                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MaxCode HTTP 接入 | 真实后端启动发布包，版本为 0.48.0；旧 `ZCODE_CLI`、`ZCODE_MODE`、`reasoning` 配置正常迁移；模型、模式、思考选择器就绪                                                           |
| 默认审批          | 适配器配置文件故意设为 yolo，MaxCode 新会话仍确认并展示 build                                                                                                                   |
| 文本附件与上下文  | 文本资源中的口令被正确读取；断开并重新建立 MaxCode 连接后仍能复述                                                                                                               |
| 持久化恢复        | 独立适配器进程通过 ACP UUID 和原生 sess\_ ID 执行 load/resume 均成功；两轮模型正文及最终 token usage 与 SQLite 一致                                                             |
| 工具允许与拒绝    | 经 MaxCode 处理 allow_once 后文件内容正确；处理 reject_once 后目标文件不存在，历史保留失败标记和错误正文                                                                        |
| 取消与继续        | 在工具运行中发送取消，返回 cancelled；下一轮对话正常完成。额外一次真实 sleep 20 测试捕获了子进程 PID，取消后约 3 秒复查确认该进程已退出                                         |
| 模型与思考等级    | 本机已配置 provider 的两个模型可切换并回切；low/high/max 可设置并恢复；没有将未经配置的所有模型算作可用                                                                         |
| 模式切换          | build/edit/yolo 成功。Web 实测纠正：原生以独立 planEnabled 开关开启 Plan，但 ACP 仍报告基础模式。0.48.0 接入暂不提供 Plan，阻止该请求发往适配器，并在恢复时重新确认基础权限模式 |
| 图片输入          | 一次真实模型请求正确识别 64×64 红色 PNG，无工具调用                                                                                                                             |
| 图片历史          | 使用实测原生 file part 形状，经真实 MaxCode HTTP 历史接口验证内联 data URL 与会话 artifact；两张图片的解码字节与原图完全一致                                                    |
| 数据目录          | 最终测试仅设置 ZCODE_HOME，接入层自动补齐原生存储参数；数据库、别名和历史均落入指定临时根                                                                                       |
| 错误运行时路径    | 无效 ZCODE_BIN 产生明确失败，没有被报告为正常连接                                                                                                                               |

## 本轮修复

1. 原生工具失败状态是 `error`，错误正文在 `state.error`；此前历史会丢失这些信息。
2. 原生助手消息将 provider/model 放在顶层；此前助手回合的模型信息会丢失。
3. 历史解析补齐图片 file part、data URL、同会话 artifact；纯图片用户消息得以保留。
4. 当前原生运行时没有让 SQLite 与 artifact 目录跟随适配器的数据根；启动时补齐其正式存储环境变量，并保留用户显式覆盖。
5. 后续模式切换与恢复偏好通过配置响应确认；Web 实测进一步发现 Plan 的独立开关未被 ACP 回报，因此对 0.48.0 隔离该选项，避免展示状态与真实执行状态不一致。
6. 明确失败或被拒绝的写入不再计入“已编辑文件”、变更统计、文件索引与 diff；保留旧历史和成功重试。

## 自动化验证

- ZCode Rust 测试：**28/28**，包括真实 ACP Channel 行为测试。
- 其他智能体能力保护：**2/2**。
- 下游契约：**158 个文件，807/807**。
- 服务器及 MCP 调试二进制构建通过：`cargo build --no-default-features --bin codeg-server --bin codeg-mcp`。
- 前端 `pnpm build`（含 TypeScript）通过；修改契约的 ESLint、格式及 diff 检查通过。
- Rust 测试链接器仍输出大型 unwind section 提示，测试与构建均成功。

## 已知限制与边界

- 0.48.0 的 fork 响应不符合 ACP；MaxCode 继续禁用 ZCode 会话分叉。
- 早期 HTTP 测试仅检查模式字段，曾误判 Plan 未生效；Web 工具测试证实 Plan 实际生效，却仍回报 Build。该记录已纠正，当前接入暂不提供 Plan。模型选择器曾展示两个被 Provider Registry 拒绝的 `builtin:bigmodel` 旧 ID；2026-09-27 的修复将其映射至已注册的 `bigmodel-api`，并合并重复的 GLM-5.3。
- Plan 隔离限定于 MaxCode 的模式选择/API、旧偏好和连接恢复。模型内部 `EnterPlanMode` 或原生斜杠命令仍可能开启这个未被 ACP 回报的开关；完整状态展示需要适配器支持 `planEnabled`，本次没有拦截用户提示词或改写第三方协议。
- 从未发送消息的空会话没有可靠的跨进程恢复记录；有消息的会话已验证恢复。
- 图片历史单张解码上限为 8 MiB；缺失、损坏或超限显示占位。解析器不下载远程图片，不跟随跨会话路径或符号链接。
- 适配器会附加完成/缓存用量文本，恢复时不重放该提示；测试比较的是模型正文。
- 本轮真实运行平台为 macOS；Windows 的 Node 路径兼容来自代码检查与回归保护，未进行 Windows 实机测试。

## Chrome Web 页面实测（2026-09-27）

此前 HTTP 测试没有覆盖浏览器交互。本轮重新执行 `pnpm build`，在隔离的本机服务与临时工作区中，使用 Chrome 原生窗口实际操作以下流程：

| 场景           | 结果                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录与新会话   | Token 登录成功，ZCode 入口、连接状态、模型/模式/思考强度选择器正常                                                                                                     |
| 文字与流式响应 | 页面输入并发送，收到 `WEB_ZCODE_927`；等待、思考、完成状态正常                                                                                                         |
| 工具审批       | 等待审批时整页刷新，审批卡恢复；Allow once 创建文件且内容为 `WEB_ALLOW_OK`；Deny 后另一文件不存在                                                                      |
| 图片输入与历史 | 经浏览器文件选择器上传 64×64 红图，模型回答 `Red`；刷新后仍可打开红色大图                                                                                              |
| 模型与取消     | 切换至第二个已配置模型，运行 `sleep 20` 并点击取消；原生记录为 cancelled；继续提问仍正确复述首轮口令                                                                   |
| 失败写入统计   | 修复前失败写入仍显示为已编辑；重新构建并刷新后，只统计成功的一个文件，拒绝文件从卡片移除                                                                               |
| Plan 修复回归  | 新建与恢复会话菜单均仅显示 build/edit/yolo/auto；原生 `/mode plan` 构造隐藏状态后重启恢复，Write 正常审批并创建 `WEB_RESUME_OK` 文件，原生消息确认 `planEnabled=false` |
| 设置页         | ZCode 适配器、版本、Node.js、npm 和 Node 版本预检均为 PASS；William 运行时说明正常展示                                                                                 |

浏览器实测暴露并修复了早期接口测试未能发现的 Plan 状态与失败写入统计问题。Web 证据根为 `/tmp/zcode-acp-review.h4oKTy/web-ui/`，包含 `web-results.json`、`web-history-final.json`、隔离原生数据库、测试文件与 `guard-final.log`。浏览器操作和截图记录在本次对话的工具结果中。

## 模型注册表修复复测（2026-09-27）

用户截图中的三项实际为 `bigmodel-api\\GLM-5.3`、`builtin:bigmodel\\GLM-5.3`、`builtin:bigmodel\\GLM-5.3-Flash`。直接对适配器复现：第一项成功，后两项返回 `unsupported config option or switch failed: model`。原生注册表接受 `bigmodel-api\\GLM-5.3-Flash`，也接受切回 GLM-5.3。MaxCode 现在只在适配器同时暴露注册表 provider 时转换旧 ID，菜单合并为两个选项；旧保存值与显式切换都通过实际注册表 ID 发送。失败时恢复已确认的选择器状态。

真实 MaxCode Web 后端在隔离数据根上恢复旧 Flash 偏好，切换到 GLM-5.3，再用旧 ID 切回 Flash，均成功；Flash 真实对话返回 `FLASH_MODEL_OK`。Chrome 页面实测菜单仅显示 GLM-5.3 和 GLM-5.3-Flash，选择 Flash 后显示已选中，切回 GLM-5.3 也正确且无错误提示。证据为 `/tmp/zcode-acp-review.h4oKTy/web-model-registry/live-model-result.json`、`flash-prompt-result.json` 和本次浏览器操作记录。

修复后的验证：ZCode Rust 测试 **30/30**，下游契约 **159 个文件、809/809**，`cargo build --no-default-features --bin codeg-server`、新增契约 ESLint、`git diff --check` 通过。已编译的本地隔离 Web 后端与 Chrome 页面完成实测；已安装桌面应用需要使用新构建的后端才能获得此修复。

## 复现脚本与结果

临时证据根：`/tmp/zcode-acp-review.h4oKTy/`。

- `smoke-maxcode-final.py` 与 `maxcode-final/results.json`：最终 MaxCode HTTP 全链路。
- `smoke-tools-cancel.py` 与 `tools-cancel-results.json`：工具允许、拒绝、取消与恢复。
- `smoke-cancel-pid.py` 与 `cancel-pid-smoke/results.json`：真实 sleep 子进程取消与退出验证。
- `live-history-check.py`、`verify-history-evidence.py`、`history-live-20260926-233614/results.json`：恢复与 SQLite 对照。
- `image-smoke/image-results.json`、`image-smoke/native-user-parts.json`：真实图片及原生持久化形状。
- `metadata-xmfmh1nb/results.json`、`metadata-x6bf4apl/results.json`：模式、模型、思考等级及异常配置。
- `expanded-guard.log`：最终契约测试输出。

测试文件读写限定在临时工作区。早期数据根问题定位时只读取了本次测试创建的原生会话；后续全链路已确认临时数据库隔离。
