<template>
  <div class="rh-sidebar">
    <div class="rh-header">
      <h4 class="rh-title">运行历史</h4>
      <button
        class="rh-refresh"
        :disabled="loading"
        title="刷新"
        @click="loadRuns"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>
        </svg>
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && runs.length === 0" class="rh-loading">
      加载中...
    </div>

    <!-- 空状态 -->
    <div v-else-if="runs.length === 0" class="rh-empty">
      <p>暂无运行记录</p>
      <p class="rh-empty__hint">Rust 引擎执行的工作流会在此显示</p>
    </div>

    <!-- 运行列表 -->
    <div v-else class="rh-list">
      <div
        v-for="run in runs"
        :key="run.run_id"
        class="rh-item"
        :class="{ 'rh-item--active': selectedRunId === run.run_id }"
        @click="onSelectRun(run.run_id)"
      >
        <div class="rh-item__header">
          <span class="rh-item__id" :title="run.run_id">{{ shortId(run.run_id) }}</span>
          <span class="rh-item__status" :class="`rh-status--${run.status}`">
            {{ statusLabel(run.status) }}
          </span>
        </div>
        <div class="rh-item__meta">
          <span class="rh-item__time">{{ formatTime(run.started_at) }}</span>
          <span v-if="run.duration_ms !== null" class="rh-item__duration">
            · {{ formatDuration(run.duration_ms) }}
          </span>
        </div>
        <div v-if="run.triggered_by" class="rh-item__trigger" :title="run.triggered_by">
          by {{ run.triggered_by }}
        </div>
        <div v-if="run.error && selectedRunId === run.run_id" class="rh-item__error">
          {{ run.error }}
        </div>
      </div>
    </div>

    <!-- 加载失败 -->
    <div v-if="loadError" class="rh-error">
      <p>加载失败</p>
      <p class="rh-error__msg">{{ loadError }}</p>
      <button class="rh-error__retry" @click="loadRuns">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { workflowListRuns, workflowGetRun, type RunRecord } from '../api/workflowApi'

const runs = ref<RunRecord[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const selectedRunId = ref<string | null>(null)

const emit = defineEmits<{
  'select-run': [runId: string]
}>()

/** 加载运行记录列表 */
async function loadRuns() {
  loading.value = true
  loadError.value = null
  try {
    const list = await workflowListRuns({ limit: 50 })
    // 前端计算 duration_ms 派生字段
    runs.value = list.map(r => ({
      ...r,
      duration_ms: r.completed_at !== null ? r.completed_at - r.started_at : null,
    }))
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    runs.value = []
  } finally {
    loading.value = false
  }
}

/** 选中某条 run */
async function onSelectRun(runId: string) {
  if (selectedRunId.value === runId) {
    selectedRunId.value = null
    return
  }
  selectedRunId.value = runId
  emit('select-run', runId)

  // 拉取详情以显示 error（列表接口已含 error，但 get_run 可能有更多字段）
  try {
    const detail = await workflowGetRun(runId)
    const idx = runs.value.findIndex(r => r.run_id === runId)
    if (idx >= 0) {
      runs.value[idx] = { ...runs.value[idx], ...detail }
    }
  } catch {
    // 详情拉取失败不影响列表展示
  }
}

/** 截短 run_id（取前 8 位） */
function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + '…' : id
}

/** status → 中文标签 */
function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    pending: '等待中',
    paused: '已暂停',
  }
  return map[status] || status
}

/** 时间戳 → 可读时间 */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 毫秒 → 可读时长 */
function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

onMounted(() => {
  loadRuns()
})

// 暴露刷新方法给父组件
defineExpose({ loadRuns })
</script>

<style scoped>
.rh-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary, #161b22);
  border-radius: 8px;
  overflow: hidden;
}

.rh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #30363d);
  flex-shrink: 0;
}
.rh-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.rh-refresh {
  background: none;
  border: none;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rh-refresh:hover:not(:disabled) {
  color: var(--primary, #58a6ff);
  background: var(--bg-tertiary, #21262d);
}
.rh-refresh:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.rh-refresh svg {
  animation: none;
}
.rh-refresh:disabled svg {
  animation: rh-spin 1s linear infinite;
}
@keyframes rh-spin {
  to { transform: rotate(360deg); }
}

.rh-loading {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  opacity: 0.5;
}

.rh-empty {
  padding: 24px 12px;
  text-align: center;
}
.rh-empty p {
  margin: 0;
  font-size: 13px;
  opacity: 0.4;
}
.rh-empty__hint {
  font-size: 11px;
  margin-top: 4px;
}

.rh-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.rh-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}
.rh-item:hover {
  background: var(--bg-tertiary, #21262d);
}
.rh-item--active {
  background: var(--bg-tertiary, #21262d);
  border-left: 2px solid var(--primary, #58a6ff);
  padding-left: 8px;
}

.rh-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.rh-item__id {
  font-family: monospace;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rh-item__status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
  flex-shrink: 0;
}
.rh-status--running { color: var(--warning, #d29922); background: color-mix(in srgb, var(--warning, #d29922) 15%, transparent); }
.rh-status--completed { color: var(--success, #3fb950); background: color-mix(in srgb, var(--success, #3fb950) 15%, transparent); }
.rh-status--failed { color: var(--danger, #f85149); background: color-mix(in srgb, var(--danger, #f85149) 15%, transparent); }
.rh-status--cancelled { color: var(--text-secondary, #8b949e); background: var(--bg-tertiary, #21262d); }
.rh-status--pending { color: var(--text-secondary, #8b949e); background: var(--bg-tertiary, #21262d); }
.rh-status--paused { color: var(--warning, #d29922); background: color-mix(in srgb, var(--warning, #d29922) 15%, transparent); }

.rh-item__meta {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  opacity: 0.5;
  margin-top: 2px;
}

.rh-item__trigger {
  font-size: 11px;
  opacity: 0.4;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rh-item__error {
  margin-top: 6px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--danger, #f85149) 10%, transparent);
  border-radius: 4px;
  font-size: 11px;
  color: var(--danger, #f85149);
  white-space: pre-wrap;
  word-break: break-all;
}

.rh-error {
  padding: 16px 12px;
  text-align: center;
}
.rh-error p {
  margin: 0;
  font-size: 12px;
}
.rh-error__msg {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  word-break: break-all;
}
.rh-error__retry {
  margin-top: 8px;
  padding: 4px 12px;
  border-radius: 5px;
  border: 1px solid var(--border, #30363d);
  background: var(--bg-tertiary, #21262d);
  color: var(--primary, #58a6ff);
  font-size: 11px;
  cursor: pointer;
}
.rh-error__retry:hover {
  border-color: var(--primary, #58a6ff);
}
</style>
