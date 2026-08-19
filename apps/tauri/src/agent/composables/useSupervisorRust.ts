/** useSupervisorRust：Supervisor 编排模式 Tauri 适配器（Running 编排 4 模式 UI 下沉之 4）。
 *  经 createOrchestratorRunner 封装 `orchestrator_run_supervisor` 命令。
 *  入参 options = { specs, maxRounds }（对应 SupervisorExecuteOptions camelCase）。 */

import { createOrchestratorRunner } from './useOrchestratorRunner'

// 模块级单例
const runner = createOrchestratorRunner('orchestrator_run_supervisor')

export function useSupervisorRust() {
  return runner
}