<template>
  <Transition name="ws-fade">
    <div
      v-if="previewVisible && (toolCalls.length > 0 || hasA2UISurfaces)"
      class="agent-preview agent-panel"
      @click="handlePreviewClick"
      :style="panelStyle"
    >
      <div class="preview-header" @mousedown.left="onDragStart">
        <span class="status-dot" :class="{ active: isProcessing }">●</span>
        <span class="status-text">{{ isProcessing ? '运行中' : '已完成' }}</span>
        <span class="tool-count" v-if="toolCalls.length">{{ toolCalls.length }} 项调用</span>
        <button class="preview-close" @click="closePreview">✕</button>
      </div>
      <div class="preview-body">
        <div v-if="currentThinking" class="thinking-indicator">
          <WsIcon name="concept" size="xs" /> {{ currentThinking }}
        </div>
        <div v-if="hasA2UISurfaces" class="preview-a2ui">
          <A2UIRenderer
            :surfaces="a2uiSurfaces"
            :resolve-binding="resolveDataBinding"
            @action="onA2UIAction"
          />
        </div>
        <div v-if="activeTasks.length > 0" class="gen-section">
          <div class="gen-section-title">
            <WsIcon name="image" size="xs" /> 生成进度
          </div>
          <div
            v-for="task in activeTasks"
            :key="task.id"
            class="gen-card"
            :class="[`gen-${task.type}`]"
          >
            <div class="gen-card-header">
              <span class="gen-card-icon">{{ task.type === 'image' ? '🖼' : '🎬' }}</span>
              <span class="gen-card-label">{{ task.label }}</span>
              <span class="gen-card-model">{{ task.model }}</span>
            </div>
            <div class="gen-card-prompt">{{ task.prompt.length > 50 ? task.prompt.slice(0, 50) + '…' : task.prompt }}</div>
            <div class="gen-card-progress">
              <div class="gen-card-track">
                <div class="gen-card-fill" :style="{ width: task.progress + '%' }"></div>
              </div>
              <span class="gen-card-pct">{{ Math.round(task.progress) }}%</span>
            </div>
            <div class="gen-card-meta">
              <span>{{ task.status === 'polling' ? '轮询中' : task.status === 'generating' ? '生成中' : '等待中' }}</span>
              <span>{{ formatGenDuration(task) }}</span>
            </div>
          </div>
        </div>
        <div
          v-for="tc in runningToolCalls"
          :key="tc.id"
          class="tool-call-item"
          :class="[`tc-${tc.status}`]"
        >
          <div class="tc-header" @click="toggleTc(tc.id)">
            <span class="tc-icon"><WsIcon :name="'timeline'" size="xs" /></span>
            <span class="tc-name"><WsIcon :name="getToolIcon(tc.name)" size="xs" /> {{ getToolLabel(tc.name) }}</span>
            <span class="tc-time">{{ formatDuration(tc) }}</span>
            <span class="tc-toggle">{{ expandedTcs.has(tc.id) ? '▾' : '▸' }}</span>
          </div>
          <div class="tc-progress">
            <div class="progress-bar" :style="{ width: tc.progress + '%' }"></div>
          </div>
          <div v-if="isTcExpanded(tc)" class="tc-detail">
            <div v-if="Object.keys(tc.args).length" class="tc-args">
              <div class="tc-label">参数</div>
              <div class="tc-kv-list">
                <div v-for="(val, key) in tc.args" :key="String(key)" class="tc-kv-row">
                  <span class="tc-kv-key">{{ translateKey(String(key)) }}</span>
                  <span class="tc-kv-val">{{ formatVal(val) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="completedToolCalls.length" class="tc-completed-summary" @click="showCompleted = !showCompleted">
          <span class="tc-icon"><WsIcon name="check" size="xs" /></span>
          <span>{{ completedToolCalls.length }} 项调用已完成</span>
          <span class="tc-toggle">{{ showCompleted ? '▾' : '▸' }}</span>
        </div>
        <template v-if="showCompleted">
          <div
            v-for="tc in completedToolCalls"
            :key="tc.id"
            class="tool-call-item tc-completed"
          >
            <div class="tc-header" @click="toggleTc(tc.id)">
              <span class="tc-icon"><WsIcon :name="tc.status === 'failed' ? 'close' : 'check'" size="xs" /></span>
              <span class="tc-name"><WsIcon :name="getToolIcon(tc.name)" size="xs" /> {{ getToolLabel(tc.name) }}</span>
              <span class="tc-time">{{ formatDuration(tc) }}</span>
              <span class="tc-toggle">{{ expandedTcs.has(tc.id) ? '▾' : '▸' }}</span>
            </div>
            <div v-if="isTcExpanded(tc)" class="tc-detail">
              <div v-if="Object.keys(tc.args).length" class="tc-args">
                <div class="tc-label">参数</div>
                <div class="tc-kv-list">
                  <div v-for="(val, key) in tc.args" :key="String(key)" class="tc-kv-row">
                    <span class="tc-kv-key">{{ translateKey(String(key)) }}</span>
                    <span class="tc-kv-val">{{ formatVal(val) }}</span>
                  </div>
                </div>
              </div>
              <div v-if="tc.result" class="tc-result-block" v-html="sanitizeResult(tc.name, tc.result)"></div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAgentEvents } from './composables/useAgentEvents'
import { useAgent } from './composables/useAgent'
import { useGenerationProgress } from './composables/useGenerationProgress'
import { usePanelDrag } from './composables/usePanelDrag'
import { WsIcon } from '@worldsmith/ui-kit'
import A2UIRenderer from './a2ui/A2UIRenderer.vue'
import { getEventBus } from '@worldsmith/entity-core'
import { getToolLabel, getToolIcon, translateKey, formatVal } from './preview/previewLabels'
import { sanitizeResult } from './preview/resultRenderer'

defineProps<{ show: boolean }>()

const { toolCalls, isProcessing, currentThinking, removeEntityFromResults } = useAgentEvents()

function onEntityDeleted(payload: { entityId: string }): void {
  removeEntityFromResults(payload.entityId)
}

onMounted(() => {
  getEventBus().on('entity:delete', onEntityDeleted)
})

onUnmounted(() => {
  getEventBus().off('entity:delete', onEntityDeleted)
})

const runningToolCalls = computed(() => toolCalls.value.filter(tc => tc.status === 'running'))
const completedToolCalls = computed(() => toolCalls.value.filter(tc => tc.status !== 'running'))
const showCompleted = ref(false)
const { a2uiSurfaces, resolveDataBinding, sendMessage, steer, isStreaming, sendBlockAction } = useAgent()
const { activeTasks } = useGenerationProgress()

const hasA2UISurfaces = computed(() => Object.keys(a2uiSurfaces.value).length > 0)

// ---- 预览面板拖拽与显隐（复用 usePanelDrag） ----
const previewVisible = ref(true)
const panelX = ref(Math.max(0, window.innerWidth - 780))
const panelY = ref(200)

const panelStyle = computed(() => ({
  left: `${panelX.value}px`,
  top: `${panelY.value}px`,
}))

function closePreview(): void {
  previewVisible.value = false
}

const { onDragStart } = usePanelDrag({
  x: panelX,
  y: panelY,
  clampX: (x: number) => Math.max(0, Math.min(window.innerWidth - 100, x)),
  clampY: (y: number) => Math.max(0, Math.min(window.innerHeight - 60, y)),
  excludeSelector: '.preview-close',
})

// ---- 工具调用项展开/折叠状态 ----
const expandedTcs = ref<Set<string>>(new Set())
const autoExpanded = ref<Set<string>>(new Set())

watch(toolCalls, (val) => {
  if (val.length === 0) {
    autoExpanded.value = new Set()
    expandedTcs.value = new Set()
  } else {
    previewVisible.value = true
  }
})

function toggleTc(id: string): void {
  const next = new Set(expandedTcs.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedTcs.value = next
}

function isTcExpanded(tc: { id: string; status: string; result?: string }): boolean {
  if (expandedTcs.value.has(tc.id)) return true
  if (tc.status === 'running') return true
  if (tc.status === 'completed' && !autoExpanded.value.has(tc.id) && tc.result) {
    autoExpanded.value = new Set([...autoExpanded.value, tc.id])
    return true
  }
  return false
}

// ---- 预览面板点击委托：实体卡片展开 / 操作按钮 ----
function handlePreviewClick(e: MouseEvent): void {
  const target = e.target as HTMLElement

  const toggle = target.closest('.r-ec-toggle') as HTMLElement | null
  if (toggle) {
    const detailId = toggle.dataset.toggle
    if (!detailId) return
    const detail = document.getElementById(detailId)
    if (detail) {
      detail.classList.toggle('open')
      toggle.classList.toggle('open')
    }
    return
  }

  const actionBtn = target.closest('.r-ec-btn') as HTMLElement | null
  if (actionBtn) {
    const action = actionBtn.dataset.action
    const entityId = actionBtn.dataset.entityId
    if (action && entityId) {
      const steerText = action === 'view'
        ? `请展示实体详情，实体ID: ${entityId}`
        : `请编辑实体，实体ID: ${entityId}`
      sendBlockAction(steerText, action === 'view' ? `查看实体` : `编辑实体`)
    }
  }
}

// ---- A2UI 动作回调：根据流式状态选择 steer 或 sendMessage ----
function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  const dataStr = action.data ? JSON.stringify(action.data) : ''
  const steerText = dataStr
    ? `[A2UI Action] surface=${surfaceId} action=${action.name} data=${dataStr}`
    : `[A2UI Action] surface=${surfaceId} action=${action.name}`
  if (isStreaming.value) {
    steer(steerText)
  } else {
    sendMessage(steerText)
  }
}

// ---- 时长格式化 ----
function formatDuration(tc: { startedAt: number; endedAt?: number }): string {
  const end = tc.endedAt || Date.now()
  const ms = end - tc.startedAt
  if (ms < 1000) return `${ms}毫秒`
  return `${(ms / 1000).toFixed(1)}秒`
}

function formatGenDuration(task: { startedAt: number; endedAt?: number }): string {
  const end = task.endedAt || Date.now()
  const ms = end - task.startedAt
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
</script>

<style scoped>
.agent-preview {
  position: fixed;
  width: 340px;
  max-height: 480px;
  background: var(--agent-bg, rgba(26, 26, 46, 0.75));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 4px 20px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: clip;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  cursor: grab;
  user-select: none;
}

.preview-header:active { cursor: grabbing }

.status-dot {
  font-size: var(--font-size-xs);
  color: #666;
}

.status-dot.active {
  color: #4caf50;
  animation: ws-pulse 1.5s infinite;
}



.status-text {
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  font-family: var(--agent-font, sans-serif);
}

.tool-count {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #888);
  flex: 1;
  text-align: right;
}

.preview-close {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
  margin-left: 4px;
}

.preview-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
}

.thinking-indicator {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary, #aaa);
  margin-bottom: 8px;
}

.preview-a2ui {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.15));
}

.preview-a2ui :deep(.a2ui-surface) {
  background: transparent;
  border: none;
  padding: 0;
  box-shadow: none;
}

.tool-call-item {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.tool-call-item.tc-running {
  border-color: rgba(108, 92, 231, 0.3);
}

.tool-call-item.tc-completed {
  opacity: 0.7;
}

.tc-completed-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: rgba(34, 197, 94, 0.06);
  border: 1px solid rgba(34, 197, 94, 0.15);
  color: rgba(34, 197, 94, 0.8);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.tc-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.tc-icon { font-size: var(--font-size-sm); }
.tc-name { flex: 1; color: var(--agent-text, #e0e0e0); font-family: var(--agent-font, sans-serif); font-weight: var(--font-weight-medium); }
.tc-time { color: #888; font-size: var(--font-size-xs); }
.tc-toggle { font-size: var(--font-size-xs); color: var(--agent-text-tertiary, #666); }

.tc-progress {
  margin-top: 6px;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--agent-primary, #6c5ce7);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.tc-detail {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--agent-border, rgba(58, 58, 106, 0.15));
}

.tc-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  margin-bottom: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tc-kv-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tc-kv-row {
  display: flex;
  gap: 6px;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.tc-kv-key {
  color: #b388ff;
  min-width: 40px;
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
}

.tc-kv-val {
  color: #aaa;
  word-break: break-all;
}

.tc-result-block {
  margin-top: 6px;
}

:deep(.r-error) {
  background: rgba(255, 107, 107, 0.06);
  border-left: 3px solid #ff6b6b;
  border-radius: 0 6px 6px 0;
  padding: 8px 10px;
}

:deep(.r-error-msg) {
  font-size: var(--font-size-sm);
  color: #ff6b6b;
  font-weight: var(--font-weight-medium);
}

:deep(.r-hint) {
  font-size: var(--font-size-sm);
  color: #888;
  margin-top: 4px;
}

:deep(.r-success) {
  background: rgba(76, 175, 80, 0.06);
  border-left: 3px solid #4caf50;
  border-radius: 0 6px 6px 0;
  padding: 8px 10px;
}

:deep(.r-success-name) {
  font-size: var(--font-size-sm);
  color: #4caf50;
  font-weight: var(--font-weight-semibold);
}

:deep(.r-id) {
  font-size: var(--font-size-xs);
  color: #666;
  font-family: 'Consolas', 'Monaco', monospace;
  margin-top: 2px;
}

:deep(.r-summary) {
  font-size: var(--font-size-xs);
  color: #888;
  margin-bottom: 6px;
}

:deep(.r-entity-card) {
  background: rgba(108, 92, 231, 0.06);
  border: 1px solid rgba(108, 92, 231, 0.12);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 4px;
}

:deep(.r-ec-head) {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  cursor: pointer;
  user-select: none;
}

:deep(.r-ec-toggle) {
  font-size: 10px;
  color: var(--agent-accent, #b388ff);
  cursor: pointer;
  width: 14px;
  text-align: center;
  transition: transform 0.15s;
}

:deep(.r-ec-toggle.open) {
  transform: rotate(90deg);
}

:deep(.r-ec-detail) {
  display: none;
  padding-top: 4px;
  border-top: 1px solid rgba(108, 92, 231, 0.08);
  margin-top: 2px;
}

:deep(.r-ec-detail.open) {
  display: block;
}

:deep(.r-ec-spacer) {
  display: inline-block;
  width: 14px;
}

:deep(.r-ec-actions) {
  display: flex;
  gap: 8px;
  padding-top: 4px;
  margin-top: 2px;
  border-top: 1px solid rgba(108, 92, 231, 0.08);
}

:deep(.r-ec-btn) {
  font-size: 11px;
  color: var(--agent-accent, #b388ff);
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

:deep(.r-ec-btn:hover) {
  background: rgba(108, 92, 231, 0.12);
}

:deep(.r-ec-name) {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: #fff;
  flex: 1;
}

:deep(.r-ec-type) {
  font-size: var(--font-size-xs);
  background: rgba(108, 92, 231, 0.2);
  color: #b388ff;
  padding: 1px 6px;
  border-radius: 3px;
}

:deep(.r-tags) {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

:deep(.r-tag) {
  font-size: var(--font-size-xs);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 3px;
  color: #aaa;
}

:deep(.r-desc) {
  font-size: var(--font-size-xs);
  color: #777;
  margin-top: 4px;
  line-height: 1.3;
}

:deep(.r-report) {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(58, 58, 106, 0.15);
  border-radius: 6px;
  padding: 10px;
}

:deep(.r-date) {
  font-size: var(--font-size-xs);
  color: #888;
  margin-bottom: 6px;
}

:deep(.r-stats) {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

:deep(.r-stat) {
  flex: 1;
  text-align: center;
  background: rgba(108, 92, 231, 0.08);
  border-radius: 4px;
  padding: 4px;
}

:deep(.r-stat-num) {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: #b388ff;
}

:deep(.r-stat-label) {
  font-size: var(--font-size-xs);
  color: #888;
}

:deep(.r-dist) {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

:deep(.r-dist-tag) {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: #aaa;
}

:deep(.r-fallback) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

:deep(.r-kv-row) {
  display: flex;
  gap: 6px;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

:deep(.r-kv-key) {
  color: #b388ff;
  min-width: 40px;
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
}

:deep(.r-kv-val) {
  color: #aaa;
  word-break: break-all;
}

:deep(.r-text) {
  font-size: var(--font-size-xs);
  color: #aaa;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.gen-section {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.15));
}

.gen-section-title {
  font-size: var(--font-size-xs, 11px);
  color: var(--agent-text-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.gen-card {
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(108, 92, 231, 0.1);
}

.gen-card.gen-image { border-left: 2px solid #6c5ce7; }
.gen-card.gen-video { border-left: 2px solid #e17055; }

.gen-card-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.gen-card-icon { font-size: 12px; }
.gen-card-label { font-size: var(--font-size-xs, 11px); font-weight: var(--font-weight-medium, 500); color: var(--agent-text, #e0e0e0); flex: 1; }
.gen-card-model { font-size: 10px; color: var(--agent-text-tertiary, #888); }

.gen-card-prompt {
  font-size: 10px;
  color: var(--agent-text-secondary, #aaa);
  margin-bottom: 4px;
}

.gen-card-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.gen-card-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.gen-card-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
  background: var(--agent-primary, #6c5ce7);
}

.gen-video .gen-card-fill { background: #e17055; }

.gen-card-pct {
  font-size: 10px;
  color: var(--agent-accent, #b388ff);
  font-weight: var(--font-weight-semibold, 600);
  min-width: 28px;
  text-align: right;
}

.gen-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--agent-text-tertiary, #888);
}

</style>
