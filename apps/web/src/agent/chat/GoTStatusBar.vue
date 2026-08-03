<template>
  <div v-if="sessionId && sessionState" class="got-status-bar" :class="`got-level-${level}`">
    <!-- 紧凑视图 -->
    <button
      class="got-summary-btn"
      :title="summaryTitle"
      @click="togglePopover"
    >
      <span class="got-dot" :class="`got-dot-${level}`"></span>
      <WsIcon name="git-merge" size="xs" class="got-icon" />
      <span class="got-label">GoT</span>
      <span class="got-summary">{{ summaryText }}</span>
      <!-- 节点数徽章 -->
      <span v-if="sessionState.nodesCreated > 0" class="got-badge">
        {{ sessionState.nodesCreated }}
      </span>
      <WsIcon
        :name="popoverOpen ? 'chevron-down' : 'chevron-right'"
        size="xs"
        class="got-expand-icon"
      />
    </button>

    <!-- 中断按钮（仅 running 时显示） -->
    <button
      v-if="sessionState.runStatus === 'running'"
      class="got-action-btn"
      title="中断当前 GoT 探索（协作式，需等当前层 LLM 调用完成）"
      :disabled="aborting"
      @click="onAbort"
    >
      <WsIcon :name="aborting ? 'loading' : 'x'" size="xs" />
    </button>

    <!-- 刷新图按钮 -->
    <button
      class="got-action-btn"
      title="手动刷新思维图快照"
      :disabled="refreshing"
      @click="onRefreshGraph"
    >
      <WsIcon :name="refreshing ? 'loading' : 'refresh'" size="xs" />
    </button>

    <!-- Popover 浮层 -->
    <div v-if="popoverOpen" class="got-popover" @click.stop>
      <div class="got-popover-header">
        <span class="got-popover-title">Graph of Thoughts 详情</span>
        <button class="got-popover-close" @click="popoverOpen = false" title="关闭">
          <WsIcon name="x" size="xs" />
        </button>
      </div>

      <div class="got-popover-body">
        <!-- 任务基本信息 -->
        <section class="got-section">
          <div class="got-section-title">任务</div>
          <div class="got-task-id" :title="sessionId">{{ shortSessionId }}</div>
          <div v-if="sessionState.currentTask" class="got-task-text">
            {{ sessionState.currentTask }}
          </div>
        </section>

        <!-- 探索进度 -->
        <section class="got-section">
          <div class="got-section-title">探索进度</div>
          <div class="got-counter-grid">
            <div class="got-counter-item">
              <span class="got-counter-label">状态</span>
              <span class="got-counter-value" :class="`got-status-${sessionState.runStatus}`">
                {{ formatRunStatus(sessionState.runStatus) }}
              </span>
            </div>
            <div class="got-counter-item">
              <span class="got-counter-label">节点</span>
              <span class="got-counter-value">{{ sessionState.nodesCreated }}</span>
            </div>
            <div class="got-counter-item">
              <span class="got-counter-label">已评分</span>
              <span class="got-counter-value">{{ sessionState.nodesScored }}</span>
            </div>
            <div class="got-counter-item">
              <span class="got-counter-label">分支</span>
              <span class="got-counter-value">{{ sessionState.branchesExplored }}</span>
            </div>
            <div class="got-counter-item">
              <span class="got-counter-label">最大深度</span>
              <span class="got-counter-value">{{ sessionState.currentMaxDepth }}</span>
            </div>
            <!-- GoT 专用：聚合次数 -->
            <div class="got-counter-item got-counter-agg">
              <span class="got-counter-label">聚合</span>
              <span class="got-counter-value">{{ sessionState.aggregationsPerformed }}</span>
            </div>
            <div v-if="sessionState.bestScore !== null" class="got-counter-item">
              <span class="got-counter-label">最优分</span>
              <span class="got-counter-value got-score-high">{{ sessionState.bestScore }}</span>
            </div>
          </div>
        </section>

        <!-- 最优思维 -->
        <section v-if="sessionState.bestThoughtContent" class="got-section got-section-best">
          <div class="got-section-title">
            最优思维
            <span v-if="sessionState.terminationReason" class="got-section-meta">
              ({{ formatTerminationReason(sessionState.terminationReason) }})
            </span>
          </div>
          <div class="got-best-content">{{ sessionState.bestThoughtContent }}</div>
        </section>

        <!-- 思维图可视化（内嵌 GoTGraphView） -->
        <section class="got-section got-section-graph">
          <div class="got-section-title">
            思维图
            <span class="got-section-meta">
              ({{ graphSnapshot?.totalCount ?? 0 }} 节点)
            </span>
          </div>
          <GoTGraphView :session-id="sessionId" />
        </section>

        <!-- 事件历史 -->
        <section class="got-section">
          <div class="got-section-title">
            事件历史
            <span class="got-section-meta">({{ sessionState.events.length }} 条)</span>
          </div>
          <div v-if="sessionState.events.length === 0" class="got-empty">暂无事件</div>
          <div v-else class="got-event-list">
            <div
              v-for="(evt, idx) in recentEvents"
              :key="idx"
              class="got-event-item"
              :class="`got-event-${getEventLevel(evt.type)}`"
            >
              <WsIcon :name="getEventIcon(evt.type)" size="xs" class="got-event-icon" />
              <span class="got-event-text">{{ formatEvent(evt) }}</span>
            </div>
            <div
              v-if="sessionState.events.length > recentEvents.length"
              class="got-event-more"
            >... 还有 {{ sessionState.events.length - recentEvents.length }} 条</div>
          </div>
        </section>

        <!-- 错误信息 -->
        <section v-if="sessionState.lastError" class="got-section got-section-error">
          <div class="got-section-title">
            最近错误
            <span v-if="sessionState.errorStage" class="got-section-meta">
              ({{ sessionState.errorStage }})
            </span>
          </div>
          <div class="got-error-text">{{ sessionState.lastError }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import GoTGraphView from './GoTGraphView.vue'
import { useGoTRust, type GoTEvent } from '../composables/useGoTRust'

const props = defineProps<{
  /**
   * GoT 会话 ID
   *
   * 由父组件管理生命周期（create/destroy）。
   * 当 sessionId 非空且对应会话存在于 useGoTRust().sessions 时显示。
   */
  sessionId: string | null
}>()

const {
  sessions,
  abort: abortSession,
  getTree,
  subscribe,
} = useGoTRust()

/** Popover 展开/收起状态 */
const popoverOpen = ref(false)

/** 中断中标志 */
const aborting = ref(false)

/** 刷新图中标志 */
const refreshing = ref(false)

/** 强制刷新触发器（事件订阅时自增，驱动 computed 重新计算） */
const refreshTick = ref(0)

/** 当前会话状态（响应式，来自模块级 Map） */
const sessionState = computed(() => {
  void refreshTick.value
  if (!props.sessionId) return null
  return sessions.value.get(props.sessionId) ?? null
})

/** 思维图快照（从 sessionState 读取，由 getTree 自动填充） */
const graphSnapshot = computed(() => sessionState.value?.graphSnapshot ?? null)

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
  if (s.aggregationsPerformed > 0) {
    parts.push(`聚合 ${s.aggregationsPerformed}`)
  }
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
  if (!s) return 'GoT 状态加载中'
  const lines = [
    `会话: ${props.sessionId}`,
    `状态: ${formatRunStatus(s.runStatus)}`,
    `节点: ${s.nodesCreated} (已评分 ${s.nodesScored})`,
    `分支: ${s.branchesExplored}`,
    `聚合: ${s.aggregationsPerformed}`,
    `最大深度: ${s.currentMaxDepth}`,
  ]
  if (s.bestScore !== null) lines.push(`最优评分: ${s.bestScore}`)
  if (s.terminationReason) lines.push(`终止原因: ${formatTerminationReason(s.terminationReason)}`)
  if (s.lastError) lines.push(`错误: ${s.lastError}`)
  return lines.join('\n')
})

/** 短会话 ID（got_{timestamp}_{random} → got_..._random） */
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
    console.error('[GoTStatusBar] 中断失败:', err)
  } finally {
    aborting.value = false
  }
}

async function onRefreshGraph(): Promise<void> {
  if (!props.sessionId || refreshing.value) return
  refreshing.value = true
  try {
    await getTree(props.sessionId)
    refreshTick.value += 1
  } catch (err) {
    console.error('[GoTStatusBar] 刷新思维图失败:', err)
  } finally {
    refreshing.value = false
  }
}

function togglePopover(): void {
  popoverOpen.value = !popoverOpen.value
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

function getEventLevel(type: GoTEvent['type']): 'normal' | 'info' | 'success' | 'warning' | 'critical' {
  switch (type) {
    case 'totGoalReached':
      return 'success'
    case 'totError':
      return 'critical'
    case 'totTerminated':
      return 'info'
    case 'thoughtsAggregated':
      return 'warning' // GoT 专用：聚合事件用 warning 级别区分
    case 'thoughtNodeCreated':
    case 'thoughtNodeScored':
    case 'thoughtBranchExplored':
    default:
      return 'normal'
  }
}

function getEventIcon(type: GoTEvent['type']): string {
  switch (type) {
    case 'thoughtNodeCreated': return 'plus-circle'
    case 'thoughtNodeScored': return 'check-circle'
    case 'thoughtBranchExplored': return 'git-branch'
    case 'thoughtsAggregated': return 'git-merge' // GoT 专用聚合图标
    case 'totGoalReached': return 'target'
    case 'totTerminated': return 'flag'
    case 'totError': return 'alert'
    default: return 'info'
  }
}

function formatEvent(evt: GoTEvent): string {
  switch (evt.type) {
    case 'thoughtNodeCreated':
      return `[d${evt.depth}] 新思维: ${truncate(evt.contentPreview, 40)}`
    case 'thoughtNodeScored':
      return `[评分 ${evt.score}] ${truncate(evt.reasoning ?? '', 40) || '无理由'}`
    case 'thoughtBranchExplored':
      return `[d${evt.depth}] 扩展: 保留 ${evt.keptCount}/${evt.childCount} 子节点`
    case 'thoughtsAggregated':
      // GoT 专用：聚合事件展示源节点数
      return `[d${evt.depth}] 聚合: 融合 ${evt.sourceIds.length} 个节点`
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
/* GoTStatusBar：Graph of Thoughts 状态面板（紧凑 + Popover）
 * 配色与 ToTStatusBar 一致，仅图标/标签改为 git-merge/GoT 区分 */
.got-status-bar {
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

.got-level-running {
  background: rgba(96, 165, 250, 0.08);
  border-top-color: rgba(96, 165, 250, 0.25);
  color: rgba(219, 234, 254, 0.9);
}
.got-level-done {
  background: rgba(52, 211, 153, 0.06);
  border-top-color: rgba(52, 211, 153, 0.2);
  color: rgba(209, 250, 229, 0.9);
}
.got-level-aborted {
  background: rgba(251, 191, 36, 0.06);
  border-top-color: rgba(251, 191, 36, 0.2);
  color: rgba(254, 243, 199, 0.9);
}
.got-level-error {
  background: rgba(248, 113, 113, 0.08);
  border-top-color: rgba(248, 113, 113, 0.25);
  color: rgba(254, 226, 226, 0.9);
}

.got-summary-btn {
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
.got-summary-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.got-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.got-dot-idle { background: rgb(156, 163, 175); }
.got-dot-running {
  background: rgb(96, 165, 250);
  box-shadow: 0 0 4px rgba(96, 165, 250, 0.5);
  animation: got-blink 1.4s ease-in-out infinite;
}
.got-dot-done { background: rgb(52, 211, 153); box-shadow: 0 0 4px rgba(52, 211, 153, 0.5); }
.got-dot-aborted { background: rgb(251, 191, 36); }
.got-dot-error { background: rgb(248, 113, 113); box-shadow: 0 0 4px rgba(248, 113, 113, 0.5); }
@keyframes got-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.got-icon { color: rgba(196, 181, 253, 0.7); }
.got-level-running .got-icon { color: rgba(147, 197, 253, 0.8); }
.got-level-done .got-icon { color: rgba(110, 231, 183, 0.8); }
.got-level-aborted .got-icon { color: rgba(252, 211, 77, 0.8); }
.got-level-error .got-icon { color: rgba(252, 165, 165, 0.85); }

.got-label {
  font-weight: 600;
  color: rgb(196, 181, 253);
}
.got-level-running .got-label { color: rgb(147, 197, 253); }
.got-level-done .got-label { color: rgb(110, 231, 183); }
.got-level-aborted .got-label { color: rgb(252, 211, 77); }
.got-level-error .got-label { color: rgb(252, 165, 165); }

.got-summary {
  font-variant-numeric: tabular-nums;
  color: rgba(233, 213, 255, 0.85);
}
.got-level-running .got-summary { color: rgba(219, 234, 254, 0.85); }
.got-level-done .got-summary { color: rgba(209, 250, 229, 0.85); }
.got-level-aborted .got-summary { color: rgba(254, 243, 199, 0.85); }
.got-level-error .got-summary { color: rgba(254, 226, 226, 0.85); }

.got-badge {
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
.got-level-running .got-badge { background: rgba(96, 165, 250, 0.7); }
.got-level-done .got-badge { background: rgba(52, 211, 153, 0.7); }
.got-level-error .got-badge { background: rgba(248, 113, 113, 0.7); }

.got-expand-icon {
  color: rgba(196, 181, 253, 0.5);
  transition: transform 0.15s;
}

.got-action-btn {
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
.got-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(196, 181, 253, 0.9);
}
.got-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.got-popover {
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

.got-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  background: rgba(31, 41, 55, 0.6);
}
.got-popover-title {
  font-weight: 600;
  color: rgb(199, 210, 254);
}
.got-popover-close {
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
.got-popover-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgb(248, 113, 113);
}

.got-popover-body {
  overflow-y: auto;
  padding: 8px 12px;
}

.got-section {
  padding: 6px 0;
  border-bottom: 1px solid rgba(75, 85, 99, 0.2);
}
.got-section:last-child { border-bottom: none; }
.got-section-title {
  font-size: 10px;
  font-weight: 600;
  color: rgba(156, 163, 175, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.got-section-meta {
  font-weight: 400;
  text-transform: none;
  color: rgba(156, 163, 175, 0.6);
}

.got-task-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 10px;
  color: rgba(199, 210, 254, 0.85);
  word-break: break-all;
}
.got-task-text {
  margin-top: 4px;
  padding: 4px 6px;
  background: rgba(168, 85, 247, 0.06);
  border-left: 2px solid rgba(168, 85, 247, 0.4);
  border-radius: 2px;
  font-size: 11px;
  color: rgba(233, 213, 255, 0.9);
  line-height: 1.4;
}

.got-counter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 12px;
}
.got-counter-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.got-counter-label {
  color: rgba(156, 163, 175, 0.8);
  min-width: 60px;
}
.got-counter-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: rgb(229, 231, 235);
}
.got-counter-agg .got-counter-value {
  color: rgb(196, 181, 253);
}
.got-status-idle { color: rgb(156, 163, 175); }
.got-status-running { color: rgb(147, 197, 253); }
.got-status-done { color: rgb(110, 231, 183); }
.got-status-aborted { color: rgb(252, 211, 77); }
.got-status-error { color: rgb(252, 165, 165); }
.got-score-high { color: rgb(110, 231, 183); }

.got-section-best {
  background: rgba(252, 211, 77, 0.04);
  margin: 4px -12px;
  padding: 6px 12px;
}
.got-best-content {
  font-size: 11px;
  line-height: 1.5;
  color: rgb(252, 211, 77);
  background: rgba(252, 211, 77, 0.06);
  padding: 6px 8px;
  border-radius: 3px;
  border-left: 2px solid rgba(252, 211, 77, 0.5);
  word-break: break-word;
}

.got-section-graph {
  background: rgba(31, 41, 55, 0.3);
  margin: 4px -12px;
  padding: 6px 12px;
}

.got-event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.got-event-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  line-height: 1.4;
}
.got-event-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
.got-event-text {
  word-break: break-all;
  color: rgba(229, 231, 235, 0.85);
}
.got-event-success .got-event-icon { color: rgb(110, 231, 183); }
.got-event-critical .got-event-icon { color: rgb(252, 165, 165); }
.got-event-info .got-event-icon { color: rgb(147, 197, 253); }
.got-event-warning .got-event-icon { color: rgb(196, 181, 253); }
.got-event-normal .got-event-icon { color: rgba(196, 181, 253, 0.7); }

.got-event-more {
  padding: 4px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.got-empty {
  padding: 8px;
  text-align: center;
  font-size: 10px;
  color: rgba(156, 163, 175, 0.6);
  font-style: italic;
}

.got-section-error {
  background: rgba(248, 113, 113, 0.05);
  margin: 4px -12px;
  padding: 6px 12px;
}
.got-error-text {
  font-size: 10px;
  color: rgb(252, 165, 165);
  word-break: break-all;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
</style>
