# 参与开发

本仓为单人主导项目，以下规则描述的是**本仓实际执行的流程**，不是对外征集贡献的
承诺。提 PR 前请先开 issue 对齐方向，避免做完才发现方向不符。

## 环境

- Node 22+、pnpm 10、Rust stable（`worldsea-core` 需要系统 SQLite 开发库）
- 安装依赖：`pnpm install`（会自动装 git 钩子，见下）
- 开发运行：`pnpm dev`
- 构建安装包：`pnpm tauri:build`（需 Windows 桌面构建链）

## 门禁

提交与推送都会经过本地钩子，与 CI 跑**同一套脚本**（`scripts/gate.mjs`）：

| 钩子 | 跑什么 | 耗时 |
|---|---|---|
| `pre-commit` | 架构 / fork 台账 / 产物新鲜度 / 样式 / 文档链接 / 检查名一致性 | 约 2 秒 |
| `pre-push` | 以上 + `vue-tsc` 类型检查 | 约 60–90 秒 |

手动全跑：`pnpm gate`。逃生口 `SKIP_GATES=1`，仅在你明确知道为什么跳过时用。

**CI 是权威判定**。本地全绿不等于 CI 会绿：CI 是全新克隆，本地可能残留构建产物、
未被跟踪的文件或本机才有的文件。凡是依赖「文件存在」的判断，本地与 CI 都可能分叉。

## 分支与提交

- 分支从最新 `main` 切出，命名 `feat/<模块>` / `fix/<模块>` / `refactor/<模块>` / `chore/<主题>` / `docs/<主题>`
- `main` 禁直推、禁强推、禁删除；所有改动走 PR
- 提交信息 `type(scope): 中文描述`，`type` 取 `feat`/`fix`/`docs`/`style`/`refactor`/`perf`/`test`/`chore`
- 一次逻辑变更一个提交；合并用 squash，`main` 保持线性

## PR 要求

- 四项必需检查全绿才能合并：`Repo Gates`、`WASM Core`、`Frontend Typecheck`、`Unit Tests`
- PR 分支必须基于最新 `main`（`strict` 模式），`main` 前进后需先同步
- 会话语义：合并后自动删除远端分支

## 改 `dsh/` 的额外约束

`dsh/` 是我方 fork 的上游项目，改动受 `pnpm fork:check` 约束：

- 每一处改动都必须登记在 `docs/details/架构/dsh-fork台账.md`
- 改完源码必须重建产物：`tsc` → `tsdown` → `cargo build`；漏 `tsdown` 会让运行时
  仍加载旧 `lib/`，表现为「改了没生效」
- 核对改动是否生效要 grep `lib/index.js`，只看 `src/` 会假阳性

## 文档

- 中文正文，文件名用英文；禁用 emoji
- 正文引用其他文档用相对链接 `[文件](相对路径)`
- **链接目标必须已入库**：指向 `.gitignore` 覆盖的文件（如 `project_memory.md`）
  在 CI 必然断链——门禁会报红
- 计划类文档放 `docs/plans/`，完成后归档到 `docs/plans/已完成/` 并同步索引
- 改了行为就同步改文档；文档与代码不一致时以代码为准并修文档

## 许可

贡献的代码按 [MIT](LICENSE) 授权。第三方组件声明见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
