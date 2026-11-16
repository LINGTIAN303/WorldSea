---
status: 现行
date: 2026-11-17
scope: docs/details/架构/dsh
---

# dsh 接缝入口

> `dsh/` 是仓内的 deepseek-harness **fork**，充当 Agent 面。本组收「与它的接缝」，不收 dsh 自身文档（那在仓根 `dsh/`）。

## 文档

| 文档 | 回答什么 |
|---|---|
| [与 dsh 的接缝](与dsh的接缝.md) | 三个面与四个 ACL 文件、IPC 管道、两窗各注入什么、21 个 `dsh_*.rs` 各管什么、两个写者 |
| [dsh 运行手册](dsh-运行手册.md) | 装 / 构 / 起、六条前置、排障配方、上游追版与摘取口径 |
| [dsh fork 台账](dsh-fork台账.md) | 我方对 `dsh/` 的每一处改动（门禁 `pnpm fork:check` 强制登记） |

## 三条纪律

1. **收敛接缝**：能在壳侧做的不要在 `dsh/` 里做。改 dsh 的每一处都是追版时的成本。
2. **登记即提交**：改 `dsh/` 必须同批更新台账，否则 `fork:check` 报红。
3. **保留 dsh 自带门禁**：`dsh/` 内的 lint / typecheck / 测试照跑，不因它是 fork 就跳过。

## 与「产品域插件系统」的关系

两棵树**对等**，各有自己的服务命名空间与生命周期：

| | dsh 树 | 产品域树 |
|---|---|---|
| 位置 | `dsh/`（Node 进程） | `apps/tauri/src/world/`（webview 内） |
| 插件模型 | cordis（`export const name/inject` + `apply`） | cordis 4.0.4（自 vendor）+ 自定清单 |
| 交界 | 一律走壳：IPC 管道 / 能力桥 / 文件系统 | 同左 |

本树**只长世界语义**（实体 / 芽 / 编辑器 / 视图），不许长 session / turn / tool-loop / sandbox——需要这些去调 dsh，或经壳能力桥。
