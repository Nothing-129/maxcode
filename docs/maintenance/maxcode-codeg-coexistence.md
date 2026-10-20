# MaxCode 与 Codeg 共存

MaxCode 的应用私有目录独立于上游 Codeg，避免两套数据库迁移、设置、缓存和凭据互相影响。

| 内容 | MaxCode 默认值 | Codeg 默认值 |
| --- | --- | --- |
| macOS 应用数据 | `~/Library/Application Support/app.maxcode` | `~/Library/Application Support/app.codeg` |
| 私有配置与技能 | `~/.maxcode` | `~/.codeg` |
| 应用缓存 | `<cache>/app.maxcode` | `<cache>/app.codeg` |
| 管理的智能体更新 | `<local-data>/app.maxcode/agent-updates` | 使用自己的智能体安装方式 |
| 系统钥匙串服务名 | `maxcode` | `codeg` |
| 默认网页服务端口 | `3081` | `3080` |
| Electron 私有后端 | 本机随机空闲端口 | 上游自己的桌面运行时 |

应用标识保留已发布的 `app.codeg.electron`，它与上游 `app.codeg` 已不同。
保持现有标识用于兼容 macOS 签名更新和 Windows 升级识别；应用名、可执行入口和更新源仍为 MaxCode。
数据库文件继续叫 `codeg.db`，内部协议和 `codeg-mcp` 工具名保留兼容。隔离由独立根目录和凭据命名空间保证。

## 旧数据复制

只在默认桌面数据目录尚未建立时，从旧 `app.codeg` 复制数据；显式配置的数据目录和 smoke 测试不会自动导入真实用户目录。

- SQLite 用只读备份 API 生成包含 WAL 的一致快照，迁移不对源数据库执行恢复、写入或 checkpoint。
- 数据在暂存目录准备完成后发布。已有新目录优先，后续不会用 Codeg 数据覆盖或同步 MaxCode。
- 私有目录、应用数据与缓存分别复制；失败保留已完成部分，下次继续尚未完成的根目录。
- DB 和 ACP 记录中的应用私有路径、文件 URI 与内部链接指向副本。用户项目目录、原生智能体目录不搬迁。
- 外部及失效符号链接、待执行恢复标记不复制。内部链接重新指向新目录，避免通过相对路径写回旧目录。
- 仅复制导入 DB 内账号和消息通道对应的旧钥匙串条目，不覆盖已存在的新凭据。导入仅一次；退出登录后不回读 Codeg。系统拒绝钥匙串访问时需重新登录。
- 网页服务关闭自动启动，旧默认端口转换为 3081，重新生成独立访问令牌并清除旧公开地址。用户需手动重新开启网页服务、更新手机地址及反向代理。

原目录不自动移动或删除。这是安全副本，不是把已混用的旧数据库转换成上游数据库。
如果旧目录曾被 MaxCode 增加了下游迁移，首次安装 Codeg 前仍应备份并移开该旧数据目录，让 Codeg 新建自己的库。
迁移代码只在程序升级启动时运行；修改源码和运行测试不会迁移本机真实数据。

## 覆盖与共享边界

`MAXCODE_DATA_DIR` 和 `MAXCODE_HOME` 优先；`CODEG_DATA_DIR`、`CODEG_HOME` 作为显式兼容别名保留。
若主动把两个应用配置为同一个目录，仍会重新产生共享数据问题。
独立服务器默认数据目录为 `<platform-data>/maxcode`，兼容已有显式数据卷路径。

Claude、Codex、Grok、Pi、DeepSeek、Antigravity 和 ZCode 的原生登录、历史以及用户安装的 CLI 继续共用。
从任一应用修改这些原生配置、全局 npm 安装或原生技能目录，仍会对另一应用可见。
应用私有的技能中心、下载缓存和自动更新副本则放在 MaxCode 的独立目录。

## 保护

`desktop.product-namespace-isolation` 注册在上游热点清单，独立行为契约为
`product-namespace.contract.test.ts`、`product-namespace.contract.rs` 与 `product-credentials.contract.rs`。
它们验证 WAL、附件副本、已有目标优先、失败回滚、符号链接边界、路径重定位、凭据复制和退出后不恢复。
