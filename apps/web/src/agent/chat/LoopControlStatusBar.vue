<template>
  <!--
    # LoopControlStatusBar — Loop Engineering 状态面板

    阶段 2.6 批次4 新增。显示当前 Loop Control 任务的运行状态、计数器、
    触发告警与事件历史。与 LongTaskProgressBar 并列显示（在其下方）。

    ## UI 结构
    - 紧凑视图（默认）：状态点 + 摘要 + 展开按钮
    - Popover 浮层：配置摘要 + 计数器详情 + 触发状态 + 事件历史

    ## 颜色映射
    - normal（绿）：无任何触发
    - warning（黄）：soft_timeout_warning / watchdog_idle / retrying
    - critical（红）：rate_limit_exceeded / soft_timeout_critical / watchdog_dead / retry_exhausted

    ## 生命周期
    本组件不负责 create/destroy，由父组件（AgentChat.vue）通过 `taskId` prop 控制。
    当 taskId 非空时显示，为空时隐藏。组件内部只负责：
    - 订阅事件（实时更新状态）
    - 提供"检查"按钮（手动触发 check）
    - 提供"刷新状态"按钮（手动触发 getStatus）
  -->
  <div v-if="taskId && taskState" class="loop-control-status-bar" :class="`lc-level-${level}`">
    <!-- 紧凑视图 -->
    <button
      class="lc-summary-btn"
      :title="summaryTitle"
      @click="togglePopover"
    >
      <span class="lc-dot" :class="`lc-dot-${level}`"></span>
      <WsIcon name="shield" size="xs" class="lc-icon" />
      <span class="lc-label">Loop</span>
      <span class="lc-summary">{{ summaryText }}</span>
      <!-- 触发计数徽章（仅当有触发时显示） -->
      <span v-if="totalTriggerCount > 0" class="lc-badge">{{ totalTriggerCount }}</span>
      <WsIcon
        :name="popoverOpen ? 'chevron-down' : 'chevron-right'"
        size="xs"
        class="lc-expand-icon"
      />
    </button>

    <!-- 手动检查按钮 -->
    <button
      class="lc-check-btn"
      title="手动触发一站式检查（rate_limit / soft_timeout / watchdog）"
      :disabled="checking"
      @click="onManualCheck"
    >
      <WsIcon :name="checking ? 'loading' : 'refresh'" size="xs" />
    </button>

    <!-- Popover 浮层 -->
    <div v-if="popoverOpen" class="lc-popover" @click.stop>
      <div class="lc-popover-header">
        <span class="lc-popover-title">Loop Control 详情</span>
        <button class="lc-popover-close" @click="popoverOpen = false" title="关闭">
          <WsIcon name="x" size="xs" />
        </button>
      </div>

      <div class="lc-popover-body">
        <!-- 任务基本信息 -->
        <section class="lc-section">
          <div class="lc-section-title">任务</div>
          <div class="lc-task-id" :title="taskId">{{ shortTaskId }}</div>
          <div class="lc-task-meta">
            <span>创建于 {{ formatTime(taskState.createdAt) }}</span>
            <span v-if="taskState.config">·</span>
            <span v-if="taskState.config">自定义配置</span>
            <span v-else>·</span>
            <span v-if="!taskState.config">默认配置</span>
          </div>
        </section>

        <!-- 计数器 -->
        <section class="lc-section">
          <div class="lc-section-title">计数器</div>
          <div class="lc-counter-grid">
            <div class="lc-counter-item">
              <span class="lc-counter-label">轮次</span>
              <span class="lc-counter-value">{{ status?.turns ?? 0 }}</span>
              <span
                v-if="taskState.config?.rateLimit.maxTurns"
                class="lc-counter-max"
              >/ {{ taskState.config.rateLimit.maxTurns }}</span>
            </div>
            <div class="lc-counter-item">
              <span class="lc-counter-label">工具调用</span>
              <span class="lc-counter-value">{{ status?.toolCalls ?? 0 }}</span>
              <span
                v-if="taskState.config?.rateLimit.maxToolCalls"
                class="lc-counter-max"
              >/ {{ taskState.config.rateLimit.maxToolCalls }}</span>
            </div>
            <div class="lc-counter-item">
              <span class="lc-counter-label">Tokens</span>
              <span class="lc-counter-value">{{ status?.tokens ?? 0 }}</span>
              <span
                v-if="taskState.config?.rateLimit.maxTokens"
                class="lc-counter-max"
              >/ {{ formatTokenMax(taskState.config.rateLimit.maxTokens) }}</span>
            </div>
            <div class="lc-counter-item">
              <span class="lc-counter-label">已运行</span>
              <span class="lc-counter-value">{{ formatElapsedMs(status?.elapsedMs ?? 0) }}</span>
            </div>
          </div>
        </section>

        <!-- 触发状态 -->
        <section v-if="hasTriggers" class="lc-section">
          <div class="lc-section-title">触发状态</div>
          <div class="lc-trigger-list">
            <div
              v-if="status?.rateLimitExceeded"
              class="lc-trigger-item lc-trigger-critical"
            >
              <WsIcon name="alert" size="xs" class="lc-trigger-icon" />
              <span>速率限制超限: {{ formatRateLimit(status.rateLimitExceeded) }}</span>
            </div>
            <div
              v-if="status?.softTimeoutLevel"
              class="lc-trigger-item"
              :class="status.softTimeoutLevel === 'critical' ? 'lc-trigger-critical' : 'lc-trigger-warning'"
            >
              <WsIcon name="clock" size="xs" class="lc-trigger-icon" />
              <span>软超时 {{ status.softTimeoutLevel === 'critical' ? '临界' : '警告' }}</span>
            </div>
            <div
              v-if="status?.watchdogAlert"
              class="lc-trigger-item"
              :class="status.watchdogAlert.level === 'dead' ? 'lc-trigger-critical' : 'lc-trigger-warning'"
            >
              <WsIcon name="bell" size="xs" class="lc-trigger-icon" />
              <span>看门狗 {{ status.watchdogAlert.level === 'dead' ? '死亡' : '空闲' }}</span>
            </div>
          </div>
        </section>

        <!-- 触发统计 -->
        <section v-if="totalTriggerCount > 0" class="lc-section">
          <div class="lc-section-title">触发统计</div>
          <div class="lc-stat-grid">
            <div v-if="taskState.rateLimitTriggerCount > 0" class="lc-stat-item lc-stat-critical">
              <WsIcon name="alert" size="xs" />
              <span>速率限制 ×{{ taskState.rateLimitTriggerCount }}</span>
            </div>
            <div v-if="taskState.retryCount > 0" class="lc-stat-item lc-stat-warning">
              <WsIcon name="refresh" size="xs" />
              <span>重试 ×{{ taskState.retryCount }}</span>
            </div>
            <div v-if="taskState.retryExhaustedCount > 0" class="lc-stat-item lc-stat-critical">
              <WsIcon name="alert" size="xs" />
              <span>重试耗尽 ×{{ taskState.retryExhaustedCount }}</span>
            </div>
            <div v-if="taskState.softTimeoutWarningCount > 0" class="lc-stat-item lc-stat-warning">
              <WsIcon name="clock" size="xs" />
              <span>软超时警告 ×{{ taskState.softTimeoutWarningCount }}</span>
            </div>
            <div v-if="taskState.softTimeoutCriticalCount > 0" class="lc-stat-item lc-stat-critical">
              <WsIcon name="clock" size="xs" />
              <span>软超时临界 ×{{ taskState.softTimeoutCriticalCount }}</span>
            </div>
            <div v-if="taskState.watchdogIdleCount > 0" class="lc-stat-item lc-stat-warning">
              <WsIcon name="bell" size="xs" />
              <span>看门狗空闲 ×{{ taskState.watchdogIdleCount }}</span>
            </div>
            <div v-if="taskState.watchdogDeadCount > 0" class="lc-stat-item lc-stat-critical">
              <WsIcon name="bell" size="xs" />
              <span>看门狗死亡 ×{{ taskState.watchdogDeadCount }}</span>
            </div>
            <div v-if="taskState.recoveredCount > 0" class="lc-stat-item lc-stat-recovery">
              <WsIcon name="zap" size="xs" />
              <span>已恢复 ×{{ taskState.recoveredCount }}</span>
            </div>
          </div>
        </section>

        <!-- 事件历史 -->
        <section class="lc-section">
          <div class="lc-section-title">
            事件历史
            <span class="lc-section-meta">（{{ taskState.events.length }} 条）</span>
          </div>
          <div v-if="taskState.events.length === 0" class="lc-empty">暂无事件</div>
          <div v-else class="lc-event-list">
            <div
              v-for="(evt, idx) in recentEvents"
              :key="idx"
              class="lc-event-item"
              :class="`lc-event-${getEventLevel(evt.type)}`"
            >
              <WsIcon :name="getEventIcon(evt.type)" size="xs" class="lc-event-icon" />
              <span class="lc-event-text">{{ formatEvent(evt) }}</span>
            </div>
            <div
              v-if="taskState.events.length > recentEvents.length"
              class="lc-event-more"
            >... 还有 {{ taskState.events.length - recentEvents.length }} 条</div>
          </div>
        </section>

        <!-- 错误信息 -->
        <section v-if="taskState.lastError" class="lc-section lc-section-error">
          <div class="lc-section-title">最近错误</div>
          <div class="lc-error-text">{{ taskState.lastError }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useLoopControlRust, type LoopControlEvent, type RustRateLimitExceeded } from '../composables/useLoopControlRust'

const props = defineProps<{
  /**
   * Loop Control 任务 ID
   *
   * 由父组件管理生命周期（create/destroy）。
   * 当 taskId 非空且对应任务存在于 useLoopControlRust().tasks 时显示。
   */
  taskId: string | null
}>()

const {
  tasks,
  check,
  getStatus,
  subscribe,
} = useLoopControlRust()

/** Popover 展开/收起状态 */
const popoverOpen = ref(false)

/** 手动检查中标志 */
const checking = ref(false)

/** 强制刷新触发器（事件订阅时自增，驱动 computed 重新计算） */
const refreshTick = ref(0)

/** 当前任务状态（响应式，来自模块级 Map） */
const taskState = computed(() => {
  // 引用 refreshTick 让 computed 在事件回调时重新计算
  void refreshTick.value
  if (!props.taskId) return null
  return tasks.value.get(props.taskId) ?? null
})

/** 最近一次 status 快照（来自 getStatus 或 check 返回的 lastCheck） */
const status = computed(() => taskState.value?.status ?? null)

/** 综合告警级别：normal / warning / critical */
const level = computed<'normal' | 'warning' | 'critical'>(() => {
  const s = status.value
  if (!s) return 'normal'
  if (s.rateLimitExceeded) return 'critical'
  if (s.watchdogAlert?.level === 'dead') return 'critical'
  if (s.softTimeoutLevel === 'critical') return 'critical'
  if (s.softTimeoutLevel === 'warning') return 'warning'
  if (s.watchdogAlert?.level === 'idle') return 'warning'
  return 'normal'
})

/** 是否有任何触发状态 */
const hasTriggers = computed(() => {
  const s = status.value
  if (!s) return false
  return !!(s.rateLimitExceeded || s.softTimeoutLevel || s.watchdogAlert)
})

/** 触发总数（用于徽章显示） */
const totalTriggerCount = computed(() => {
  const t = taskState.value
  if (!t) return 0
  return (
    t.rateLimitTriggerCount +
    t.retryCount +
    t.retryExhaustedCount +
    t.softTimeoutWarningCount +
    t.softTimeoutCriticalCount +
    t.watchdogIdleCount +
    t.watchdogDeadCount
  )
})

/** 紧凑视图摘要文本 */
const summaryText = computed(() => {
  const s = status.value
  if (!s) return '初始化中'
  const parts: string[] = []
  parts.push(`${s.turns} 轮`)
  parts.push(`${s.toolCalls} 工具`)
  if (s.tokens > 0) {
    parts.push(formatTokenShort(s.tokens))
  }
  parts.push(formatElapsedMs(s.elapsedMs))
  return parts.join(' · ')
})

/** 摘要 title（hover 时显示完整信息） */
const summaryTitle = computed(() => {
  const s = status.value
  if (!s) return 'Loop Control 状态加载中'
  const lines = [
    `任务: ${props.taskId}`,
    `轮次: ${s.turns}`,
    `工具调用: ${s.toolCalls}`,
    `Tokens: ${s.tokens}`,
    `已运行: ${formatElapsedMs(s.elapsedMs)}`,
  ]
  if (s.rateLimitExceeded) lines.push(`速率限制: ${formatRateLimit(s.rateLimitExceeded)}`)
  if (s.softTimeoutLevel) lines.push(`软超时: ${s.softTimeoutLevel}`)
  if (s.watchdogAlert) lines.push(`看门狗: ${s.watchdogAlert.level}`)
  return lines.join('\n')
})

/** 短任务 ID（仅显示前 16 字符 + ...） */
const shortTaskId = computed(() => {
  if (!props.taskId) return ''
  return props.taskId.length > 20
    ? `${props.taskId.slice(0, 8)}...${props.taskId.slice(-8)}`
    : props.taskId
})

/** 最近 50 条事件（倒序，最新在前） */
const recentEvents = computed(() => {
  const t = taskState.value
  if (!t) return []
  return t.events.slice(-50).reverse()
})

// ─── 事件订阅 ────────────────────────────────────────────

let unsubscribe: (() => void) | null = null

watch(
  () => props.taskId,
  (newId, _oldId) => {
    // 清理旧订阅
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    // 关闭 Popover（切换任务时）
    popoverOpen.value = false
    // 注册新订阅
    if (newId) {
      unsubscribe = subscribe(newId, () => {
        // 事件到达时自增 tick，驱动 computed 重新计算
        refreshTick.value += 1
      })
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})

// ─── 手动操作 ────────────────────────────────────────────

async function onManualCheck(): Promise<void> {
  if (!props.taskId || checking.value) return
  checking.value = true
  try {
    await check(props.taskId)
    // 同步刷新 status 快照
    await getStatus(props.taskId)
  } catch (err) {
    console.error('[LoopControlStatusBar] 手动检查失败:', err)
  } finally {
    checking.value = false
  }
}

function togglePopover(): void {
  popoverOpen.value = !popoverOpen.value
  // 打开 Popover 时刷新一次状态
  if (popoverOpen.value && props.taskId) {
    getStatus(props.taskId).catch(() => {})
  }
}

// ─── 格式化工具 ────────────────────────────────────────────

function formatElapsedMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

function formatTokenShort(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tokens`
  return `${n} tokens`
}

function formatTokenMax(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)}k`
  return String(n)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatRateLimit(rl: RustRateLimitExceeded): string {
  switch (rl.type) {
    case 'turns': return `轮次 ${rl.current}/${rl.max}`
    case 'tool_calls': return `工具调用 ${rl.current}/${rl.max}`
    case 'tokens': return `Tokens ${rl.current}/${rl.max}`
    case 'duration': return `时长 ${rl.current.secs}s/${rl.max.secs}s`
  }
}

function getEventLevel(type: LoopControlEvent['type']): 'normal' | 'warning' | 'critical' | 'recovery' {
  switch (type) {
    case 'loopEngRateLimitExceeded':
    case 'loopEngRetryExhausted':
    case 'loopEngSoftTimeoutCritical':
    case 'loopEngWatchdogDead':
      return 'critical'
    case 'loopEngRetrying':
    case 'loopEngSoftTimeoutWarning':
    case 'loopEngWatchdogIdle':
      return 'warning'
    case 'loopEngRecovered':
      return 'recovery'
    default:
      return 'normal'
  }
}

function getEventIcon(type: LoopControlEvent['type']): string {
  switch (type) {
    case 'loopEngRateLimitExceeded': return 'alert'
    case 'loopEngRetrying': return 'refresh'
    case 'loopEngRetryExhausted': return 'alert'
    case 'loopEngSoftTimeoutWarning': return 'clock'
    case 'loopEngSoftTimeoutCritical': return 'clock'
    case 'loopEngWatchdogIdle': return 'bell'
    case 'loopEngWatchdogDead': return 'bell'
    case 'loopEngRecovered': return 'zap'
    default: return 'info'
  }
}

function formatEvent(evt: LoopControlEvent): string {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  switch (evt.type) {
    case 'loopEngRateLimitExceeded':
      return `[${time}] 速率限制: ${evt.limitType} (${evt.current}/${evt.max})`
    case 'loopEngRetrying':
      return `[${time}] 重试 ${evt.attempt}/${evt.maxRetries} (退避 ${evt.backoffMs}ms): ${evt.error}`
    case 'loopEngRetryExhausted':
      return `[${time}] 重试耗尽: 共 ${evt.totalAttempts} 次, 最终错误: ${evt.finalError}`
    case 'loopEngSoftTimeoutWarning':
      return `[${time}] 软超时警告: ${evt.elapsedSecs}s > ${evt.thresholdSecs}s`
    case 'loopEngSoftTimeoutCritical':
      return `[${time}] 软超时临界: ${evt.elapsedSecs}s > ${evt.thresholdSecs}s`
    case 'loopEngWatchdogIdle':
      return `[${time}] 看门狗空闲: ${evt.idleSecs}s (最后活动 ${evt.lastActivity})`
    case 'loopEngWatchdogDead':
      return `[${time}] 看门狗死亡: ${evt.idleSecs}s (最后活动 ${evt.lastActivity})`
    case 'loopEngRecovered':
      return `[${time}] 已恢复: 第 ${evt.turnCount} 轮, 方法 ${evt.recoveryMethod}`
    default:
      return JSON.stringify(evt)
  }
}
</script>

<style scoped>
/* LoopControlStatusBar：Loop Engineering 状态面板（紧凑 + Popover） */
.loop-control-status-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: rgba(59, 130, 246, 0.06);
  border-top: 1px solid rgba(59, 130, 246, 0.15);
  font-size: 11px;
  color: rgba(219, 234, 254, 0.85);
  flex-shrink: 0;
}

/* 告警级别背景色 */
.lc-level-warning {
  background: rgba(251, 191, 36, 0.08);
  border-top-color: rgba(251, 191, 36, 0.25);
  color: rgba(254, 243, 199, 0.9);
}
.lc-level-critical {
  background: rgba(248, 113, 113, 0.1);
  border-top-color: rgba(248, 113, 113, 0.3);
  color: rgba(254, 226, 226, 0.9);
}

/* 紧凑视图按钮 */
.lc-summary-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: inherit;
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
}
.lc-summary-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* 状态指示点 */
.lc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.lc-dot-normal {
  background: rgb(96, 165, 250);
  box-shadow: 0 0 4px rgba(96, 165, 250, 0.5);
}
.lc-dot-warning {
  background: rgb(251, 191, 36);
  animation: lc-blink 2s ease-in-out infinite;
}
.lc-dot-critical {
  background: rgb(248, 113, 113);
  animation: lc-blink 1s ease-in-out infinite;
}
@keyframes lc-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.lc-icon {
  color: rgba(147, 197, 253, 0.7);
}
.lc-level-warning .lc-icon { color: rgba(252, 211, 77, 0.8); }
.lc-level-critical .lc-icon { color: rgba(252, 165, 165, 0.85); }

.lc-label {
  font-weight: 600;
  color: rgb(147, 197, 253);
}
.lc-level-warning .lc-label { color: rgb(252, 211, 77); }
.lc-level-critical .lc-label { color: rgb(252, 165, 165); }

.lc-summary {
  font-variant-numeric: tabular-nums;
  color: rgba(219, 234, 254, 0.85);
}
.lc-level-warning .lc-summary { color: rgba(254, 243, 199, 0.9); }
.lc-level-critical .lc-summary { color: rgba(254, 226, 226, 0.9); }

/* 触发计数徽章 */
.lc-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: rgba(248, 113, 113, 0.8);
  color: rgb(254, 242, 242);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.lc-expand-icon {
  color: rgba(147, 197, 253, 0.5);
  transition: transform 0.15s;
}

/* 手动检查按钮 */
.lc-check-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: rgba(147, 197, 253, 0.6);
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
}
.lc-check-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(147, 197, 253, 0.9);
}
.lc-check-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Popover 浮层 */
.lc-popover {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 12px;
  right: 12px;
  max-width: 480px;
  min-width: 360px;
  max-height: 60vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: rgb(17, 24, 39);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: 6px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  z-index: 100;
  font-size: 11px;
  color: rgba(229, 231, 235, 0.9);
}

.lc-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  background: rgba(31, 41, 55, 0.6);
}
.lc-popover-title {
  font-weight: 600;
  color: rgb(199, 210, 254);
}
.lc-popover-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: rgba(156, 163, 175, 0.7);
  cursor: pointer;
  border-radius: 3px;
}
.lc-popover-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgb(248, 113, 113);
}

.lc-popover-body {
  overflow-y: auto;
  padding: 8px 12px;
}

.lc-section {
  padding: 6px 0;
  border-bottom: 1px solid rgba(75, 85, 99, 0.2);
}
.lc-section:last-child {
  border-bottom: none;
}
.lc-section-title {
  font-size: 10px;
  font-weight: 600;
  color: rgba(156, 163, 175, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.lc-section-meta {
  font-weight: 400;
  text-transform: none;
  color: rgba(156, 163, 175, 0.6);
}

.lc-task-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 10px;
  color: rgba(199, 210, 254, 0.85);
  word-break: break-all;
}
.lc-task-meta {
  display: flex;
  gap: 4px;
  margin-top: 2px;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.7);
}

/* 计数器网格 */
.lc-counter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 12px;
}
.lc-counter-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.lc-counter-label {
  color: rgba(156, 163, 175, 0.8);
  min-width: 48px;
}
.lc-counter-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: rgb(229, 231, 235);
}
.lc-counter-max {
  color: rgba(156, 163, 175, 0.6);
  font-size: 10px;
}

/* 触发状态列表 */
.lc-trigger-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lc-trigger-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.lc-trigger-warning {
  background: rgba(251, 191, 36, 0.1);
  color: rgb(252, 211, 77);
}
.lc-trigger-critical {
  background: rgba(248, 113, 113, 0.12);
  color: rgb(252, 165, 165);
}
.lc-trigger-icon {
  flex-shrink: 0;
}

/* 触发统计网格 */
.lc-stat-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.lc-stat-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.lc-stat-warning {
  background: rgba(251, 191, 36, 0.1);
  color: rgb(252, 211, 77);
}
.lc-stat-critical {
  background: rgba(248, 113, 113, 0.12);
  color: rgb(252, 165, 165);
}
.lc-stat-recovery {
  background: rgba(52, 211, 153, 0.1);
  color: rgb(110, 231, 183);
}

/* 事件历史列表 */
.lc-event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.lc-event-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  line-height: 1.4;
}
.lc-event-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
.lc-event-text {
  word-break: break-all;
  color: rgba(229, 231, 235, 0.85);
}
.lc-event-warning .lc-event-icon { color: rgb(252, 211, 77); }
.lc-event-critical .lc-event-icon { color: rgb(252, 165, 165); }
.lc-event-recovery .lc-event-icon { color: rgb(110, 231, 183); }
.lc-event-normal .lc-event-icon { color: rgba(147, 197, 253, 0.7); }

.lc-event-more {
  padding: 4px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.lc-empty {
  padding: 8px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

/* 错误信息 */
.lc-section-error {
  background: rgba(248, 113, 113, 0.05);
  margin: 4px -12px;
  padding: 6px 12px;
}
.lc-error-text {
  font-size: 10px;
  color: rgb(252, 165, 165);
  word-break: break-all;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
</style>
