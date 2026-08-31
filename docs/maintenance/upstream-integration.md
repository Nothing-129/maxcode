# MaxCode 上游集成防护

MaxCode 在上游 Codeg 之上维护自己的功能和交互约定。Git 只能可靠地发现文本
冲突，无法发现“代码自动合并成功，但上游改变了下游产品行为”的语义回归。

仓库使用两层防护：

1. `scripts/check-upstream-impact.mjs` 自动比较共同基点之后的改动，找出上游与
   MaxCode 同时修改的文件。
2. `config/maxcode-upstream-hotspots.json` 登记必须长期保留的产品行为，并要求
   每项行为拥有位于 `src/maxcode-contracts/` 的独立契约测试。

完整功能盘点见 [downstream-customizations.md](./downstream-customizations.md)。清单同时
保存功能来源提交；已经删除的下游功能进入 `retired`，避免合并时被意外恢复。

独立契约测试不能只放在上游组件旁边。上游可能同时改掉实现和自己的测试，导致
完整测试全部通过，却悄悄改变 MaxCode 的产品行为。

## 推荐集成流程

始终从干净的 `main` 创建临时集成分支，不直接在 `main` 合并：

```bash
git switch main
git status --short
git switch -c integrate/upstream-vNEXT
git fetch upstream
pnpm upstream:impact
```

`upstream:impact` 默认比较 `HEAD` 与 `upstream/main`。退出码 `2` 表示发现需要
人工评审的重叠或行为热点；这不是脚本故障。使用输出中的文件列表检查上游提交：

默认比较 `HEAD` 时，扫描也会纳入已暂存、未暂存和未跟踪文件，防止尚未提交的
下游功能被遗漏。正式合并仍应在干净的临时集成分支进行。

```bash
git log --oneline HEAD..upstream/main -- path/to/hotspot
git diff HEAD...upstream/main -- path/to/hotspot
```

确认产品行为后再进行不立即提交的合并：

```bash
git merge --no-commit --no-ff upstream/main
pnpm upstream:guard
pnpm eslint .
pnpm test
pnpm build
git commit
```

最后把集成分支合回 `main`。不要用 `-X ours`、`-X theirs` 或批量接受一侧的方式
绕过评审；这些选项同样无法判断产品语义。

如果需要比较指定版本，可显式传入引用：

```bash
pnpm upstream:impact -- --base <旧上游提交> --head <新上游提交>
```

## 登记新的 MaxCode 行为

新增或修改下游专属功能时：

1. 在 `src/maxcode-contracts/` 增加以用户可观察行为命名的契约测试。
2. 在 `config/maxcode-upstream-hotspots.json` 增加热点，填写分类、来源提交（尚未
   提交时用 `worktree-YYYY-MM-DD`）、实现文件和契约测试。
3. 更新 `downstream-customizations.md` 的功能表。
4. 运行 `pnpm upstream:guard` 验证清单及全部下游契约。

清单校验会拒绝不存在的实现路径、清单外的独立契约、缺少来源的功能，以及不在
`src/maxcode-contracts/` 中的契约测试。这些规则用于防止功能只改了代码却漏登记。

路径条目默认匹配单个文件；以 `/` 结尾的条目匹配整个目录。热点应尽量精确，
避免把无关上游更新全部变成人工阻塞。

## 命令说明

- `pnpm test:maxcode`：只运行 MaxCode 独立行为契约。
- `pnpm upstream:guard:validate`：校验热点清单及契约文件是否存在。
- `pnpm upstream:guard`：执行清单校验和 MaxCode 契约测试。
- `pnpm upstream:impact`：在合并前检查上游改动与下游定制的交集。

CI 会单独执行 `pnpm upstream:guard`，让下游契约失败在全量测试之前清晰显示。
