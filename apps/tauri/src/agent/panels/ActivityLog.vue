<template>
  <div class="activity-log">
    <div class="panel-header">
      <h3 class="panel-title">活动日志</h3>
      <div class="panel-header-actions">
        <button v-if="logs.length > 0" class="panel-action-btn" @click="clearLogs" title="清空"><TuiIcon name="trash" :size="14" /></button>
        <button class="panel-close-btn" @click="emit('close')" title="关闭"><TuiIcon name="close" :size="14" /></button>
      </div>
    </div>
    <div class="panel-body">
      <!-- 生成进度区 -->
      <div v-if="visibleGenTasks.length > 0" class="gen-section">
        <div class="section-header" role="button" tabindex="0" :aria-expanded="genExpanded" @click="genExpanded = !genExpanded" @keydown.enter.prevent="genExpanded = !genExpanded" @keydown.space.prevent="genExpanded = !genExpanded">
          <span class="section-label">生成进度</span>
          <span class="section-meta">{{ activeTasks.length }} 项进行中</span>
          <TuiIcon name="chevronDown" :size="13" class="section-chevron" :class="{ collapsed: !genExpanded }" />
        </div>
        <div v-show="genExpanded">
          <div
            v-for="task in visibleGenTasks"
            :key="task.id"
            class="gen-card"
            :class="[`gen-${task.type}`, `gen-${task.status}`]"
          >
            <div class="gen-card-top">
              <span class="gen-type-badge" :class="`badge-${task.type}`">
                <TuiIcon v-if="task.type === 'image'" name="image" :size="12" />
                <TuiIcon v-else name="video" :size="12" />
                {{ task.type === 'image' ? '图片' : '视频' }}
              </span>
              <span class="gen-model-tag">{{ task.model }}</span>
              <span class="gen-elapsed">{{ formatDuration(task) }}</span>
            </div>
            <div class="gen-prompt">{{ truncatePrompt(task.prompt) }}</div>
            <div class="gen-bar-wrap">
              <div class="gen-bar-track">
                <div class="gen-bar-fill" :class="{ pulsing: task.status === 'generating' || task.status === 'polling', failed: task.status === 'failed' }" :style="{ width: (task.status === 'failed' ? 100 : task.progress) + '%' }"></div>
              </div>
              <span class="gen-bar-pct">{{ Math.round(task.progress) }}%</span>
            </div>
            <div class="gen-status-row">
              <span class="gen-status-dot" :class="`dot-${task.status}`"></span>
              <span class="gen-status-text">{{ statusLabel(task) }}</span>
            </div>
          </div>
        </div>
        <div class="section-divider"></div>
      </div>

      <!-- 历史日志区 -->
      <div v-if="logs.length === 0 && visibleGenTasks.length === 0" class="panel-empty">暂无活动记录</div>
      <div v-for="log in logs" :key="log.id" class="log-item" :class="`log-${log.type}`" role="button" tabindex="0" :aria-expanded="expandedId === log.id" @click="toggleDetail(log.id)" @keydown.enter.prevent="toggleDetail(log.id)" @keydown.space.prevent="toggleDetail(log.id)">
        <span class="log-icon"><TuiIcon :name="getLogIcon(log.type)" :size="14" /></span>
        <div class="log-content">
          <span class="log-message">{{ log.message }}</span>
          <span class="log-time">{{ formatTime(log.timestamp) }}</span>
          <div v-if="expandedId === log.id && log.detail" class="log-detail">{{ log.detail }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import TuiIcon from '../../components/ui/TuiIcon.vue'
import { useActivityLog } from '../composables/useActivityLog'
import { useGenerationProgress } from '@worldsmith/shared-composables/agent/useGenerationProgress'

const emit = defineEmits<{ close: [] }>()

const { logs, clearLogs } = useActivityLog()
const { tasks: genTasks, activeTasks } = useGenerationProgress()

/** 包含活跃任务和最近失败的任务（5 分钟内） */
const visibleGenTasks = computed(() => {
  const now = Date.now()
  return genTasks.value.filter(t => {
    if (t.status !== 'failed') return true
    // 失败任务保留 5 分钟
    const elapsed = now - (t.endedAt || t.startedAt)
    return elapsed < 5 * 60 * 1000
  })
})

const expandedId = ref<string | null>(null)
const genExpanded = ref(true)

function getLogIcon(type: string): string {
  switch (type) {
    case 'info': return 'chat'
    case 'warning': return 'warning'
    case 'knowledge': return 'book'
    case 'memory': return 'memory'
    case 'error': return 'warning'
    case 'tool': return 'wrench'
    default: return 'file'
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function toggleDetail(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function truncatePrompt(prompt: string): string {
  if (!prompt) return ''
  return prompt.length > 50 ? prompt.slice(0, 50) + '…' : prompt
}

function statusLabel(task: { status: string }): string {
  if (task.status === 'pending') return '等待中'
  if (task.status === 'generating') return '生成中'
  if (task.status === 'polling') return '轮询结果中'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'failed') return '生成失败'
  return task.status
}

function formatDuration(task: { startedAt: number; endedAt?: number }): string {
  const end = task.endedAt || Date.now()
  const ms = end - task.startedAt
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
</script>

<style scoped>
.activity-log {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  contain: layout paint style;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.panel-close-btn, .panel-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close-btn:hover, .panel-action-btn:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.panel-close-btn:active:not(:disabled),
.panel-action-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.panel-title {
  font-size: var(--fs-md);
  font-weight: 600;
  margin: 0;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px;
  contain: layout paint style;
}

.panel-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 24px;
  font-size: var(--fs-xs);
}

/* --- Section Header --- */

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
}

.section-header:hover .section-label { color: var(--text-primary); }

.section-label {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  transition: color 0.15s;
}

.section-meta {
  font-size: var(--fs-xs);
  color: var(--accent);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.section-chevron {
  color: var(--text-muted);
  transition: transform 0.2s;
  margin-left: auto;
}

.section-chevron.collapsed { transform: rotate(-90deg); }

.section-divider {
  height: 1px;
  background: var(--border);
  margin: 6px 0;
}

/* --- Generation Card --- */

.gen-card {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: var(--radius-md);
  background: var(--bg-muted);
  border: 1px solid var(--border);
  transition: border-color 0.2s;
}

.gen-card:hover { border-color: var(--accent); }
.gen-card.gen-image { border-left: 3px solid var(--accent); }
.gen-card.gen-video { border-left: 3px solid #e17055; }

.gen-card-top {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
}

.gen-type-badge {
  font-size: var(--fs-2xs);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 2px;
}

.badge-image { color: var(--accent); background: var(--accent-soft); }
.badge-video { color: #e17055; background: rgba(225, 112, 85, 0.12); }

.gen-model-tag {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  background: var(--bg-surface);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  flex: 1;
}

.gen-elapsed {
  font-size: var(--fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.gen-prompt {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  margin-bottom: 6px;
  line-height: 1.3;
  word-break: break-all;
}

.gen-bar-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.gen-bar-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}

.gen-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
  background: var(--accent);
}

.gen-video .gen-bar-fill { background: #e17055; }

.gen-bar-fill.failed { background: var(--danger); animation: none; }

.gen-bar-fill.pulsing { animation: bar-pulse 1.8s ease-in-out infinite; }

@keyframes bar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

.gen-bar-pct {
  font-size: var(--fs-xs);
  color: var(--accent);
  font-weight: 600;
  min-width: 30px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.gen-video .gen-bar-pct { color: #e17055; }

.gen-status-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.gen-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-pending { background: var(--text-muted); }
.dot-generating { background: var(--info); animation: dot-blink 1.2s ease-in-out infinite; }
.dot-polling { background: var(--warning); animation: dot-blink 1.2s ease-in-out infinite; }
.dot-completed { background: var(--success); }
.dot-failed { background: var(--danger); }

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.gen-status-text {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}

/* --- Log Item --- */

.log-item {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: background 0.1s;
}

.log-item:hover { background: var(--bg-muted); }
.log-item.log-error { border-left: 3px solid var(--danger); }
.log-item.log-tool { border-left: 3px solid var(--accent); }
.log-item.log-knowledge { border-left: 3px solid var(--success); }
.log-item.log-memory { border-left: 3px solid var(--warning); }

.log-icon { font-size: var(--fs-base); flex-shrink: 0; color: var(--text-secondary); }

.log-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.log-message { color: var(--text-primary); line-height: 1.4; }

.log-time {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-family: monospace;
}

.log-detail {
  margin-top: 4px;
  padding: 6px 8px;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}

/* ── 减弱动态偏好（prefers-reduced-motion）：停用循环脉冲/闪烁与按压缩放手势 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
@media (prefers-reduced-motion: reduce) {
  .gen-bar-fill.pulsing {
    animation: none;
  }
  .dot-generating,
  .dot-polling {
    animation: none;
  }
  .section-chevron {
    transition: none;
  }
  .panel-close-btn:active:not(:disabled),
  .panel-action-btn:active:not(:disabled) {
    transform: none;
  }
}
</style>
