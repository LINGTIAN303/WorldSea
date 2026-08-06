# useAgent.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useAgent.ts`
> 说明：本文件为 useAgent 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-17 行）

````
/**
 * # useAgent — 端无关 Agent Backend 注入层
 *
 * ## 设计目标
 * 三端（Web / Tauri / CLI）共享的 Agent Backend 注入工具。
 * 各端在应用入口调用 `provideAgentBackend(backend)` 注入具体实现，
 * 共享代码通过 `useAgent()` / `useAgentOptional()` 获取。
 *
 * ## 类型定义
 * 保留被多文件引用的类型（DeepSegment / ToolCallView 等），
 * 各端 useAgent 实现可 re-export 这些类型保持向后兼容。
 *
 * ## 注入模式
 * - `useAgent()`：必须注入，未注入抛错（用于核心路径）
 * - `useAgentOptional()`：可选注入，未注入返回 null（用于降级路径）
 * - `provideAgentBackend(backend)`：在组件 setup 中调用，注入给后代组件
 */
````

## 注释块 2（原文件第 73-82 行）

````
/**
 * Agent Backend 注入 Key
 *
 * 使用宽松类型（any）以兼容各端不同的返回类型：
 * - Tauri 端：useAgentRustAdapter() 返回的完整适配器（含 UI 状态、会话管理等）
 * - Web 端：待实现的 WebSocket 适配器
 * - CLI 端：待实现的 CLI 适配器
 *
 * 严格类型校验在各端入口完成，shared 层只保证注入契约。
 */
````
