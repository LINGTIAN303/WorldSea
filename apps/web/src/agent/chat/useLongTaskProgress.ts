/** useLongTaskProgress：长任务进度反馈（时长计时器 + 心跳提示），详细见 docs/details/注释/web/agent/chat/useLongTaskProgress.md */
import { ref, computed, watch, onUnmounted, type Ref } from 'vue'
import type { LongTaskRecord } from '../composables/longTaskStore'

type HeartbeatStatus = 'alive' | 'stale' | 'dead'

export interface UseLongTaskProgressOptions {
  /** 当前活跃长任务（来自 useAgent 的 activeTask，可能为 readonly） */
  activeTask: Readonly<Ref<LongTaskRecord | null>>
  /** 心跳状态（来自 useAgent 的 heartbeatStatus） */
  heartbeatStatus: Ref<HeartbeatStatus>
  /** 是否有活跃任务（来自 useAgent 的 hasActiveTask） */
  hasActiveTask: Ref<boolean>
}

export function useLongTaskProgress(options: UseLongTaskProgressOptions) {
  const { activeTask, heartbeatStatus, hasActiveTask } = options

  const longTaskNow = ref(Date.now())
  let longTaskTimer: ReturnType<typeof setInterval> | null = null

  const elapsedSec = computed(() =>
    activeTask.value ? Math.floor((longTaskNow.value - activeTask.value.startedAt) / 1000) : 0,
  )

  const heartbeatTitle = computed(() => {
    switch (heartbeatStatus.value) {
      case 'alive': return '心跳正常'
      case 'stale': return '心跳失联（>30s），可能卡顿'
      case 'dead': return '心跳停止（>5min），疑似崩溃'
      default: return '心跳状态'
    }
  })

  watch(hasActiveTask, (active) => {
    if (active) {
      longTaskNow.value = Date.now()
      if (!longTaskTimer) {
        longTaskTimer = setInterval(() => { longTaskNow.value = Date.now() }, 1000)
      }
    } else if (longTaskTimer) {
      clearInterval(longTaskTimer)
      longTaskTimer = null
    }
  }, { immediate: true })

  onUnmounted(() => {
    if (longTaskTimer) { clearInterval(longTaskTimer); longTaskTimer = null }
  })

  return {
    longTaskNow,
    elapsedSec,
    heartbeatTitle,
  }
}

/** 格式化已耗时（秒 → 1h2m / 2m3s / 3s） */
export function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

export type UseLongTaskProgressReturn = ReturnType<typeof useLongTaskProgress>
