/** useGoTRust：GoT（Graph of Thoughts）编排模式 Tauri 适配器（Running 编排 4 模式 UI 下沉之 3）。
 *  经 createOrchestratorRunner 封装 `orchestrator_run_got` 命令。 */

import { createOrchestratorRunner } from './useOrchestratorRunner'

// 模块级单例
const runner = createOrchestratorRunner('orchestrator_run_got')

export function useGoTRust() {
  return runner
}