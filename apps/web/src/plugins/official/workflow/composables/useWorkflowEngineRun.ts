/**
 * Web 端 useWorkflowEngineRun — stub（引擎通道占位）
 *
 * 根版为 re-export 壳（指向 apps/tauri 的 Tauri 事件 + invoke 实现）。
 * Web 端无 Rust Workflow 引擎：start() 直接返回 null 并在日志提示不可用，
 * UI 保持"引擎通道不可用"空态。Tauri 端实现独立保留，不受影响。
 */
import { ref, readonly } from 'vue'

export type EngineRunStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface EngineRunState {
  /** 当前 run 的 id，未启动为 null */
  runId: string | null
  /** 引擎状态 */
  status: EngineRunStatus
  /** 当前执行节点 id */
  currentNodeId: string | null
  /** 0..1 进度（最近一次 progress 事件） */
  progress: number
  /** 时间戳ed 日志行（最多 200 条） */
  log: string[]
  /** 终态错误信息 */
  error: string | null
}

const MAX_LOG_LINES = 200

export function useWorkflowEngineRun() {
  const state = ref<EngineRunState>({
    runId: null,
    status: 'idle',
    currentNodeId: null,
    progress: 0,
    log: [],
    error: null,
  })

  function appendLog(msg: string) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const line = `[${ts}] ${msg}`
    const next = [...state.value.log, line]
    if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES)
    state.value.log = next
  }

  function resetState() {
    state.value = {
      runId: null,
      status: 'idle',
      currentNodeId: null,
      progress: 0,
      log: [],
      error: null,
    }
  }

  async function start(_args: {
    id: string
    version?: number | null
    params: unknown
    triggeredBy: string
  }): Promise<string | null> {
    resetState()
    appendLog('Workflow 引擎通道不可用（Web 端未接入，请使用 Tauri 端运行）。')
    return null
  }

  function cancel(): void {
    if (state.value.status === 'running') {
      state.value.status = 'cancelled'
      appendLog('运行已取消（Web 端占位）。')
    }
  }

  function reset(): void {
    resetState()
  }

  return {
    state: readonly(state),
    start,
    cancel,
    reset,
  }
}
