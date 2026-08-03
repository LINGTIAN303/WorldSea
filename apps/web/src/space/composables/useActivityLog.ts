import { ref } from 'vue'

export interface ActivityLogEntry {
  id: string
  type: 'info' | 'tool' | 'knowledge' | 'memory' | 'error'
  message: string
  timestamp: number
  detail?: string
}

const MAX_LOG_ENTRIES = 200

const logs = ref<ActivityLogEntry[]>([])

let idCounter = 0

function addLog(type: ActivityLogEntry['type'], message: string, detail?: string) {
  const entry: ActivityLogEntry = {
    id: `alog_${Date.now()}_${++idCounter}`,
    type,
    message,
    timestamp: Date.now(),
    detail,
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
