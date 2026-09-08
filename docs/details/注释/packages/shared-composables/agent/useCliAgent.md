# useCliAgent.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useCliAgent.ts`
> 说明：本文件为 useCliAgent 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

````
/**
 * CLI Agent 连接管理
 *
 * 管理 Web 端与 CLI Agent Server 的连接，
 * 提供工具调用、健康检查、自动/手动连接等能力。
 *
 * 阶段 2.0 批次3：HybridBackend 已移除，本 composable 仅保留连接管理能力，
 * 不再将连接桥接到 Agent 后端（Agent 循环已由 Rust 端接管）。
 *
 * 端分离 Phase 3：迁移至 @worldsea/shared-composables，三端共用。
 * Tauri 端若不需要 CLI Agent 连接，可不调用此 composable。
 */
````
