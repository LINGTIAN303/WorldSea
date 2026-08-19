/** useToTRust：ToT（Tree of Thoughts）编排模式 Tauri 适配器（Running 编排 4 模式 UI 下沉之 2）。
 *  经 createOrchestratorRunner 封装 `orchestrator_run_tot` 命令。 */

import { createOrchestratorRunner } from './useOrchestratorRunner'

// 模块级单例：一个 ToT 运行器（busy/error/result 全局共享）
const runner = createOrchestratorRunner('orchestrator_run_tot')

export function useToTRust() {
  return runner
}