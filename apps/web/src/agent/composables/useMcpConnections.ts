/**
 * 端分离批次2：已迁移至 @worldsmith/shared-composables/agent/useMcpConnections
 *
 * shared-composables 版本通过 options.getAgent 注入 agent 获取函数。
 * 本文件是 Tauri 端包装层，注入 useAgent()（来自 ./useAgent，即 useAgentRustAdapter）。
 * 其他端（Web/CLI）可直接使用 shared-composables 版本并传入各自的 agent 实现。
 */
import { useMcpConnections as useMcpConnectionsShared } from '@worldsmith/shared-composables/agent/useMcpConnections'
import { useAgent } from './useAgent'

export {
  DEFAULT_MCP_CONNECTIONS,
  type UseMcpConnectionsOptions,
} from '@worldsmith/shared-composables/agent/useMcpConnections'

export function useMcpConnections() {
  return useMcpConnectionsShared({ getAgent: () => useAgent() })
}
