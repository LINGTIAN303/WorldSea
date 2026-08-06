# useMcpConnections.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useMcpConnections.ts`
> 说明：本文件为 useMcpConnections 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-22 行）

````
/**
 * # useMcpConnections — MCP 连接管理（端分离批次2）
 *
 * ## 端分离改造
 * 原 `src/agent/composables/useMcpConnections.ts` 直接依赖 `useAgent()`。
 * 迁移至 shared-composables 后，改为通过 `options.getAgent` 注入 agent 获取函数，
 * 避免对具体端实现的硬依赖。
 *
 * ## 使用方式
 * ```ts
 * // Tauri 端（src/agent/composables/useMcpConnections.ts 包装）
 * import { useMcpConnections } from '@worldsmith/shared-composables/agent/useMcpConnections'
 * import { useAgent } from './useAgent'
 * export function useMcpConnections() {
 *   return useMcpConnectionsShared({ getAgent: () => useAgent() })
 * }
 *
 * // Web/CLI 端（注入各自的 agent 实现）
 * import { useMcpConnections } from '@worldsmith/shared-composables/agent/useMcpConnections'
 * useMcpConnections({ getAgent: () => useWebAgent() })
 * ```
 */
````
