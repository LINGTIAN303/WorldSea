/**
 * Tauri 端活动日志 composable（Phase D 迁入：活动日志面板依赖）
 * 与 web 端 space/composables/useActivityLog 同形：纯内存日志（模块级单例），零依赖。
 */
import { ref } from 'vue'

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

const MAX_LOG_ENTRIES = 200

const logs = ref<ActivityLogEntry[]>([])

let idCounter = 0

function addLog(type: ActivityLogEntry['type'], message: string, detail?: string, traceType?: string) {
  const entry: ActivityLogEntry = {
    id: `alog_${Date.now()}_${++idCounter}`,
    type,
    message,
    timestamp: Date.now(),
    detail,
    traceType,
  }
  logs.value = [entry, ...logs.value].slice(0, MAX_LOG_ENTRIES)
}

function clearLogs() {
  logs.value = []
}

export function useActivityLog() {
  return {
    logs,
    addLog,
    clearLogs,
  }
}
