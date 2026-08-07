/**
 * 本文件于 Phase 3 从 src/plugins/official/workflow/composables/useWorkflowEngineRun.ts 迁移到 apps/tauri/src/plugins/workflow/composables/useWorkflowEngineRun.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/** useWorkflowEngineRun：直接 Dispatch 兜底通道的运行控制器（事件监听 + 轮询兜底），详细见 docs/details/注释/tauri/useWorkflowEngineRun.md */

import { ref, onUnmounted, readonly } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  workflowRun,
  workflowStatus,
  workflowCancel,
  workflowGetRun,
} from '../api/workflowApi'
import { formatClock } from '../../../components/ui/format'

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

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
])

const POLL_INTERVAL_MS = 1500
const MAX_LOG_LINES = 200

/** workflow:dispatch 事件 payload（镜像 dispatch_protocol.rs::NodeDispatchRequest） */
interface DispatchEventPayload {
  request_id: string
  run_id: string
  node_id: string
  node_type: string
  protocol: 'sync' | 'stream'
}

/** workflow:progress 事件 payload（镜像 executor::ProgressEvent） */
interface ProgressEventPayload {
  run_id: string
  node_id: string
  progress: number
  status: string
  timestamp: number
}

export function useWorkflowEngineRun() {
  const state = ref<EngineRunState>({
    runId: null,
    status: 'idle',
    currentNodeId: null,
    progress: 0,
    log: [],
    error: null,
  })

  let pollTimer: number | null = null
  const unlistenFns: UnlistenFn[] = []
  let listenersReady = false

  function appendLog(msg: string) {
    const line = `[${formatClock(new Date())}] ${msg}`
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

  /** 监听 Tauri 事件（只 setup 一次） */
  async function ensureListeners() {
    if (listenersReady) return
    listenersReady = true

    const u1 = await listen<DispatchEventPayload>('workflow:dispatch', (e) => {
      const p = e.payload
      if (state.value.runId && p.run_id !== state.value.runId) return
      appendLog(`节点派发：${p.node_id}（${p.node_type} / ${p.protocol}）`)
    })
    unlistenFns.push(u1)

    const u2 = await listen<ProgressEventPayload>('workflow:progress', (e) => {
      const p = e.payload
      if (state.value.runId && p.run_id !== state.value.runId) return
      state.value.currentNodeId = p.node_id
      // progress 字段语义按 Rust 端为 0..1
      const pct = Math.max(0, Math.min(1, Number(p.progress) || 0))
      state.value.progress = pct
      appendLog(`节点 ${p.node_id} 进度 ${(pct * 100).toFixed(0)}% — ${p.status}`)
    })
    unlistenFns.push(u2)
  }

  function stopPolling() {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function startPolling(runId: string) {
    stopPolling()
    pollTimer = window.setInterval(async () => {
      try {
        const info = await workflowStatus(runId)
        if (!info) return
        state.value.status = (info.status as EngineRunStatus) || 'unknown'
        state.value.currentNodeId = info.current_node_id

        if (TERMINAL_STATUSES.has(info.status)) {
          stopPolling()
          appendLog(`运行结束：${info.status}`)
          // 拉详情拿 error 字段
          try {
            const detail = await workflowGetRun(runId)
            if (detail.error) {
              state.value.error = detail.error
              appendLog(`错误：${detail.error}`)
            }
          } catch {
            // 详情拉取失败不影响状态显示
          }
        }
      } catch (e) {
        appendLog(`状态轮询失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }, POLL_INTERVAL_MS)
  }

  /**
   * 启动一次 workflow 运行
   * @returns run_id（失败返回 null）
   */
  async function start(args: {
    id: string
    version?: number | null
    params: unknown
    triggeredBy: string
  }): Promise<string | null> {
    resetState()
    state.value.status = 'running'
    appendLog(`启动 workflow_run：id=${args.id} triggeredBy=${args.triggeredBy}`)

    try {
      await ensureListeners()
      const runId = await workflowRun(args)
      state.value.runId = runId
      appendLog(`获得 run_id：${runId}`)
      startPolling(runId)
      return runId
    } catch (e) {
      state.value.status = 'failed'
      const msg = e instanceof Error ? e.message : String(e)
      state.value.error = msg
      appendLog(`启动失败：${msg}`)
      return null
    }
  }

  /** 取消运行（幂等） */
  async function cancel(): Promise<void> {
    if (!state.value.runId) return
    try {
      await workflowCancel(state.value.runId)
      appendLog(`已请求取消 run ${state.value.runId}`)
    } catch (e) {
      appendLog(`取消失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 重置状态（保留 listeners 以便下次复用） */
  function reset() {
    stopPolling()
    resetState()
  }

  onUnmounted(() => {
    stopPolling()
    unlistenFns.forEach((fn) => fn())
    unlistenFns.length = 0
    listenersReady = false
  })

  return {
    state: readonly(state),
    start,
    cancel,
    reset,
  }
}
