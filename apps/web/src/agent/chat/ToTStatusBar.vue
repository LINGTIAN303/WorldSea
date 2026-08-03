<!--
  # ToTStatusBar — Tree of Thoughts 状态面板

  阶段 2.1 批次4 新增。显示当前 ToT 会话的探索状态、计数器、最优思维与思维树可视化。
  与 LoopControlStatusBar 并列显示（在其下方）。

  ## UI 结构
  - 紧凑视图（默认）：状态点 + 摘要 + 展开按钮
  - Popover 浮层：任务信息 + 探索进度 + 最优思维 + 事件历史 + 内嵌 ToTTreeView

  ## 颜色映射（按 runStatus）
  - idle（灰）：未开始
  - running（蓝闪烁）：探索中
  - done（绿）：已完成（含 goal_reached 与正常 terminated）
  - aborted（黄）：被中断
  - error（红）：出错

  ## 生命周期
  本组件不负责 create/destroy，由父组件（AgentChat.vue）通过 `sessionId` prop 控制。
  当 sessionId 非空且对应会话存在于 useToTRust().sessions 时显示。
  组件内部只负责：
  - 订阅事件（实时更新状态）
  - 提供"刷新"按钮（手动触发 getTree）
  - 提供"中断"按钮（手动触发 abort，仅 running 时可用）
-->
<template>
  <div v-if="sessionId && sessionState" class="tot-status-bar" :class="`tot-level-${level}`">
    <!-- 紧凑视图 -->
    <button
      class="tot-summary-btn"
      :title="summaryTitle"
      @click="togglePopover"
    >
      <span class="tot-dot" :class="`tot-dot-${level}`"></span>
      <WsIcon name="git-branch" size="xs" class="tot-icon" />
      <span class="tot-label">ToT</span>
      <span class="tot-summary">{{ summaryText }}</span>
      <!-- 节点数徽章 -->
      <span v-if="sessionState.nodesCreated > 0" class="tot-badge">
        {{ sessionState.nodesCreated }}
      </span>
      <WsIcon
        :name="popoverOpen ? 'chevron-down' : 'chevron-right'"
        size="xs"
        class="tot-expand-icon"
      />
    </button>

    <!-- 中断按钮（仅 running 时显示） -->
    <button
      v-if="sessionState.runStatus === 'running'"
      class="tot-action-btn"
      title="中断当前 ToT 探索（协作式，需等当前层 LLM 调用完成）"
      :disabled="aborting"
      @click="onAbort"
    >
      <WsIcon :name="aborting ? 'loading' : 'x'" size="xs" />
    </button>

    <!-- 刷新树按钮 -->
    <button
      class="tot-action-btn"
      title="手动刷新思维树快照"
      :disabled="refreshing"
      @click="onRefreshTree"
    >
      <WsIcon :name="refreshing ? 'loading' : 'refresh'" size="xs" />
    </button>

    <!-- Popover 浮层 -->
    <div v-if="popoverOpen" class="tot-popover" @click.stop>
      <div class="tot-popover-header">
        <span class="tot-popover-title">Tree of Thoughts 详情</span>
        <button class="tot-popover-close" @click="popoverOpen = false" title="关闭">
          <WsIcon name="x" size="xs" />
        </button>
      </div>

      <div class="tot-popover-body">
        <!-- 任务基本信息 -->
        <section class="tot-section">
          <div class="tot-section-title">任务</div>
          <div class="tot-task-id" :title="sessionId">{{ shortSessionId }}</div>
          <div v-if="sessionState.currentTask" class="tot-task-text">
            {{ sessionState.currentTask }}
          </div>
        </section>

        <!-- 探索进度 -->
        <section class="tot-section">
          <div class="tot-section-title">探索进度</div>
          <div class="tot-counter-grid">
            <div class="tot-counter-item">
              <span class="tot-counter-label">状态</span>
              <span class="tot-counter-value" :class="`tot-status-${sessionState.runStatus}`">
                {{ formatRunStatus(sessionState.runStatus) }}
              </span>
            </div>
            <div class="tot-counter-item">
              <span class="tot-counter-label">节点</span>
              <span class="tot-counter-value">{{ sessionState.nodesCreated }}</span>
            </div>
            <div class="tot-counter-item">
              <span class="tot-counter-label">已评分</span>
              <span class="tot-counter-value">{{ sessionState.nodesScored }}</span>
            </div>
            <div class="tot-counter-item">
              <span class="tot-counter-label">分支</span>
              <span class="tot-counter-value">{{ sessionState.branchesExplored }}</span>
            </div>
            <div class="tot-counter-item">
              <span class="tot-counter-label">最大深度</span>
              <span class="tot-counter-value">{{ sessionState.currentMaxDepth }}</span>
            </div>
            <div v-if="sessionState.bestScore !== null" class="tot-counter-item">
              <span class="tot-counter-label">最优分</span>
              <span class="tot-counter-value tot-score-high">{{ sessionState.bestScore }}</span>
            </div>
          </div>
        </section>

        <!-- 最优思维 -->
        <section v-if="sessionState.bestThoughtContent" class="tot-section tot-section-best">
          <div class="tot-section-title">
            最优思维
            <span v-if="sessionState.terminationReason" class="tot-section-meta">
              ({{ formatTerminationReason(sessionState.terminationReason) }})
            </span>
          </div>
          <div class="tot-best-content">{{ sessionState.bestThoughtContent }}</div>
        </section>

        <!-- 思维树可视化（内嵌 ToTTreeView） -->
        <section class="tot-section tot-section-tree">
          <div class="tot-section-title">
            思维树
            <span class="tot-section-meta">
              ({{ treeSnapshot?.totalCount ?? 0 }} 节点)
            </span>
          </div>
          <ToTTreeView :session-id="sessionId" />
        </section>

        <!-- 事件历史 -->
        <section class="tot-section">
          <div class="tot-section-title">
            事件历史
            <span class="tot-section-meta">({{ sessionState.events.length }} 条)</span>
          </div>
          <div v-if="sessionState.events.length === 0" class="tot-empty">暂无事件</div>
          <div v-else class="tot-event-list">
            <div
              v-for="(evt, idx) in recentEvents"
              :key="idx"
              class="tot-event-item"
              :class="`tot-event-${getEventLevel(evt.type)}`"
            >
              <WsIcon :name="getEventIcon(evt.type)" size="xs" class="tot-event-icon" />
              <span class="tot-event-text">{{ formatEvent(evt) }}</span>
            </div>
            <div
              v-if="sessionState.events.length > recentEvents.length"
              class="tot-event-more"
            >... 还有 {{ sessionState.events.length - recentEvents.length }} 条</div>
          </div>
        </section>

        <!-- 错误信息 -->
        <section v-if="sessionState.lastError" class="tot-section tot-section-error">
          <div class="tot-section-title">
            最近错误
            <span v-if="sessionState.errorStage" class="tot-section-meta">
              ({{ sessionState.errorStage }})
            </span>
          </div>
          <div class="tot-error-text">{{ sessionState.lastError }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import ToTTreeView from './ToTTreeView.vue'
import { useToTRust, type ToTEvent } from '../composables/useToTRust'

const props = defineProps<{
  /**
   * ToT 会话 ID
   *
   * 由父组件管理生命周期（create/destroy）。
   * 当 sessionId 非空且对应会话存在于 useToTRust().sessions 时显示。
   */
  sessionId: string | null
}>()

const {
  sessions,
  abort: abortSession,
  getTree,
  subscribe,
} = useToTRust()

/** Popover 展开/收起状态 */
const popoverOpen = ref(false)

/** 中断中标志 */
const aborting = ref(false)

/** 刷新树中标志 */
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

/** 思维树快照（从 sessionState 读取，由 getTree 自动填充） */
const treeSnapshot = computed(() => sessionState.value?.treeSnapshot ?? null)

/** 综合级别：idle / running / done / aborted / error（对应 runStatus） */
const level = computed<'idle' | 'running' | 'done' | 'aborted' | 'error'>(() => {
  return sessionState.value?.runStatus ?? 'idle'
})

/** 紧凑视图摘要文本 */
const summaryText = computed(() => {
  const s = sessionState.value
  if (!s) return '初始化中'
  const parts: string[] = []
  parts.push(`${s.nodesCreated} 节点`)
  parts.push(`深度 ${s.currentMaxDepth}`)
  if (s.runStatus === 'running') {
    parts.push('探索中')
  } else if (s.runStatus === 'done') {
    if (s.bestScore !== null) {
      parts.push(`最优 ${s.bestScore}`)
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
  if (!s) return 'ToT 状态加载中'
  const lines = [
    `会话: ${props.sessionId}`,
    `状态: ${formatRunStatus(s.runStatus)}`,
    `节点: ${s.nodesCreated} (已评分 ${s.nodesScored})`,
    `分支: ${s.branchesExplored}`,
    `最大深度: ${s.currentMaxDepth}`,
  ]
  if (s.bestScore !== null) lines.push(`最优评分: ${s.bestScore}`)
  if (s.terminationReason) lines.push(`终止原因: ${formatTerminationReason(s.terminationReason)}`)
  if (s.lastError) lines.push(`错误: ${s.lastError}`)
  return lines.join('\n')
})

/** 短会话 ID（tot_{timestamp}_{random} → tot_..._random） */
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
    console.error('[ToTStatusBar] 中断失败:', err)
  } finally {
    aborting.value = false
  }
}

async function onRefreshTree(): Promise<void> {
  if (!props.sessionId || refreshing.value) return
  refreshing.value = true
  try {
    await getTree(props.sessionId)
    refreshTick.value += 1
  } catch (err) {
    console.error('[ToTStatusBar] 刷新思维树失败:', err)
  } finally {
    refreshing.value = false
  }
}

function togglePopover(): void {
  popoverOpen.value = !popoverOpen.value
  // 打开 Popover 时刷新一次思维树
  if (popoverOpen.value && props.sessionId) {
    getTree(props.sessionId).catch(() => {})
  }
}

// ─── 格式化工具 ────────────────────────────────────────────

function formatRunStatus(status: string): string {
  switch (status) {
    case 'idle': return '空闲'
    case 'running': return '探索中'
    case 'done': return '已完成'
    case 'aborted': return '已中断'
    case 'error': return '出错'
    default: return status
  }
}

function formatTerminationReason(reason: string): string {
  switch (reason) {
    case 'goal_reached': return '目标达成'
    case 'max_depth_exceeded': return '达最大深度'
    case 'max_thoughts_exceeded': return '达最大节点数'
    case 'convergence': return '收敛'
    case 'no_candidates': return '无候选'
    case 'aborted': return '手动中断'
    default: return reason
  }
}

function getEventLevel(type: ToTEvent['type']): 'normal' | 'info' | 'success' | 'warning' | 'critical' {
  switch (type) {
    case 'totGoalReached':
      return 'success'
    case 'totError':
      return 'critical'
    case 'totTerminated':
      return 'info'
    case 'thoughtNodeCreated':
    case 'thoughtNodeScored':
    case 'thoughtBranchExplored':
    default:
      return 'normal'
  }
}

function getEventIcon(type: ToTEvent['type']): string {
  switch (type) {
    case 'thoughtNodeCreated': return 'plus-circle'
    case 'thoughtNodeScored': return 'check-circle'
    case 'thoughtBranchExplored': return 'git-branch'
    case 'totGoalReached': return 'target'
    case 'totTerminated': return 'flag'
    case 'totError': return 'alert'
    default: return 'info'
  }
}

function formatEvent(evt: ToTEvent): string {
  switch (evt.type) {
    case 'thoughtNodeCreated':
      return `[d${evt.depth}] 新思维: ${truncate(evt.contentPreview, 40)}`
    case 'thoughtNodeScored':
      return `[评分 ${evt.score}] ${truncate(evt.reasoning ?? '', 40) || '无理由'}`
    case 'thoughtBranchExplored':
      return `[d${evt.depth}] 扩展: 保留 ${evt.keptCount}/${evt.childCount} 子节点`
    case 'totGoalReached':
      return `目标达成: 评分 ${evt.score}, 深度 ${evt.depth}`
    case 'totTerminated':
      return `终止: ${formatTerminationReason(evt.reason)} (共 ${evt.totalNodes} 节点, 深度 ${evt.maxDepthReached})`
    case 'totError':
      return `[${evt.stage}] ${evt.error}`
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
/* ToTStatusBar：Tree of Thoughts 状态面板（紧凑 + Popover） */
.tot-status-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: rgba(168, 85, 247, 0.06);
  border-top: 1px solid rgba(168, 85, 247, 0.15);
  font-size: 11px;
  color: rgba(233, 213, 255, 0.85);
  flex-shrink: 0;
}

/* 状态级别背景色 */
.tot-level-running {
  background: rgba(96, 165, 250, 0.08);
  border-top-color: rgba(96, 165, 250, 0.25);
  color: rgba(219, 234, 254, 0.9);
}
.tot-level-done {
  background: rgba(52, 211, 153, 0.06);
  border-top-color: rgba(52, 211, 153, 0.2);
  color: rgba(209, 250, 229, 0.9);
}
.tot-level-aborted {
  background: rgba(251, 191, 36, 0.06);
  border-top-color: rgba(251, 191, 36, 0.2);
  color: rgba(254, 243, 199, 0.9);
}
.tot-level-error {
  background: rgba(248, 113, 113, 0.08);
  border-top-color: rgba(248, 113, 113, 0.25);
  color: rgba(254, 226, 226, 0.9);
}

/* 紧凑视图按钮 */
.tot-summary-btn {
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
.tot-summary-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* 状态指示点 */
.tot-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tot-dot-idle {
  background: rgb(156, 163, 175);
}
.tot-dot-running {
  background: rgb(96, 165, 250);
  box-shadow: 0 0 4px rgba(96, 165, 250, 0.5);
  animation: tot-blink 1.4s ease-in-out infinite;
}
.tot-dot-done {
  background: rgb(52, 211, 153);
  box-shadow: 0 0 4px rgba(52, 211, 153, 0.5);
}
.tot-dot-aborted {
  background: rgb(251, 191, 36);
}
.tot-dot-error {
  background: rgb(248, 113, 113);
  box-shadow: 0 0 4px rgba(248, 113, 113, 0.5);
}
@keyframes tot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.tot-icon {
  color: rgba(196, 181, 253, 0.7);
}
.tot-level-running .tot-icon { color: rgba(147, 197, 253, 0.8); }
.tot-level-done .tot-icon { color: rgba(110, 231, 183, 0.8); }
.tot-level-aborted .tot-icon { color: rgba(252, 211, 77, 0.8); }
.tot-level-error .tot-icon { color: rgba(252, 165, 165, 0.85); }

.tot-label {
  font-weight: 600;
  color: rgb(196, 181, 253);
}
.tot-level-running .tot-label { color: rgb(147, 197, 253); }
.tot-level-done .tot-label { color: rgb(110, 231, 183); }
.tot-level-aborted .tot-label { color: rgb(252, 211, 77); }
.tot-level-error .tot-label { color: rgb(252, 165, 165); }

.tot-summary {
  font-variant-numeric: tabular-nums;
  color: rgba(233, 213, 255, 0.85);
}
.tot-level-running .tot-summary { color: rgba(219, 234, 254, 0.85); }
.tot-level-done .tot-summary { color: rgba(209, 250, 229, 0.85); }
.tot-level-aborted .tot-summary { color: rgba(254, 243, 199, 0.85); }
.tot-level-error .tot-summary { color: rgba(254, 226, 226, 0.85); }

/* 节点数徽章 */
.tot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: rgba(168, 85, 247, 0.6);
  color: rgb(245, 243, 255);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}
.tot-level-running .tot-badge { background: rgba(96, 165, 250, 0.7); }
.tot-level-done .tot-badge { background: rgba(52, 211, 153, 0.7); }
.tot-level-error .tot-badge { background: rgba(248, 113, 113, 0.7); }

.tot-expand-icon {
  color: rgba(196, 181, 253, 0.5);
  transition: transform 0.15s;
}

/* 操作按钮（中断/刷新） */
.tot-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: rgba(196, 181, 253, 0.6);
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
}
.tot-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(196, 181, 253, 0.9);
}
.tot-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Popover 浮层 */
.tot-popover {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 12px;
  right: 12px;
  max-width: 520px;
  min-width: 380px;
  max-height: 70vh;
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

.tot-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  background: rgba(31, 41, 55, 0.6);
}
.tot-popover-title {
  font-weight: 600;
  color: rgb(199, 210, 254);
}
.tot-popover-close {
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
.tot-popover-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgb(248, 113, 113);
}

.tot-popover-body {
  overflow-y: auto;
  padding: 8px 12px;
}

.tot-section {
  padding: 6px 0;
  border-bottom: 1px solid rgba(75, 85, 99, 0.2);
}
.tot-section:last-child {
  border-bottom: none;
}
.tot-section-title {
  font-size: 10px;
  font-weight: 600;
  color: rgba(156, 163, 175, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.tot-section-meta {
  font-weight: 400;
  text-transform: none;
  color: rgba(156, 163, 175, 0.6);
}

.tot-task-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 10px;
  color: rgba(199, 210, 254, 0.85);
  word-break: break-all;
}
.tot-task-text {
  margin-top: 4px;
  padding: 4px 6px;
  background: rgba(168, 85, 247, 0.06);
  border-left: 2px solid rgba(168, 85, 247, 0.4);
  border-radius: 2px;
  font-size: 11px;
  color: rgba(233, 213, 255, 0.9);
  line-height: 1.4;
}

/* 计数器网格 */
.tot-counter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 12px;
}
.tot-counter-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.tot-counter-label {
  color: rgba(156, 163, 175, 0.8);
  min-width: 60px;
}
.tot-counter-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: rgb(229, 231, 235);
}
.tot-status-idle { color: rgb(156, 163, 175); }
.tot-status-running { color: rgb(147, 197, 253); }
.tot-status-done { color: rgb(110, 231, 183); }
.tot-status-aborted { color: rgb(252, 211, 77); }
.tot-status-error { color: rgb(252, 165, 165); }
.tot-score-high { color: rgb(110, 231, 183); }

/* 最优思维区 */
.tot-section-best {
  background: rgba(252, 211, 77, 0.04);
  margin: 4px -12px;
  padding: 6px 12px;
}
.tot-best-content {
  font-size: 11px;
  line-height: 1.5;
  color: rgb(252, 211, 77);
  background: rgba(252, 211, 77, 0.06);
  padding: 6px 8px;
  border-radius: 3px;
  border-left: 2px solid rgba(252, 211, 77, 0.5);
  word-break: break-word;
}

/* 思维树区 */
.tot-section-tree {
  background: rgba(31, 41, 55, 0.3);
  margin: 4px -12px;
  padding: 6px 12px;
}

/* 事件历史列表 */
.tot-event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.tot-event-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  line-height: 1.4;
}
.tot-event-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
.tot-event-text {
  word-break: break-all;
  color: rgba(229, 231, 235, 0.85);
}
.tot-event-success .tot-event-icon { color: rgb(110, 231, 183); }
.tot-event-critical .tot-event-icon { color: rgb(252, 165, 165); }
.tot-event-info .tot-event-icon { color: rgb(147, 197, 253); }
.tot-event-normal .tot-event-icon { color: rgba(196, 181, 253, 0.7); }

.tot-event-more {
  padding: 4px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.tot-empty {
  padding: 8px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

/* 错误信息 */
.tot-section-error {
  background: rgba(248, 113, 113, 0.05);
  margin: 4px -12px;
  padding: 6px 12px;
}
.tot-error-text {
  font-size: 10px;
  color: rgb(252, 165, 165);
  word-break: break-all;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
</style>
