# useAgent.ts 详细注释

> 来源：`apps/web/src/agent/composables/useAgent.ts`
> 说明：本文件为 useAgent composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-24 行）

```
/**
 * # useAgent — Web 端入口（端分离 P3-W5）
 *
 * ## 架构位置
 * 本文件是 Web 端的 Agent Backend 入口，对应 Tauri 端的 useAgentRustAdapter。
 *
 * ## 端分离策略
 * - 共享层：@worldsmith/shared-composables/agent/useAgent（inject 模式 + 类型定义）
 * - Tauri 端：src/agent/composables/useAgentRust.ts（Rust IPC）
 * - Web 端：本文件（本地状态机 + @agent/execution 终端 + no-op 占位）
 *
 * ## 功能状态（功能退化版）
 * 当前 Agent 循环在 Tauri（Rust IPC）与 CLI Server（@agent/execution WebSocket），
 * Web 端聊天后端尚未接通。本适配器保证 AgentSpace UI 完整渲染与交互不崩：
 * - **可用**：messages（本地） / isStreaming / newSession / abort / clearHistory /
 *   isInitialized / ensureInitialized / 终端（execution adapter）
 * - **空 ref 占位**：a2uiSurfaces / deepSegments / finalOutput / totalUsage /
 *   cumulativeUsage / lastRequestUsage / activeTask / heartbeatStatus
 * - **no-op 方法**：sendBlockAction / setChatMode / updateModel / updateThinkingLevel /
 *   refreshSearchConfig / resolveDataBinding / createSubBackend / switchSession /
 *   resumeTask / discardTask / getProviderConfig
 *
 * 后续接入 Web 聊天后端时，仅需替换 sendMessage 内部实现。
 */
```
