/**
 * CLI 端 ExecutionAdapter 注册入口
 *
 * Phase 6 清理：从 worldsmith-agent/src/execution 迁移，
 * 仅注册 NodeExecutionAdapter（CLI serve 模式专用），
 * 不再注册 Tauri/WebSocket 适配器（各端自行注册）。
 */
import { registerExecutionAdapterFactory } from '@worldsmith/agent-runtime/execution'
import { NodeExecutionAdapter } from './node-adapter'

let registered = false

/**
 * 注册 CLI 端 ExecutionAdapter 工厂
 * 幂等：多次调用只注册一次
 */
export function registerCliExecutionAdapter(): void {
  if (registered) return
  registerExecutionAdapterFactory({
    createNodeAdapter: () => new NodeExecutionAdapter(),
  })
  registered = true
}

// 重导出 createExecutionAdapter 以便 serve.ts 使用
export { createExecutionAdapter } from '@worldsmith/agent-runtime/execution'
