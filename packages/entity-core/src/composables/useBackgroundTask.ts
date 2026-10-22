/**
 * 后台任务注册表（R4）：>1s 才显示，同一时间只展示最近一个，多个合并为「+n」。
 * 放在 entity-core 是因为 fs watcher 等底层也需要登记；ui-kit 再转发导出。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
import { computed, ref } from 'vue'

export const BACKGROUND_TASK_DELAY_MS = 1000

interface BackgroundTaskRecord {
  id: number
  label: string
  visible: boolean
}

export interface BackgroundTaskHandle {
  done: () => void
  fail: (message?: unknown) => void
}

const tasks = ref<BackgroundTaskRecord[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 0

const visibleTasks = computed(() => tasks.value.filter(t => t.visible))
const active = computed(() => visibleTasks.value.length > 0)
const count = computed(() => visibleTasks.value.length)
const label = computed(() => {
  const latest = visibleTasks.value[visibleTasks.value.length - 1]
  if (!latest) return '后台处理中'
  return count.value > 1 ? `${latest.label} · +${count.value - 1}` : latest.label
})

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value) return value
  return '未知错误'
}

/** 登记一个后台任务；返回的句柄必须 done() 或 fail() 收尾 */
export function startBackgroundTask(
  labelText: string,
  options: { delay?: number } = {},
): BackgroundTaskHandle {
  const id = ++nextId
  const delay = Math.max(0, options.delay ?? BACKGROUND_TASK_DELAY_MS)
  const record: BackgroundTaskRecord = { id, label: labelText, visible: delay === 0 }
  tasks.value = [...tasks.value, record]

  if (delay > 0) {
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      const target = tasks.value.find(t => t.id === id)
      if (!target) return
      target.visible = true
      tasks.value = [...tasks.value]
    }, delay))
  }

  let settled = false
  function remove(): void {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  return {
    done() {
      if (settled) return
      settled = true
      remove()
    },
    fail(message) {
      if (settled) return
      settled = true
      remove()
      const detail = { label: labelText, message: messageOf(message) }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ws-background-failed', { detail }))
      }
    },
  }
}

export function useBackgroundTask() {
  return { active, count, label, start: startBackgroundTask }
}
