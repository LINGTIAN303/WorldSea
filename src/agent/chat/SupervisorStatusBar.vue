<template>
  <div v-if="sessionId && sessionState" class="sup-status-bar" :class="`sup-level-${level}`">
    <!-- 紧凑视图 -->
    <button
      class="sup-summary-btn"
      :title="summaryTitle"
      @click="togglePopover"
    >
      <span class="sup-dot" :class="`sup-dot-${level}`"></span>
      <WsIcon name="workflow" size="xs" class="sup-icon" />
      <span class="sup-label">SUP</span>
      <span class="sup-summary">{{ summaryText }}</span>
      <!-- 子 Agent 名称徽章 -->
      <span v-if="sessionState.assignedSubAgentName" class="sup-badge">
        {{ sessionState.assignedSubAgentName }}
      </span>
      <WsIcon
        :name="popoverOpen ? 'chevron-down' : 'chevron-right'"
        size="xs"
        class="sup-expand-icon"
      />
    </button>

    <!-- 中断按钮（仅 running 时显示） -->
    <button
      v-if="sessionState.runStatus === 'running'"
      class="sup-action-btn"
      title="中断当前 Supervisor 协作（协作式，需等当前子 Agent 执行完成）"
      :disabled="aborting"
      @click="onAbort"
    >
      <WsIcon :name="aborting ? 'loading' : 'x'" size="xs" />
    </button>

    <!-- 刷新状态按钮 -->
    <button
      class="sup-action-btn"
      title="手动刷新编排状态快照"
      :disabled="refreshing"
      @click="onRefreshState"
    >
      <WsIcon :name="refreshing ? 'loading' : 'refresh'" size="xs" />
    </button>

    <!-- Popover 浮层 -->
    <div v-if="popoverOpen" class="sup-popover" @click.stop>
      <div class="sup-popover-header">
        <span class="sup-popover-title">Supervisor 编排详情</span>
        <button class="sup-popover-close" @click="popoverOpen = false" title="关闭">
          <WsIcon name="x" size="xs" />
        </button>
      </div>

      <div class="sup-popover-body">
        <!-- 任务基本信息 -->
        <section class="sup-section">
          <div class="sup-section-title">任务</div>
          <div class="sup-task-id" :title="sessionId">{{ shortSessionId }}</div>
          <div v-if="sessionState.currentTask" class="sup-task-text">
            {{ sessionState.currentTask }}
          </div>
        </section>

        <!-- 编排进度 -->
        <section class="sup-section">
          <div class="sup-section-title">编排进度</div>
          <div class="sup-counter-grid">
            <div class="sup-counter-item">
              <span class="sup-counter-label">状态</span>
              <span class="sup-counter-value" :class="`sup-status-${sessionState.runStatus}`">
                {{ formatRunStatus(sessionState.runStatus) }}
              </span>
            </div>
            <div class="sup-counter-item">
              <span class="sup-counter-label">子 Agent</span>
              <span class="sup-counter-value">
                {{ sessionState.assignedSubAgentName ?? '—' }}
              </span>
            </div>
            <div class="sup-counter-item">
              <span class="sup-counter-label">输出字符</span>
              <span class="sup-counter-value">
                {{ sessionState.subAgentOutputChars ?? '—' }}
              </span>
            </div>
            <div class="sup-counter-item">
              <span class="sup-counter-label">执行耗时</span>
              <span class="sup-counter-value">{{ formattedDuration }}</span>
            </div>
          </div>
        </section>

        <!-- 任务分配原因（若 LLM 提供了 reasoning） -->
        <section
          v-if="assignmentReasoning"
          class="sup-section sup-section-reasoning"
        >
          <div class="sup-section-title">分配理由</div>
          <div class="sup-reasoning-text">{{ assignmentReasoning }}</div>
        </section>

        <!-- 最终摘要（runStatus=done 且 lastResult.summary 存在时显示） -->
        <section v-if="finalSummary" class="sup-section sup-section-summary">
          <div class="sup-section-title">最终摘要</div>
          <div class="sup-summary-content">{{ finalSummary }}</div>
        </section>

        <!-- 编排消息历史（stateSnapshot.messages，最近 5 条） -->
        <section v-if="recentMessages.length > 0" class="sup-section">
          <div class="sup-section-title">
            编排消息
            <span class="sup-section-meta">
              ({{ totalMessages }} 条，最近 {{ recentMessages.length }} 条)
            </span>
          </div>
          <div class="sup-message-list">
            <div
              v-for="(msg, idx) in recentMessages"
              :key="idx"
              class="sup-message-item"
              :class="`sup-msg-${msg.role}`"
            >
              <span class="sup-msg-role">{{ formatMessageRole(msg.role) }}</span>
              <span class="sup-msg-content">{{ truncate(msg.content, 200) }}</span>
            </div>
          </div>
        </section>

        <!-- 事件历史 -->
        <section class="sup-section">
          <div class="sup-section-title">
            事件历史
            <span class="sup-section-meta">({{ sessionState.events.length }} 条)</span>
          </div>
          <div v-if="sessionState.events.length === 0" class="sup-empty">暂无事件</div>
          <div v-else class="sup-event-list">
            <div
              v-for="(evt, idx) in recentEvents"
              :key="idx"
              class="sup-event-item"
              :class="`sup-event-${getEventLevel(evt.type)}`"
            >
              <WsIcon :name="getEventIcon(evt.type)" size="xs" class="sup-event-icon" />
              <span class="sup-event-text">{{ formatEvent(evt) }}</span>
            </div>
            <div
              v-if="sessionState.events.length > recentEvents.length"
              class="sup-event-more"
            >... 还有 {{ sessionState.events.length - recentEvents.length }} 条</div>
          </div>
        </section>

        <!-- 错误信息 -->
        <section v-if="sessionState.lastError" class="sup-section sup-section-error">
          <div class="sup-section-title">
            最近错误
            <span v-if="sessionState.assignedSubAgentName" class="sup-section-meta">
              (子 Agent: {{ sessionState.assignedSubAgentName }})
            </span>
          </div>
          <div class="sup-error-text">{{ sessionState.lastError }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useSupervisorRust, type SupervisorEvent } from '../composables/useSupervisorRust'

const props = defineProps<{
  /**
   * Supervisor 会话 ID
   *
   * 由父组件管理生命周期（create/destroy）。
   * 当 sessionId 非空且对应会话存在于 useSupervisorRust().sessions 时显示。
   */
  sessionId: string | null
}>()

const {
  sessions,
  abort: abortSession,
  getState,
  subscribe,
} = useSupervisorRust()

/** Popover 展开/收起状态 */
const popoverOpen = ref(false)

/** 中断中标志 */
const aborting = ref(false)

/** 刷新状态中标志 */
const refreshing = ref(false)

/** 强制刷新触发器（事件订阅时自增，驱动 computed 重新计算） */
const refreshTick = ref(0)

/** 当前会话状态（响应式，来自模块级 Map） */
const sessionState = computed(() => {
  void refreshTick.value
  if (!props.sessionId) return null
  return sessions.value.get(props.sessionId) ?? null
})

/** 综合级别：idle / running / done / aborted / error（对应 runStatus） */
const level = computed<'idle' | 'running' | 'done' | 'aborted' | 'error'>(() => {
  return sessionState.value?.runStatus ?? 'idle'
})

/** 紧凑视图摘要文本 */
const summaryText = computed(() => {
  const s = sessionState.value
  if (!s) return '初始化中'
  const parts: string[] = []
  if (s.assignedSubAgentName) parts.push(s.assignedSubAgentName)
  if (s.runStatus === 'running') {
    parts.push('执行中')
  } else if (s.runStatus === 'done') {
    parts.push('已完成')
  } else if (s.runStatus === 'aborted') {
    parts.push('已中断')
  } else if (s.runStatus === 'error') {
    parts.push('出错')
  } else {
    parts.push('空闲')
  }
  return parts.join(' · ')
})

/** 摘要 title（hover 时显示完整信息） */
const summaryTitle = computed(() => {
  const s = sessionState.value
  if (!s) return 'Supervisor 状态加载中'
  const lines = [
    `会话: ${props.sessionId}`,
    `状态: ${formatRunStatus(s.runStatus)}`,
  ]
  if (s.assignedSubAgentName) lines.push(`子 Agent: ${s.assignedSubAgentName}`)
  if (s.subAgentOutputChars !== null) lines.push(`输出字符: ${s.subAgentOutputChars}`)
  if (s.subAgentDurationMs !== null) lines.push(`执行耗时: ${(s.subAgentDurationMs / 1000).toFixed(2)}s`)
  if (s.lastResult?.summary) lines.push(`摘要: ${s.lastResult.summary}`)
  if (s.lastError) lines.push(`错误: ${s.lastError}`)
  return lines.join('\n')
})

/** 短会话 ID（sup_{timestamp}_{random} → sup_..._random） */
const shortSessionId = computed(() => {
  if (!props.sessionId) return ''
  const sid = props.sessionId
  if (sid.length <= 24) return sid
  return `${sid.slice(0, 10)}...${sid.slice(-8)}`
})

/** 子 Agent 执行耗时（格式化为秒） */
const formattedDuration = computed(() => {
  const s = sessionState.value
  if (!s || s.subAgentDurationMs === null) return '—'
  return `${(s.subAgentDurationMs / 1000).toFixed(2)}s`
})

/** 任务分配理由（从事件历史中找最近一条 supervisorTaskAssigned 的 reasoning） */
const assignmentReasoning = computed(() => {
  const s = sessionState.value
  if (!s) return null
  for (let i = s.events.length - 1; i >= 0; i--) {
    const evt = s.events[i]
    if (evt.type === 'supervisorTaskAssigned' && evt.reasoning) {
      return evt.reasoning
    }
  }
  return null
})

/** 最终摘要（runStatus=done 且 lastResult.summary 存在时） */
const finalSummary = computed(() => {
  const s = sessionState.value
  if (!s || s.runStatus !== 'done') return null
  return s.lastResult?.summary ?? null
})

/** 编排消息历史快照（从 stateSnapshot 读取） */
const recentMessages = computed(() => {
  const s = sessionState.value
  if (!s?.stateSnapshot?.messages) return []
  return s.stateSnapshot.messages.slice(-5)
})

const totalMessages = computed(() => {
  return sessionState.value?.stateSnapshot?.messages.length ?? 0
})

/** 最近 50 条事件（倒序，最新在前） */
const recentEvents = computed(() => {
  const s = sessionState.value
  if (!s) return []
  return s.events.slice(-50).reverse()
})

// ─── 事件订阅 ────────────────────────────────────────────

let unsubscribe: (() => void) | null = null

watch(
  () => props.sessionId,
  (newId, oldId) => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    popoverOpen.value = false
    if (newId) {
      unsubscribe = subscribe(newId, () => {
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

async function onAbort(): Promise<void> {
  if (!props.sessionId || aborting.value) return
  aborting.value = true
  try {
    await abortSession(props.sessionId)
  } catch (err) {
    console.error('[SupervisorStatusBar] 中断失败:', err)
  } finally {
    aborting.value = false
  }
}

async function onRefreshState(): Promise<void> {
  if (!props.sessionId || refreshing.value) return
  refreshing.value = true
  try {
    await getState(props.sessionId)
    refreshTick.value += 1
  } catch (err) {
    console.error('[SupervisorStatusBar] 刷新状态失败:', err)
  } finally {
    refreshing.value = false
  }
}

function togglePopover(): void {
  popoverOpen.value = !popoverOpen.value
  if (popoverOpen.value && props.sessionId) {
    getState(props.sessionId).catch(() => {})
  }
}

// ─── 格式化工具 ────────────────────────────────────────────

function formatRunStatus(status: string): string {
  switch (status) {
    case 'idle': return '空闲'
    case 'running': return '执行中'
    case 'done': return '已完成'
    case 'aborted': return '已中断'
    case 'error': return '出错'
    default: return status
  }
}

function formatMessageRole(role: string): string {
  switch (role) {
    case 'user': return '用户'
    case 'assistant': return '助手'
    case 'tool_result': return '工具'
    case 'system': return '系统'
    default: return role
  }
}

function getEventLevel(type: SupervisorEvent['type']): 'normal' | 'info' | 'success' | 'warning' | 'critical' {
  switch (type) {
    case 'subAgentCompleted':
      return 'success'
    case 'subAgentError':
    case 'supervisorError':
      return 'critical'
    case 'supervisorTaskAssigned':
      return 'info'
    case 'subAgentStarted':
    default:
      return 'normal'
  }
}

function getEventIcon(type: SupervisorEvent['type']): string {
  switch (type) {
    case 'supervisorTaskAssigned': return 'workflow'
    case 'subAgentStarted': return 'play'
    case 'subAgentCompleted': return 'check-circle'
    case 'subAgentError': return 'alert'
    case 'supervisorError': return 'alert'
    default: return 'info'
  }
}

function formatEvent(evt: SupervisorEvent): string {
  switch (evt.type) {
    case 'supervisorTaskAssigned':
      return `分配给 ${evt.subAgentName}: ${truncate(evt.taskDescription, 40)}`
    case 'subAgentStarted':
      return `${evt.subAgentName} 开始执行: ${truncate(evt.taskDescription, 40)}`
    case 'subAgentCompleted':
      return `${evt.subAgentName} 完成（${evt.outputChars} 字符 / ${(evt.durationMs / 1000).toFixed(2)}s）`
    case 'subAgentError':
      return `${evt.subAgentName} 出错: ${truncate(evt.error, 60)}`
    case 'supervisorError':
      return `[${evt.stage}] ${truncate(evt.error, 60)}`
    default:
      return JSON.stringify(evt)
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}
</script>

<style scoped>
/* SupervisorStatusBar：中心化调度状态面板（紧凑 + Popover）
 * 配色用橙色系（rgba(251, 146, 60)），区分于 ToT/GoT 紫色系与 MA 青色系
 * 图标用 git-fork，表达"中心调度 → 子 Agent 执行"的分支感 */
.sup-status-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: rgba(251, 146, 60, 0.06);
  border-top: 1px solid rgba(251, 146, 60, 0.15);
  border-bottom: 1px solid rgba(251, 146, 60, 0.15);
  font-size: 12px;
  color: var(--ws-text-primary, #2c2c2c);
}

.sup-summary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: inherit;
  font-size: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.sup-summary-btn:hover {
  background: rgba(251, 146, 60, 0.1);
}

.sup-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  flex-shrink: 0;
}

.sup-dot-idle { background: #9ca3af; }
.sup-dot-running {
  background: #fb923c;
  box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.25);
  animation: sup-pulse 1.5s ease-in-out infinite;
}
.sup-dot-done { background: #10b981; }
.sup-dot-aborted { background: #6b7280; }
.sup-dot-error { background: #ef4444; }

@keyframes sup-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(251, 146, 60, 0.25); }
  50% { box-shadow: 0 0 0 4px rgba(251, 146, 60, 0.4); }
}

.sup-icon {
  color: #fb923c;
}

.sup-label {
  font-weight: 600;
  font-size: 11px;
  color: #fb923c;
  letter-spacing: 0.5px;
}

.sup-summary {
  color: var(--ws-text-secondary, #6b7280);
  font-size: 11px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sup-badge {
  padding: 1px 6px;
  background: rgba(251, 146, 60, 0.15);
  color: #c2410c;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sup-expand-icon {
  color: var(--ws-text-tertiary, #9ca3af);
}

.sup-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--ws-text-secondary, #6b7280);
  cursor: pointer;
  transition: all 0.15s;
}

.sup-action-btn:hover:not(:disabled) {
  background: rgba(251, 146, 60, 0.1);
  color: #fb923c;
}

.sup-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Popover */
.sup-popover {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 12px;
  width: 420px;
  max-height: 480px;
  overflow-y: auto;
  background: var(--ws-bg-primary, #ffffff);
  border: 1px solid rgba(251, 146, 60, 0.2);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
}

.sup-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(251, 146, 60, 0.08);
  border-bottom: 1px solid rgba(251, 146, 60, 0.15);
}

.sup-popover-title {
  font-weight: 600;
  font-size: 12px;
  color: #c2410c;
}

.sup-popover-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--ws-text-tertiary, #9ca3af);
  cursor: pointer;
  border-radius: 3px;
}

.sup-popover-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--ws-text-primary, #2c2c2c);
}

.sup-popover-body {
  padding: 8px 12px;
}

.sup-section {
  padding: 8px 0;
  border-bottom: 1px solid var(--ws-border-light, rgba(0, 0, 0, 0.06));
}

.sup-section:last-child {
  border-bottom: none;
}

.sup-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-text-tertiary, #9ca3af);
  letter-spacing: 0.3px;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.sup-section-meta {
  font-weight: 400;
  color: var(--ws-text-tertiary, #9ca3af);
  text-transform: none;
  letter-spacing: normal;
}

.sup-task-id {
  font-family: monospace;
  font-size: 11px;
  color: var(--ws-text-tertiary, #9ca3af);
}

.sup-task-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-text-primary, #2c2c2c);
  line-height: 1.5;
}

.sup-counter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.sup-counter-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sup-counter-label {
  font-size: 10px;
  color: var(--ws-text-tertiary, #9ca3af);
}

.sup-counter-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-primary, #2c2c2c);
}

.sup-status-idle { color: #6b7280; }
.sup-status-running { color: #fb923c; }
.sup-status-done { color: #10b981; }
.sup-status-aborted { color: #6b7280; }
.sup-status-error { color: #ef4444; }

.sup-section-reasoning .sup-reasoning-text,
.sup-section-summary .sup-summary-content {
  font-size: 12px;
  color: var(--ws-text-primary, #2c2c2c);
  line-height: 1.5;
  padding: 6px 8px;
  background: rgba(251, 146, 60, 0.05);
  border-left: 2px solid #fb923c;
  border-radius: 0 4px 4px 0;
}

.sup-message-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sup-message-item {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.5;
}

.sup-msg-role {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--ws-text-tertiary, #9ca3af);
  min-width: 32px;
}

.sup-msg-user .sup-msg-role { color: #3b82f6; }
.sup-msg-assistant .sup-msg-role { color: #10b981; }
.sup-msg-tool_result .sup-msg-role { color: #f59e0b; }
.sup-msg-system .sup-msg-role { color: #6b7280; }

.sup-msg-content {
  color: var(--ws-text-secondary, #6b7280);
  word-break: break-word;
}

.sup-empty {
  font-size: 11px;
  color: var(--ws-text-tertiary, #9ca3af);
  padding: 4px 0;
}

.sup-event-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 200px;
  overflow-y: auto;
}

.sup-event-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 3px 4px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.4;
}

.sup-event-normal { color: var(--ws-text-secondary, #6b7280); }
.sup-event-info { color: #3b82f6; background: rgba(59, 130, 246, 0.05); }
.sup-event-success { color: #10b981; background: rgba(16, 185, 129, 0.05); }
.sup-event-warning { color: #f59e0b; background: rgba(245, 158, 11, 0.05); }
.sup-event-critical { color: #ef4444; background: rgba(239, 68, 68, 0.05); }

.sup-event-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.sup-event-text {
  word-break: break-word;
}

.sup-event-more {
  margin-top: 4px;
  font-size: 10px;
  color: var(--ws-text-tertiary, #9ca3af);
  text-align: center;
}

.sup-section-error .sup-error-text {
  font-size: 12px;
  color: #ef4444;
  padding: 6px 8px;
  background: rgba(239, 68, 68, 0.05);
  border-left: 2px solid #ef4444;
  border-radius: 0 4px 4px 0;
  line-height: 1.5;
  word-break: break-word;
}

/* 响应式：小屏幕下 Popover 占满宽度 */
@media (max-width: 600px) {
  .sup-popover {
    right: 4px;
    left: 4px;
    width: auto;
  }

  .sup-counter-grid {
    grid-template-columns: 1fr;
  }

  .sup-summary {
    max-width: 120px;
  }
}
</style>
