<template>
  <div v-if="sessionId && sessionState" class="rtr-status-bar" :class="`rtr-level-${level}`">
    <!-- 紧凑视图 -->
    <button
      class="rtr-summary-btn"
      :title="summaryTitle"
      @click="togglePopover"
    >
      <span class="rtr-dot" :class="`rtr-dot-${level}`"></span>
      <WsIcon name="map" size="xs" class="rtr-icon" />
      <span class="rtr-label">RTR</span>
      <span class="rtr-summary">{{ summaryText }}</span>
      <!-- 决策目标徽章 -->
      <span v-if="sessionState.decidedTargetName" class="rtr-badge" :class="{ 'rtr-badge-fallback': sessionState.isFallback }">
        {{ sessionState.decidedTargetName }}
      </span>
      <WsIcon
        :name="popoverOpen ? 'chevron-down' : 'chevron-right'"
        size="xs"
        class="rtr-expand-icon"
      />
    </button>

    <!-- 中断按钮（仅 running 时显示） -->
    <button
      v-if="sessionState.runStatus === 'running'"
      class="rtr-action-btn"
      title="中断当前路由决策（协作式，需等当前 LLM 调用返回）"
      :disabled="aborting"
      @click="onAbort"
    >
      <WsIcon :name="aborting ? 'loading' : 'x'" size="xs" />
    </button>

    <!-- 刷新状态按钮 -->
    <button
      class="rtr-action-btn"
      title="手动刷新编排状态快照"
      :disabled="refreshing"
      @click="onRefreshState"
    >
      <WsIcon :name="refreshing ? 'loading' : 'refresh'" size="xs" />
    </button>

    <!-- Popover 浮层 -->
    <div v-if="popoverOpen" class="rtr-popover" @click.stop>
      <div class="rtr-popover-header">
        <span class="rtr-popover-title">Router 路由决策详情</span>
        <button class="rtr-popover-close" @click="popoverOpen = false" title="关闭">
          <WsIcon name="x" size="xs" />
        </button>
      </div>

      <div class="rtr-popover-body">
        <!-- 任务基本信息 -->
        <section class="rtr-section">
          <div class="rtr-section-title">输入</div>
          <div class="rtr-task-id" :title="sessionId">{{ shortSessionId }}</div>
          <div v-if="sessionState.currentTask" class="rtr-task-text">
            {{ sessionState.currentTask }}
          </div>
        </section>

        <!-- 路由决策结果 -->
        <section class="rtr-section">
          <div class="rtr-section-title">路由决策</div>
          <div class="rtr-counter-grid">
            <div class="rtr-counter-item">
              <span class="rtr-counter-label">状态</span>
              <span class="rtr-counter-value" :class="`rtr-status-${sessionState.runStatus}`">
                {{ formatRunStatus(sessionState.runStatus) }}
              </span>
            </div>
            <div class="rtr-counter-item">
              <span class="rtr-counter-label">决策目标</span>
              <span class="rtr-counter-value">
                {{ sessionState.decidedTargetName ?? '—' }}
              </span>
            </div>
            <div class="rtr-counter-item">
              <span class="rtr-counter-label">Fallback</span>
              <span class="rtr-counter-value">
                {{ sessionState.isFallback ? '是' : '否' }}
              </span>
            </div>
            <div class="rtr-counter-item">
              <span class="rtr-counter-label">错误阶段</span>
              <span class="rtr-counter-value">
                {{ sessionState.errorStage ?? '—' }}
              </span>
            </div>
          </div>
        </section>

        <!-- 决策理由（若 LLM 策略提供了 reason） -->
        <section
          v-if="sessionState.decisionReason"
          class="rtr-section rtr-section-reasoning"
        >
          <div class="rtr-section-title">决策理由</div>
          <div class="rtr-reasoning-text">{{ sessionState.decisionReason }}</div>
        </section>

        <!-- 无匹配输入（routerNoMatch 时） -->
        <section
          v-if="sessionState.noMatchInputSample"
          class="rtr-section rtr-section-nomatch"
        >
          <div class="rtr-section-title">无匹配输入</div>
          <div class="rtr-nomatch-text">{{ sessionState.noMatchInputSample }}</div>
        </section>

        <!-- 候选目标列表（targetsSnapshot） -->
        <section v-if="targetsList.length > 0" class="rtr-section">
          <div class="rtr-section-title">
            候选目标
            <span class="rtr-section-meta">({{ targetsList.length }} 个分支)</span>
          </div>
          <div class="rtr-target-list">
            <div
              v-for="target in targetsList"
              :key="target.id"
              class="rtr-target-item"
              :class="{
                'rtr-target-active': sessionState.decidedTargetId === target.id,
                'rtr-target-fallback': isFallbackTarget(target.id),
              }"
            >
              <WsIcon
                :name="getTargetIcon(target.id)"
                size="xs"
                class="rtr-target-icon"
              />
              <div class="rtr-target-info">
                <div class="rtr-target-name-row">
                  <span class="rtr-target-name">{{ target.name }}</span>
                  <span v-if="sessionState.decidedTargetId === target.id" class="rtr-target-tag rtr-target-tag-selected">已选</span>
                  <span v-if="isFallbackTarget(target.id)" class="rtr-target-tag rtr-target-tag-fallback">fallback</span>
                </div>
                <div class="rtr-target-desc">{{ target.description }}</div>
                <div v-if="target.keywords && target.keywords.length > 0" class="rtr-target-keywords">
                  <span v-for="kw in target.keywords" :key="kw" class="rtr-keyword">{{ kw }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 最终摘要（runStatus=done 且 lastResult.summary 存在时显示） -->
        <section v-if="finalSummary" class="rtr-section rtr-section-summary">
          <div class="rtr-section-title">最终摘要</div>
          <div class="rtr-summary-content">{{ finalSummary }}</div>
        </section>

        <!-- 事件历史 -->
        <section class="rtr-section">
          <div class="rtr-section-title">
            事件历史
            <span class="rtr-section-meta">({{ sessionState.events.length }} 条)</span>
          </div>
          <div v-if="sessionState.events.length === 0" class="rtr-empty">暂无事件</div>
          <div v-else class="rtr-event-list">
            <div
              v-for="(evt, idx) in recentEvents"
              :key="idx"
              class="rtr-event-item"
              :class="`rtr-event-${getEventLevel(evt.type)}`"
            >
              <WsIcon :name="getEventIcon(evt.type)" size="xs" class="rtr-event-icon" />
              <span class="rtr-event-text">{{ formatEvent(evt) }}</span>
            </div>
            <div
              v-if="sessionState.events.length > recentEvents.length"
              class="rtr-event-more"
            >... 还有 {{ sessionState.events.length - recentEvents.length }} 条</div>
          </div>
        </section>

        <!-- 错误信息 -->
        <section v-if="sessionState.lastError" class="rtr-section rtr-section-error">
          <div class="rtr-section-title">
            最近错误
            <span v-if="sessionState.errorStage" class="rtr-section-meta">
              (阶段: {{ sessionState.errorStage }})
            </span>
          </div>
          <div class="rtr-error-text">{{ sessionState.lastError }}</div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useRouterRust, type RouterEvent, type RustRouteTarget } from '../composables/useRouterRust'

const props = defineProps<{
  /**
   * Router 会话 ID
   *
   * 由父组件管理生命周期（create/destroy）。
   * 当 sessionId 非空且对应会话存在于 useRouterRust().sessions 时显示。
   */
  sessionId: string | null
}>()

const {
  sessions,
  abort: abortSession,
  getState,
  subscribe,
} = useRouterRust()

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
  if (s.decidedTargetName) {
    parts.push(s.decidedTargetName)
    if (s.isFallback) parts.push('fallback')
  }
  if (s.runStatus === 'running') {
    parts.push('决策中')
  } else if (s.runStatus === 'done') {
    if (!s.decidedTargetName) parts.push('已完成')
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
  if (!s) return 'Router 状态加载中'
  const lines = [
    `会话: ${props.sessionId}`,
    `状态: ${formatRunStatus(s.runStatus)}`,
  ]
  if (s.decidedTargetName) {
    lines.push(`决策目标: ${s.decidedTargetName}${s.isFallback ? ' (fallback)' : ''}`)
  }
  if (s.decisionReason) lines.push(`决策理由: ${s.decisionReason}`)
  if (s.noMatchInputSample) lines.push(`无匹配输入: ${s.noMatchInputSample}`)
  if (s.errorStage) lines.push(`错误阶段: ${s.errorStage}`)
  if (s.lastResult?.summary) lines.push(`摘要: ${s.lastResult.summary}`)
  if (s.lastError) lines.push(`错误: ${s.lastError}`)
  return lines.join('\n')
})

/** 短会话 ID（router_{timestamp}_{random} → router_..._random） */
const shortSessionId = computed(() => {
  if (!props.sessionId) return ''
  const sid = props.sessionId
  if (sid.length <= 24) return sid
  return `${sid.slice(0, 10)}...${sid.slice(-8)}`
})

/** 候选目标列表（从 targetsSnapshot 读取） */
const targetsList = computed<RustRouteTarget[]>(() => {
  return sessionState.value?.targetsSnapshot ?? []
})

/** 最终摘要（runStatus=done 且 lastResult.summary 存在时） */
const finalSummary = computed(() => {
  const s = sessionState.value
  if (!s || s.runStatus !== 'done') return null
  return s.lastResult?.summary ?? null
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
    console.error('[RouterStatusBar] 中断失败:', err)
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
    console.error('[RouterStatusBar] 刷新状态失败:', err)
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

// ─── 辅助方法 ────────────────────────────────────────────

/**
 * 判断目标是否为 fallback 目标
 * 通过比对 lastResult 中的 nextNodeId 或 decidedTargetId 来确定
 * 这里简化：只在 isFallback=true 且 id 匹配 decidedTargetId 时返回 true
 */
function isFallbackTarget(targetId: string): boolean {
  const s = sessionState.value
  if (!s || !s.isFallback) return false
  return s.decidedTargetId === targetId
}

/** 获取目标列表中某项的图标（选中/未选中） */
function getTargetIcon(targetId: string): string {
  const s = sessionState.value
  if (s?.decidedTargetId === targetId) return 'check-circle'
  if (isFallbackTarget(targetId)) return 'alert'
  return 'arrow-right'
}

// ─── 格式化工具 ────────────────────────────────────────────

function formatRunStatus(status: string): string {
  switch (status) {
    case 'idle': return '空闲'
    case 'running': return '决策中'
    case 'done': return '已完成'
    case 'aborted': return '已中断'
    case 'error': return '出错'
    default: return status
  }
}

function getEventLevel(type: RouterEvent['type']): 'normal' | 'info' | 'success' | 'warning' | 'critical' {
  switch (type) {
    case 'routerDecisionMade':
      return 'success'
    case 'routerError':
      return 'critical'
    case 'routerNoMatch':
      return 'warning'
    default:
      return 'normal'
  }
}

function getEventIcon(type: RouterEvent['type']): string {
  switch (type) {
    case 'routerDecisionMade': return 'check-circle'
    case 'routerNoMatch': return 'alert'
    case 'routerError': return 'alert'
    default: return 'info'
  }
}

function formatEvent(evt: RouterEvent): string {
  switch (evt.type) {
    case 'routerDecisionMade':
      return `路由到 ${evt.targetName}${evt.isFallback ? ' (fallback)' : ''}: ${truncate(evt.reason ?? '无理由', 40)}`
    case 'routerNoMatch':
      return `无匹配路由（输入: ${truncate(evt.inputSample, 40)}）`
    case 'routerError':
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
/* RouterStatusBar：路由决策状态面板（紧凑 + Popover）
 * 配色用 rose/pink 系（rgba(236, 72, 153)），区分于 ToT/GoT 紫色系、MA 青色系、SUP 橙色系
 * 图标用 map，表达"输入 → 决策 → 分支"的路由语义 */
.rtr-status-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: rgba(236, 72, 153, 0.06);
  border-top: 1px solid rgba(236, 72, 153, 0.15);
  border-bottom: 1px solid rgba(236, 72, 153, 0.15);
  font-size: 12px;
  color: var(--ws-text-primary, #2c2c2c);
}

.rtr-summary-btn {
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

.rtr-summary-btn:hover {
  background: rgba(236, 72, 153, 0.1);
}

.rtr-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  flex-shrink: 0;
}

.rtr-dot-idle { background: #9ca3af; }
.rtr-dot-running {
  background: #ec4899;
  box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.25);
  animation: rtr-pulse 1.5s ease-in-out infinite;
}
.rtr-dot-done { background: #10b981; }
.rtr-dot-aborted { background: #6b7280; }
.rtr-dot-error { background: #ef4444; }

@keyframes rtr-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.25); }
  50% { box-shadow: 0 0 0 4px rgba(236, 72, 153, 0.4); }
}

.rtr-icon {
  color: #ec4899;
}

.rtr-label {
  font-weight: 600;
  font-size: 11px;
  color: #ec4899;
  letter-spacing: 0.5px;
}

.rtr-summary {
  color: var(--ws-text-secondary, #6b7280);
  font-size: 11px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rtr-badge {
  padding: 1px 6px;
  background: rgba(236, 72, 153, 0.15);
  color: #be185d;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rtr-badge-fallback {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}

.rtr-expand-icon {
  color: var(--ws-text-tertiary, #9ca3af);
}

.rtr-action-btn {
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

.rtr-action-btn:hover:not(:disabled) {
  background: rgba(236, 72, 153, 0.1);
  color: #ec4899;
}

.rtr-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Popover */
.rtr-popover {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 12px;
  width: 420px;
  max-height: 480px;
  overflow-y: auto;
  background: var(--ws-bg-primary, #ffffff);
  border: 1px solid rgba(236, 72, 153, 0.2);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 100;
}

.rtr-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(236, 72, 153, 0.08);
  border-bottom: 1px solid rgba(236, 72, 153, 0.15);
}

.rtr-popover-title {
  font-weight: 600;
  font-size: 12px;
  color: #be185d;
}

.rtr-popover-close {
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

.rtr-popover-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--ws-text-primary, #2c2c2c);
}

.rtr-popover-body {
  padding: 8px 12px;
}

.rtr-section {
  padding: 8px 0;
  border-bottom: 1px solid var(--ws-border-light, rgba(0, 0, 0, 0.06));
}

.rtr-section:last-child {
  border-bottom: none;
}

.rtr-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-text-tertiary, #9ca3af);
  letter-spacing: 0.3px;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.rtr-section-meta {
  font-weight: 400;
  color: var(--ws-text-tertiary, #9ca3af);
  text-transform: none;
  letter-spacing: normal;
}

.rtr-task-id {
  font-family: monospace;
  font-size: 11px;
  color: var(--ws-text-tertiary, #9ca3af);
}

.rtr-task-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-text-primary, #2c2c2c);
  line-height: 1.5;
}

.rtr-counter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.rtr-counter-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rtr-counter-label {
  font-size: 10px;
  color: var(--ws-text-tertiary, #9ca3af);
}

.rtr-counter-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-primary, #2c2c2c);
}

.rtr-status-idle { color: #6b7280; }
.rtr-status-running { color: #ec4899; }
.rtr-status-done { color: #10b981; }
.rtr-status-aborted { color: #6b7280; }
.rtr-status-error { color: #ef4444; }

.rtr-section-reasoning .rtr-reasoning-text,
.rtr-section-summary .rtr-summary-content {
  font-size: 12px;
  color: var(--ws-text-primary, #2c2c2c);
  line-height: 1.5;
  padding: 6px 8px;
  background: rgba(236, 72, 153, 0.05);
  border-left: 2px solid #ec4899;
  border-radius: 0 4px 4px 0;
}

.rtr-section-nomatch .rtr-nomatch-text {
  font-size: 12px;
  color: #b45309;
  padding: 6px 8px;
  background: rgba(245, 158, 11, 0.05);
  border-left: 2px solid #f59e0b;
  border-radius: 0 4px 4px 0;
  line-height: 1.5;
  word-break: break-word;
}

/* 候选目标列表 */
.rtr-target-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rtr-target-item {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
  border: 1px solid transparent;
  transition: all 0.15s;
}

.rtr-target-active {
  background: rgba(236, 72, 153, 0.08);
  border-color: rgba(236, 72, 153, 0.3);
}

.rtr-target-fallback {
  background: rgba(245, 158, 11, 0.06);
  border-color: rgba(245, 158, 11, 0.25);
}

.rtr-target-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--ws-text-tertiary, #9ca3af);
}

.rtr-target-active .rtr-target-icon {
  color: #ec4899;
}

.rtr-target-fallback .rtr-target-icon {
  color: #f59e0b;
}

.rtr-target-info {
  flex: 1;
  min-width: 0;
}

.rtr-target-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.rtr-target-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-primary, #2c2c2c);
}

.rtr-target-tag {
  padding: 0 6px;
  font-size: 9px;
  font-weight: 600;
  border-radius: 6px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.rtr-target-tag-selected {
  background: rgba(236, 72, 153, 0.15);
  color: #be185d;
}

.rtr-target-tag-fallback {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}

.rtr-target-desc {
  font-size: 11px;
  color: var(--ws-text-secondary, #6b7280);
  line-height: 1.4;
  margin-bottom: 4px;
}

.rtr-target-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.rtr-keyword {
  padding: 1px 6px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--ws-text-tertiary, #9ca3af);
  border-radius: 8px;
}

.rtr-empty {
  font-size: 11px;
  color: var(--ws-text-tertiary, #9ca3af);
  padding: 4px 0;
}

.rtr-event-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 200px;
  overflow-y: auto;
}

.rtr-event-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 3px 4px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.4;
}

.rtr-event-normal { color: var(--ws-text-secondary, #6b7280); }
.rtr-event-info { color: #3b82f6; background: rgba(59, 130, 246, 0.05); }
.rtr-event-success { color: #10b981; background: rgba(16, 185, 129, 0.05); }
.rtr-event-warning { color: #f59e0b; background: rgba(245, 158, 11, 0.05); }
.rtr-event-critical { color: #ef4444; background: rgba(239, 68, 68, 0.05); }

.rtr-event-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.rtr-event-text {
  word-break: break-word;
}

.rtr-event-more {
  margin-top: 4px;
  font-size: 10px;
  color: var(--ws-text-tertiary, #9ca3af);
  text-align: center;
}

.rtr-section-error .rtr-error-text {
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
  .rtr-popover {
    right: 4px;
    left: 4px;
    width: auto;
  }

  .rtr-counter-grid {
    grid-template-columns: 1fr;
  }

  .rtr-summary {
    max-width: 120px;
  }
}
</style>
