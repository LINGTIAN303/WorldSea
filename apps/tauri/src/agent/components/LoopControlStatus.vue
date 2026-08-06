<script setup lang="ts">
/** LoopControlStatus：Loop Engineering 实时状态条（只读展示 + 2s 轮询），详细见 docs/details/注释/tauri/LoopControlStatus.md */
import { computed, watch, onBeforeUnmount } from 'vue'
import { useAgentRust } from '../composables/useAgentRust'
import { useLoopControlRust, type LoopControlEvent } from '../composables/useLoopControlRust'

const backend = useAgentRust()
const loopControl = useLoopControlRust()

/** 当前会话绑定的 loop_control 任务状态（`lc_{sessionId}`） */
const taskState = computed(() => {
  const sid = backend.currentSessionId.value
  if (!sid) return null
  return loopControl.tasks.get(`lc_${sid}`) ?? null
})

// ─── 状态轮询 ────────────────────────────────────────────
/** 轮询间隔：每 2s 刷新一次 getStatus（计数 + 触发状态） */
const POLL_MS = 2000
let timer: ReturnType<typeof setInterval> | null = null

async function poll(): Promise<void> {
  const st = taskState.value
  if (!st || !st.active) return
  try {
    await loopControl.getStatus(st.taskId)
  } catch {
    // 弱提示：轮询失败静默忽略（会话可能已切换/销毁）
  }
}

// 任务存在且活跃时启动轮询，否则停止
watch(
  taskState,
  (st) => {
    if (st?.active) {
      if (!timer) timer = setInterval(poll, POLL_MS)
      poll()
    } else {
      stopTimer()
    }
  },
  { immediate: true },
)

function stopTimer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onBeforeUnmount(stopTimer)

// ─── 派生展示数据 ────────────────────────────────────────────
/** 已运行时长（秒，来自 lastCheck 或 status 的 elapsedMs） */
const elapsedSecs = computed(() => {
  const st = taskState.value
  if (!st?.status) return 0
  return Math.round(st.status.elapsedMs / 1000)
})

/** 计数器（turns / toolCalls / tokens） */
const counters = computed(() => {
  const st = taskState.value
  const status = st?.status
  return [
    { label: '轮次', value: status?.turns ?? 0 },
    { label: '工具', value: status?.toolCalls ?? 0 },
    { label: 'Token', value: status?.tokens ?? 0 },
  ]
})

/** 最近事件（最多 4 条，时间倒序） */
const recentEvents = computed(() => {
  const st = taskState.value
  if (!st) return []
  return st.events.slice(-4).reverse()
})

/** 事件 → 徽标文案 + 样式类 */
function eventBadge(e: LoopControlEvent): { text: string; cls: string } {
  switch (e.type) {
    case 'loopEngRateLimitExceeded':
      return { text: `限流·${e.limitType} ${e.current}/${e.max}`, cls: 'rate' }
    case 'loopEngRetrying':
      return { text: `重试 ${e.attempt}/${e.maxRetries}`, cls: 'retry' }
    case 'loopEngRetryExhausted':
      return { text: '重试耗尽', cls: 'rate' }
    case 'loopEngSoftTimeoutWarning':
      return { text: '软超时提醒', cls: 'timeout' }
    case 'loopEngSoftTimeoutCritical':
      return { text: '软超时临界', cls: 'rate' }
    case 'loopEngWatchdogIdle':
      return { text: '看门狗空闲', cls: 'timeout' }
    case 'loopEngWatchdogDead':
      return { text: '看门狗失联', cls: 'rate' }
    case 'loopEngRecovered':
      return { text: '已恢复', cls: 'recovered' }
  }
}

/** 是否有活跃事件（用于决定是否高亮状态条） */
const hasAttention = computed(() => recentEvents.value.some((e) => e.type !== 'loopEngRecovered'))
</script>

<template>
  <div
    v-if="taskState"
    class="lcs"
    :class="{ hasAttention: hasAttention || !!taskState.lastError }"
    v-bind="{ title: `Loop Controller: ${taskState.taskId}` }"
  >
    <span class="lcs-label" title="Loop Engineering 运行状态">Loop</span>

    <span v-for="c in counters" :key="c.label" class="lcs-counter">
      {{ c.label }} <b>{{ c.value }}</b>
    </span>

    <span class="lcs-counter lcs-elapsed" title="已运行时长">
      耗时 <b>{{ elapsedSecs }}s</b>
    </span>

    <span v-if="taskState.lastError" class="lcs-badge rate" title="最近命令错误">
      {{ taskState.lastError }}
    </span>

    <span
      v-for="(e, i) in recentEvents"
      :key="i"
      class="lcs-badge"
      :class="eventBadge(e)?.cls"
      :title="eventBadge(e)?.text"
    >
      {{ eventBadge(e)?.text }}
    </span>
  </div>
</template>

<style scoped>
.lcs {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 20px;
  font-size: 12px;
  color: #666;
  background: #fafafa;
  border-bottom: 1px solid #e5e5e5;
  flex-wrap: wrap;
}
.lcs-label {
  font-weight: 600;
  color: #1a73e8;
  letter-spacing: 0.5px;
}
.lcs-counter b {
  color: #333;
  font-weight: 600;
}
.lcs-elapsed {
  color: #999;
}
.lcs-badge {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  white-space: nowrap;
}
.lcs-badge.rate {
  background: #fce8e6;
  color: #d93025;
}
.lcs-badge.retry {
  background: #fef7e0;
  color: #b06000;
}
.lcs-badge.timeout {
  background: #fef7e0;
  color: #e37400;
}
.lcs-badge.recovered {
  background: #e6f4ea;
  color: #188038;
}
.lcs.hasAttention {
  background: #fffdf5;
}
</style>