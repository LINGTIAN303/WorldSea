<template>
  <div v-if="sessionId && sessionState" class="ma-status-bar" :class="`ma-level-${level}`">
    <!-- 紧凑视图 -->
    <button
      class="ma-summary-btn"
      :title="summaryTitle"
      @click="togglePopover"
    >
      <span class="ma-dot" :class="`ma-dot-${level}`"></span>
      <WsIcon name="users" size="xs" class="ma-icon" />
      <span class="ma-label">MA</span>
      <span class="ma-summary">{{ summaryText }}</span>
      <!-- 轮次徽章 -->
      <span v-if="sessionState.roundsCompleted > 0 || sessionState.currentRound > 0" class="ma-badge">
        {{ sessionState.currentRound || sessionState.roundsCompleted }}
      </span>
      <WsIcon
        :name="popoverOpen ? 'chevron-down' : 'chevron-right'"
        size="xs"
        class="ma-expand-icon"
      />
    </button>

    <!-- 中断按钮（仅 running 时显示） -->
    <button
      v-if="sessionState.runStatus === 'running'"
      class="ma-action-btn"
      title="中断当前 Multi-Agent 协作（协作式，需等当前轮次结束）"
      :disabled="aborting"
      @click="onAbort"
    >
      <WsIcon :name="aborting ? 'loading' : 'x'" size="xs" />
    </button>

    <!-- 刷新黑板按钮 -->
    <button
      class="ma-action-btn"
      title="手动刷新黑板快照"
      :disabled="refreshing"
      @click="onRefreshBlackboard"
    >
      <WsIcon :name="refreshing ? 'loading' : 'refresh'" size="xs" />
    </button>

    <!-- Popover 浮层 -->
    <div v-if="popoverOpen" class="ma-popover" @click.stop>
      <div class="ma-popover-header">
        <span class="ma-popover-title">Multi-Agent 协作详情</span>
        <button class="ma-popover-close" @click="popoverOpen = false" title="关闭">
          <WsIcon name="x" size="xs" />
        </button>
      </div>

      <div class="ma-popover-body">
        <!-- 任务基本信息 -->
        <section class="ma-section">
          <div class="ma-section-title">任务</div>
          <div class="ma-task-id" :title="sessionId">{{ shortSessionId }}</div>
          <div v-if="sessionState.currentTask" class="ma-task-text">
            {{ sessionState.currentTask }}
          </div>
        </section>

        <!-- 协作进度 -->
        <section class="ma-section">
          <div class="ma-section-title">协作进度</div>
          <div class="ma-counter-grid">
            <div class="ma-counter-item">
              <span class="ma-counter-label">状态</span>
              <span class="ma-counter-value" :class="`ma-status-${sessionState.runStatus}`">
                {{ formatRunStatus(sessionState.runStatus) }}
              </span>
            </div>
            <div class="ma-counter-item">
              <span class="ma-counter-label">当前轮次</span>
              <span class="ma-counter-value">{{ sessionState.currentRound }}</span>
            </div>
            <div class="ma-counter-item">
              <span class="ma-counter-label">已完成</span>
              <span class="ma-counter-value">{{ sessionState.roundsCompleted }}</span>
            </div>
            <div class="ma-counter-item">
              <span class="ma-counter-label">本轮 Agent</span>
              <span class="ma-counter-value">{{ sessionState.currentAgentCount }}</span>
            </div>
            <div class="ma-counter-item">
              <span class="ma-counter-label">消息传递</span>
              <span class="ma-counter-value">{{ sessionState.messagesSent }}</span>
            </div>
            <div class="ma-counter-item">
              <span class="ma-counter-label">黑板更新</span>
              <span class="ma-counter-value">{{ sessionState.blackboardUpdates }}</span>
            </div>
          </div>
        </section>

        <!-- 最终结果（multiAgentConverged 后显示） -->
        <section v-if="sessionState.finalResult" class="ma-section ma-section-final">
          <div class="ma-section-title">
            最终结果
            <span v-if="sessionState.convergenceReason" class="ma-section-meta">
              ({{ formatConvergenceReason(sessionState.convergenceReason) }})
            </span>
          </div>
          <div class="ma-final-content">{{ sessionState.finalResult }}</div>
        </section>

        <!-- 黑板快照（含 Agent 输出历史） -->
        <section v-if="blackboardSnapshot" class="ma-section ma-section-blackboard">
          <div class="ma-section-title">
            共享黑板
            <span class="ma-section-meta">
              ({{ agentOutputCount }} 条 Agent 输出)
            </span>
          </div>

          <!-- 共享上下文 KV -->
          <div v-if="sharedContextEntries.length > 0" class="ma-bb-subsection">
            <div class="ma-bb-subtitle">共享上下文</div>
            <div class="ma-bb-kv-list">
              <div v-for="[k, v] in sharedContextEntries" :key="k" class="ma-bb-kv-item">
                <span class="ma-bb-key">{{ k }}</span>
                <span class="ma-bb-value">{{ truncate(v, 80) }}</span>
              </div>
            </div>
          </div>

          <!-- 各 Agent 输出历史 -->
          <div v-if="agentOutputsEntries.length > 0" class="ma-bb-subsection">
            <div class="ma-bb-subtitle">Agent 输出</div>
            <div class="ma-agent-outputs">
              <details v-for="[agentId, outputs] in agentOutputsEntries" :key="agentId" class="ma-agent-group">
                <summary class="ma-agent-summary">
                  <WsIcon name="user" size="xs" class="ma-agent-icon" />
                  <span class="ma-agent-id">{{ agentId }}</span>
                  <span class="ma-agent-count">{{ outputs.length }} 条</span>
                </summary>
                <div class="ma-agent-output-list">
                  <div v-for="(output, idx) in outputs" :key="idx" class="ma-agent-output-item">
                    <span class="ma-output-idx">#{{ idx + 1 }}</span>
                    <span class="ma-output-text">{{ truncate(output, 200) }}</span>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>

        <!-- 事件历史 -->
        <section class="ma-section">
          <div class="ma-section-title">
            事件历史
            <span class="ma-section-meta">({{ sessionState.events.length }} 条)</span>
          </div>
          <div v-if="sessionState.events.length === 0" class="ma-empty">暂无事件</div>
          <div v-else class="ma-event-list">
            <div
              v-for="(evt, idx) in recentEvents"
              :key="idx"
              class="ma-event-item"
              :class="`ma-event-${getEventLevel(evt.type)}`"
            >
              <WsIcon :name="getEventIcon(evt.type)" size="xs" class="ma-event-icon" />
              <span class="ma-event-text">{{ formatEvent(evt) }}</span>
            </div>
            <div
              v-if="sessionState.events.length > recentEvents.length"
              class="ma-event-more"
            >... 还有 {{ sessionState.events.length - recentEvents.length }} 条</div>
          </div>
        </section>

        <!-- 错误信息 -->
        <section v-if="sessionState.lastError" class="ma-section ma-section-error">
          <div class="ma-section-title">
            最近错误
            <span v-if="sessionState.errorAgentId" class="ma-section-meta">
              (Agent: {{ sessionState.errorAgentId }})
            </span>
          </div>
          <div class="ma-error-text">{{ sessionState.lastError }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useMultiAgentRust, type MultiAgentEvent } from '../composables/useMultiAgentRust'

const props = defineProps<{
  /**
   * Multi-Agent 会话 ID
   *
   * 由父组件管理生命周期（create/destroy）。
   * 当 sessionId 非空且对应会话存在于 useMultiAgentRust().sessions 时显示。
   */
  sessionId: string | null
}>()

const {
  sessions,
  abort: abortSession,
  getBlackboard,
  subscribe,
} = useMultiAgentRust()

/** Popover 展开/收起状态 */
const popoverOpen = ref(false)

/** 中断中标志 */
const aborting = ref(false)

/** 刷新黑板中标志 */
const refreshing = ref(false)

/** 强制刷新触发器（事件订阅时自增，驱动 computed 重新计算） */
const refreshTick = ref(0)

/** 当前会话状态（响应式，来自模块级 Map） */
const sessionState = computed(() => {
  // 引用 refreshTick 让 computed 在事件回调时重新计算
  void refreshTick.value
  if (!props.sessionId) return null
  return sessions.value.get(props.sessionId) ?? null
})

/** 黑板快照（从 sessionState 读取，由 getBlackboard 自动填充） */
const blackboardSnapshot = computed(() => sessionState.value?.blackboardSnapshot ?? null)

/** 综合级别：idle / running / done / aborted / error（对应 runStatus） */
const level = computed<'idle' | 'running' | 'done' | 'aborted' | 'error'>(() => {
  return sessionState.value?.runStatus ?? 'idle'
})

/** 紧凑视图摘要文本 */
const summaryText = computed(() => {
  const s = sessionState.value
  if (!s) return '初始化中'
  const parts: string[] = []
  if (s.currentRound > 0) {
    parts.push(`轮次 ${s.currentRound}`)
  }
  parts.push(`${s.messagesSent} 消息`)
  if (s.runStatus === 'running') {
    parts.push('协作中')
  } else if (s.runStatus === 'done') {
    if (s.convergenceReason) {
      parts.push(formatConvergenceReason(s.convergenceReason))
    } else {
      parts.push('已完成')
    }
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
  if (!s) return 'Multi-Agent 状态加载中'
  const lines = [
    `会话: ${props.sessionId}`,
    `状态: ${formatRunStatus(s.runStatus)}`,
    `当前轮次: ${s.currentRound}`,
    `已完成轮次: ${s.roundsCompleted}`,
    `本轮 Agent 数: ${s.currentAgentCount}`,
    `消息传递: ${s.messagesSent}`,
    `黑板更新: ${s.blackboardUpdates}`,
  ]
  if (s.convergenceReason) lines.push(`收敛原因: ${formatConvergenceReason(s.convergenceReason)}`)
  if (s.lastError) lines.push(`错误: ${s.lastError}`)
  return lines.join('\n')
})

/** 短会话 ID（ma_{timestamp}_{random} → ma_..._random） */
const shortSessionId = computed(() => {
  if (!props.sessionId) return ''
  const sid = props.sessionId
  if (sid.length <= 24) return sid
  return `${sid.slice(0, 10)}...${sid.slice(-8)}`
})

/** 最近 50 条事件（倒序，最新在前） */
const recentEvents = computed(() => {
  const s = sessionState.value
  if (!s) return []
  return s.events.slice(-50).reverse()
})

/** 黑板 shared_context 条目（按 key 排序） */
const sharedContextEntries = computed<Array<[string, string]>>(() => {
  void refreshTick.value
  const bb = blackboardSnapshot.value
  if (!bb) return []
  return Object.entries(bb.shared_context).sort(([a], [b]) => a.localeCompare(b))
})

/** 黑板 agent_outputs 条目（按 agentId 排序） */
const agentOutputsEntries = computed<Array<[string, string[]]>>(() => {
  void refreshTick.value
  const bb = blackboardSnapshot.value
  if (!bb) return []
  return Object.entries(bb.agent_outputs).sort(([a], [b]) => a.localeCompare(b))
})

/** Agent 输出总数 */
const agentOutputCount = computed(() => {
  return agentOutputsEntries.value.reduce((sum, [, outputs]) => sum + outputs.length, 0)
})

// ─── 事件订阅 ────────────────────────────────────────────

let unsubscribe: (() => void) | null = null

watch(
  () => props.sessionId,
  (newId, _oldId) => {
    // 清理旧订阅
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    // 关闭 Popover（切换会话时）
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

async function onAbort(): Promise<void> {
  if (!props.sessionId || aborting.value) return
  aborting.value = true
  try {
    await abortSession(props.sessionId)
  } catch (err) {
    console.error('[MultiAgentStatusBar] 中断失败:', err)
  } finally {
    aborting.value = false
  }
}

async function onRefreshBlackboard(): Promise<void> {
  if (!props.sessionId || refreshing.value) return
  refreshing.value = true
  try {
    await getBlackboard(props.sessionId)
    refreshTick.value += 1
  } catch (err) {
    console.error('[MultiAgentStatusBar] 刷新黑板失败:', err)
  } finally {
    refreshing.value = false
  }
}

function togglePopover(): void {
  popoverOpen.value = !popoverOpen.value
  // 打开 Popover 时刷新一次黑板
  if (popoverOpen.value && props.sessionId) {
    getBlackboard(props.sessionId).catch(() => {})
  }
}

// ─── 格式化工具 ────────────────────────────────────────────

function formatRunStatus(status: string): string {
  switch (status) {
    case 'idle': return '空闲'
    case 'running': return '协作中'
    case 'done': return '已完成'
    case 'aborted': return '已中断'
    case 'error': return '出错'
    default: return status
  }
}

function formatConvergenceReason(reason: string): string {
  // Rust 端 ConvergenceReason 枚举的 Debug 字符串
  switch (reason) {
    case 'GoalReached': return '目标达成'
    case 'MaxRoundsReached': return '达最大轮次'
    case 'AllAgentsIdle': return '所有 Agent 空闲'
    case 'Aborted': return '手动中断'
    default: return reason
  }
}

function getEventLevel(type: MultiAgentEvent['type']): 'normal' | 'info' | 'success' | 'warning' | 'critical' {
  switch (type) {
    case 'multiAgentConverged':
      return 'success'
    case 'multiAgentError':
      return 'critical'
    case 'multiAgentRoundStarted':
    case 'multiAgentRoundCompleted':
      return 'info'
    case 'multiAgentMessageSent':
    case 'multiAgentBlackboardUpdated':
    default:
      return 'normal'
  }
}

function getEventIcon(type: MultiAgentEvent['type']): string {
  switch (type) {
    case 'multiAgentRoundStarted': return 'play-circle'
    case 'multiAgentRoundCompleted': return 'check-circle'
    case 'multiAgentMessageSent': return 'send'
    case 'multiAgentBlackboardUpdated': return 'database'
    case 'multiAgentConverged': return 'target'
    case 'multiAgentError': return 'alert'
    default: return 'info'
  }
}

function formatEvent(evt: MultiAgentEvent): string {
  switch (evt.type) {
    case 'multiAgentRoundStarted':
      return `[轮次 ${evt.round}] 开始（${evt.agentCount} 个 Agent 参与）`
    case 'multiAgentRoundCompleted':
      return `[轮次 ${evt.round}] 完成（产出 ${evt.outputs.length} 条）`
    case 'multiAgentMessageSent':
      return `[${evt.from} → ${evt.to}] ${evt.messageType}: ${truncate(evt.contentPreview, 40)}`
    case 'multiAgentBlackboardUpdated':
      return `黑板更新: ${evt.key} (by ${evt.by})`
    case 'multiAgentConverged':
      return `协作收敛: ${formatConvergenceReason(evt.reason)}`
    case 'multiAgentError':
      return `[${evt.agentId}] ${evt.error}`
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
/* MultiAgentStatusBar：Multi-Agent 协作状态面板（紧凑 + Popover）
 * 配色用青色/蓝色系区分（与 ToT/GoT 紫色不同），图标用 users 表示多 Agent */
.ma-status-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: rgba(20, 184, 166, 0.06);
  border-top: 1px solid rgba(20, 184, 166, 0.15);
  font-size: var(--fs-xs);
  color: rgba(204, 251, 241, 0.85);
  flex-shrink: 0;
}

/* 状态级别背景色 */
.ma-level-running {
  background: rgba(96, 165, 250, 0.08);
  border-top-color: rgba(96, 165, 250, 0.25);
  color: rgba(219, 234, 254, 0.9);
}
.ma-level-done {
  background: rgba(52, 211, 153, 0.06);
  border-top-color: rgba(52, 211, 153, 0.2);
  color: rgba(209, 250, 229, 0.9);
}
.ma-level-aborted {
  background: rgba(251, 191, 36, 0.06);
  border-top-color: rgba(251, 191, 36, 0.2);
  color: rgba(254, 243, 199, 0.9);
}
.ma-level-error {
  background: rgba(248, 113, 113, 0.08);
  border-top-color: rgba(248, 113, 113, 0.25);
  color: rgba(254, 226, 226, 0.9);
}

/* 紧凑视图按钮 */
.ma-summary-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: inherit;
  cursor: pointer;
  border-radius: var(--radius-2xs);
  transition: background 0.15s;
}
.ma-summary-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* 状态指示点 */
.ma-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ma-dot-idle { background: rgb(156, 163, 175); }
.ma-dot-running {
  background: rgb(96, 165, 250);
  box-shadow: 0 0 4px rgba(96, 165, 250, 0.5);
  animation: ma-blink 1.4s ease-in-out infinite;
}
.ma-dot-done { background: rgb(52, 211, 153); box-shadow: 0 0 4px rgba(52, 211, 153, 0.5); }
.ma-dot-aborted { background: rgb(251, 191, 36); }
.ma-dot-error { background: rgb(248, 113, 113); box-shadow: 0 0 4px rgba(248, 113, 113, 0.5); }
@keyframes ma-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.ma-icon { color: rgba(45, 212, 191, 0.8); }
.ma-level-running .ma-icon { color: rgba(147, 197, 253, 0.8); }
.ma-level-done .ma-icon { color: rgba(110, 231, 183, 0.8); }
.ma-level-aborted .ma-icon { color: rgba(252, 211, 77, 0.8); }
.ma-level-error .ma-icon { color: rgba(252, 165, 165, 0.85); }

.ma-label {
  font-weight: 600;
  color: rgb(45, 212, 191);
}
.ma-level-running .ma-label { color: rgb(147, 197, 253); }
.ma-level-done .ma-label { color: rgb(110, 231, 183); }
.ma-level-aborted .ma-label { color: rgb(252, 211, 77); }
.ma-level-error .ma-label { color: rgb(252, 165, 165); }

.ma-summary {
  font-variant-numeric: tabular-nums;
  color: rgba(204, 251, 241, 0.85);
}
.ma-level-running .ma-summary { color: rgba(219, 234, 254, 0.85); }
.ma-level-done .ma-summary { color: rgba(209, 250, 229, 0.85); }
.ma-level-aborted .ma-summary { color: rgba(254, 243, 199, 0.85); }
.ma-level-error .ma-summary { color: rgba(254, 226, 226, 0.85); }

/* 轮次徽章 */
.ma-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: rgba(20, 184, 166, 0.6);
  color: rgb(240, 253, 250);
  font-size: var(--fs-2xs);
  font-weight: 600;
  flex-shrink: 0;
}
.ma-level-running .ma-badge { background: rgba(96, 165, 250, 0.7); }
.ma-level-done .ma-badge { background: rgba(52, 211, 153, 0.7); }
.ma-level-error .ma-badge { background: rgba(248, 113, 113, 0.7); }

.ma-expand-icon {
  color: rgba(45, 212, 191, 0.5);
  transition: transform 0.15s;
}

/* 操作按钮（中断/刷新） */
.ma-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: rgba(45, 212, 191, 0.6);
  cursor: pointer;
  border-radius: var(--radius-2xs);
  transition: background 0.15s;
}
.ma-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(45, 212, 191, 0.9);
}
.ma-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Popover 浮层 */
.ma-popover {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 12px;
  right: 12px;
  max-width: 560px;
  min-width: 400px;
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: rgb(17, 24, 39);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: var(--radius-sm);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  z-index: 100;
  font-size: var(--fs-xs);
  color: rgba(229, 231, 235, 0.9);
}

.ma-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  background: rgba(31, 41, 55, 0.6);
}
.ma-popover-title {
  font-weight: 600;
  color: rgb(204, 251, 241);
}
.ma-popover-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: rgba(156, 163, 175, 0.7);
  cursor: pointer;
  border-radius: var(--radius-2xs);
}
.ma-popover-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgb(248, 113, 113);
}

.ma-popover-body {
  overflow-y: auto;
  padding: 8px 12px;
}

.ma-section {
  padding: 6px 0;
  border-bottom: 1px solid rgba(75, 85, 99, 0.2);
}
.ma-section:last-child { border-bottom: none; }
.ma-section-title {
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: rgba(156, 163, 175, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.ma-section-meta {
  font-weight: 400;
  text-transform: none;
  color: rgba(156, 163, 175, 0.6);
}

.ma-task-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: var(--fs-2xs);
  color: rgba(204, 251, 241, 0.85);
  word-break: break-all;
}
.ma-task-text {
  margin-top: 4px;
  padding: 4px 6px;
  background: rgba(20, 184, 166, 0.06);
  border-left: 2px solid rgba(20, 184, 166, 0.4);
  border-radius: 2px;
  font-size: var(--fs-xs);
  color: rgba(204, 251, 241, 0.9);
  line-height: 1.4;
}

/* 计数器网格 */
.ma-counter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 12px;
}
.ma-counter-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.ma-counter-label {
  color: rgba(156, 163, 175, 0.8);
  min-width: 70px;
}
.ma-counter-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: rgb(229, 231, 235);
}
.ma-status-idle { color: rgb(156, 163, 175); }
.ma-status-running { color: rgb(147, 197, 253); }
.ma-status-done { color: rgb(110, 231, 183); }
.ma-status-aborted { color: rgb(252, 211, 77); }
.ma-status-error { color: rgb(252, 165, 165); }

/* 最终结果区 */
.ma-section-final {
  background: rgba(110, 231, 183, 0.04);
  margin: 4px -12px;
  padding: 6px 12px;
}
.ma-final-content {
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: rgb(110, 231, 183);
  background: rgba(110, 231, 183, 0.06);
  padding: 6px 8px;
  border-radius: var(--radius-2xs);
  border-left: 2px solid rgba(110, 231, 183, 0.5);
  word-break: break-word;
  white-space: pre-wrap;
}

/* 黑板区 */
.ma-section-blackboard {
  background: rgba(31, 41, 55, 0.3);
  margin: 4px -12px;
  padding: 6px 12px;
}

.ma-bb-subsection {
  margin-top: 6px;
}
.ma-bb-subsection:first-child {
  margin-top: 0;
}
.ma-bb-subtitle {
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: rgba(45, 212, 191, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
}

.ma-bb-kv-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ma-bb-kv-item {
  display: flex;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.ma-bb-kv-item:hover {
  background: rgba(255, 255, 255, 0.03);
}
.ma-bb-key {
  flex-shrink: 0;
  min-width: 80px;
  color: rgba(147, 197, 253, 0.85);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
.ma-bb-value {
  color: rgba(229, 231, 235, 0.85);
  word-break: break-all;
}

/* Agent 输出列表 */
.ma-agent-outputs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ma-agent-group {
  border-radius: var(--radius-2xs);
  background: rgba(255, 255, 255, 0.02);
}
.ma-agent-group[open] {
  background: rgba(255, 255, 255, 0.04);
}
.ma-agent-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  cursor: pointer;
  font-size: var(--fs-2xs);
  list-style: none;
}
.ma-agent-summary::-webkit-details-marker {
  display: none;
}
.ma-agent-icon {
  flex-shrink: 0;
  color: rgba(45, 212, 191, 0.7);
}
.ma-agent-id {
  flex: 1;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  color: rgba(204, 251, 241, 0.9);
  font-weight: 600;
}
.ma-agent-count {
  color: rgba(156, 163, 175, 0.7);
  font-size: var(--fs-3xs);
}
.ma-agent-output-list {
  padding: 2px 6px 4px 22px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ma-agent-output-item {
  display: flex;
  gap: 4px;
  padding: 2px 4px;
  font-size: var(--fs-2xs);
  line-height: 1.4;
  border-left: 1px solid rgba(75, 85, 99, 0.3);
}
.ma-output-idx {
  flex-shrink: 0;
  color: rgba(156, 163, 175, 0.6);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
.ma-output-text {
  color: rgba(229, 231, 235, 0.8);
  word-break: break-all;
}

/* 事件历史列表 */
.ma-event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.ma-event-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.ma-event-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
.ma-event-text {
  word-break: break-all;
  color: rgba(229, 231, 235, 0.85);
}
.ma-event-success .ma-event-icon { color: rgb(110, 231, 183); }
.ma-event-critical .ma-event-icon { color: rgb(252, 165, 165); }
.ma-event-info .ma-event-icon { color: rgb(147, 197, 253); }
.ma-event-normal .ma-event-icon { color: rgba(45, 212, 191, 0.7); }

.ma-event-more {
  padding: 4px;
  text-align: center;
  font-size: var(--fs-2xs);
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.ma-empty {
  padding: 8px;
  text-align: center;
  font-size: var(--fs-2xs);
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

/* 错误信息 */
.ma-section-error {
  background: rgba(248, 113, 113, 0.05);
  margin: 4px -12px;
  padding: 6px 12px;
}
.ma-error-text {
  font-size: var(--fs-2xs);
  color: rgb(252, 165, 165);
  word-break: break-all;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}

/* ── 减弱动态偏好（prefers-reduced-motion）：停用状态点闪烁与展开图标旋转 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
:root[data-anim-status='off'] .ma-dot-running {
  animation: none;
}
:root[data-anim-status='off'] .ma-expand-icon {
  transition: none;
}
</style>