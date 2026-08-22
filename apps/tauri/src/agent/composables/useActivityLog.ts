/**
 * Tauri 端活动日志 composable（Phase D 迁入：活动日志面板依赖）
 * 与 web 端 space/composables/useActivityLog 同形，但日志按「会话」隔离：
 * 权威存储为 useSessionViewState（localStorage 按 sessionId 持久化），本模块只暴露 active 会话的日志。
 * - logs：active 会话的日志（computed）
 * - addLog / clearLogs：默认写 active 会话；也可显式传 sessionId（trace 监听按事件源会话写入）
 */
import { computed } from 'vue'
import { useSessionViewState } from './useSessionViewState'

export interface ActivityLogEntry {
  id: string
  type: 'info' | 'tool' | 'knowledge' | 'memory' | 'error'
  message: string
  timestamp: number
  detail?: string
  /** A1 全链路事件流可观测：原始 trace 事件类型（如 agent_start / tool_call_start / error），
   *  供活动日志按类目过滤或展示事件链。非 trace 来源（普通 addLog）不填。 */
  traceType?: string
}

let idCounter = 0

function makeEntry(
  type: ActivityLogEntry['type'],
  message: string,
  detail?: string,
  traceType?: string,
): ActivityLogEntry {
  return {
    id: `alog_${Date.now()}_${++idCounter}`,
    type,
    message,
    timestamp: Date.now(),
    detail,
    traceType,
  }
}

/** 活动日志写入（默认 active 会话；trace 监听可显式传 sessionId） */
function addLog(
  type: ActivityLogEntry['type'],
  message: string,
  detail?: string,
  traceType?: string,
  sessionId?: string,
): void {
  const vs = useSessionViewState()
  const sid = sessionId ?? vs.activeSessionId.value
  if (!sid) return
  vs.mutateActivity(sid, (list) => {
    list.unshift(makeEntry(type, message, detail, traceType))
  })
}

/** 清空日志（默认 active 会话；可显式传 sessionId） */
function clearLogs(sessionId?: string): void {
  const vs = useSessionViewState()
  const sid = sessionId ?? vs.activeSessionId.value
  if (!sid) return
  vs.mutateActivity(sid, (list) => { list.length = 0 })
}

/** active 会话的日志（切换会话自动跟随） */
const logs = computed(() => useSessionViewState().activeState.value?.activityLog ?? [])

export function useActivityLog() {
  return {
    logs,
    addLog,
    clearLogs,
  }
}
