<template>
  <Transition name="ws-menu">
    <div
      v-if="visible"
      class="archive-panel agent-panel"
      :style="panelStyle"
      @mousedown.left="onDragStart"
    >
      <!-- 拖拽 handle -->
      <div class="ap-drag-handle">
        <span class="ap-title"><WsIcon name="notebook" size="sm" /> 记忆库</span>
        <div class="ap-handle-actions">
          <button
            v-if="subPanel !== 'list'"
            class="ap-back-btn"
            @click="subPanel = 'list'"
            title="返回列表"
          ><WsIcon name="chevron-right" size="xs" /></button>
          <button class="ap-close-btn" @click="emit('close')">✕</button>
        </div>
      </div>

      <div class="ap-body" @mousedown.stop>
        <!-- 未初始化提示 -->
        <div v-if="!memoryArchive.isInitialized.value" class="ap-uninit">
          <WsIcon name="warning" size="sm" />
          <span>记忆库未初始化</span>
          <button class="ap-init-btn" @click="onManualInit">初始化</button>
        </div>

        <template v-else>
          <!-- 子面板切换 tabs（仅 list/search/stats/config/trash/merge 显示，detail 不显示） -->
          <div v-if="subPanel === 'list' || subPanel === 'search' || subPanel === 'stats' || subPanel === 'config' || subPanel === 'trash' || subPanel === 'merge'" class="ap-tabs">
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'list' }"
              @click="subPanel = 'list'"
            ><WsIcon name="list" size="xs" /> 列表</button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'search' }"
              @click="subPanel = 'search'"
            ><WsIcon name="search" size="xs" /> 搜索</button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'trash' }"
              @click="subPanel = 'trash'"
            ><WsIcon name="delete" size="xs" /> 回收站</button>
            <button
              class="ap-tab ap-tab-merge"
              :class="{ active: subPanel === 'merge' }"
              @click="subPanel = 'merge'"
            ><WsIcon name="link" size="xs" /> 待合并<span v-if="mergeCount > 0" class="ap-tab-badge">{{ mergeCount }}</span></button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'stats' }"
              @click="subPanel = 'stats'"
            ><WsIcon name="dashboard" size="xs" /> 统计</button>
            <button
              class="ap-tab"
              :class="{ active: subPanel === 'config' }"
              @click="subPanel = 'config'"
            ><WsIcon name="settings" size="xs" /> 配置</button>
          </div>

          <!-- 列表/详情视图（统一由 HookListView 处理） -->
          <HookListView
            v-if="subPanel === 'list' || subPanel === 'detail'"
            :mode="subPanel === 'detail' ? 'detail' : 'list'"
            :hooks="hooks"
            :selected-hook="selectedHook"
            v-model:new-tag-input="newTagInput"
            @open-detail="openDetail"
            @toggle-pin="togglePin"
            @add-tag="addTag"
            @remove-tag="removeTag"
            @confirm-delete="confirmDelete"
            @open-chunk="openChunkViewer"
          />

          <!-- 搜索视图 -->
          <SearchView
            v-else-if="subPanel === 'search'"
            @open-detail="openDetail"
          />

          <!-- 统计视图 -->
          <StatsView
            v-else-if="subPanel === 'stats'"
            :stats="stats"
            :meta-info="metaInfo"
          />

          <!-- 回收站视图 -->
          <TrashView
            v-else-if="subPanel === 'trash'"
            @restored="refresh"
          />

          <!-- 待合并视图 -->
          <MergeView
            v-else-if="subPanel === 'merge'"
            @merged="refresh"
            @count-change="mergeCount = $event"
          />

          <!-- 配置视图（P3-4-3 新增） -->
          <div v-else-if="subPanel === 'config'" class="ap-config">
            <ArchiveConfigPanel ref="configPanel" @saved="onConfigSaved" />

            <!-- 周期任务操作区（P4 新增） -->
            <div class="acp-section ap-scheduler-section">
              <div class="acp-section-label">周期任务操作</div>
              <div v-if="metaInfo" class="ap-meta-info">
                <div class="ap-meta-row">
                  <span class="ap-meta-label">上次日任务</span>
                  <span class="ap-meta-value">{{ formatTime(metaInfo.lastDailyRun) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">上次周任务</span>
                  <span class="ap-meta-value">{{ formatTime(metaInfo.lastWeeklyRun) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">上次月任务</span>
                  <span class="ap-meta-value">{{ formatTime(metaInfo.lastMonthlyRun) }}</span>
                </div>
                <div class="ap-meta-row">
                  <span class="ap-meta-label">存储占用</span>
                  <span class="ap-meta-value">{{ formatBytes(metaInfo.totalStorageBytes) }}</span>
                </div>
                <div v-if="metaInfo.failedDeletions.length > 0" class="ap-meta-row">
                  <span class="ap-meta-label">失败删除队列</span>
                  <span class="ap-meta-value ap-meta-warn">{{ metaInfo.failedDeletions.length }} 项</span>
                </div>
              </div>
              <div class="ap-scheduler-actions">
                <button class="ap-scheduler-btn" @click="runDailyNow" :disabled="schedulerRunning">
                  <WsIcon name="refresh" size="xs" /> 日任务
                </button>
                <button class="ap-scheduler-btn" @click="runWeeklyNow" :disabled="schedulerRunning">
                  <WsIcon name="refresh" size="xs" /> 周任务
                </button>
                <button class="ap-scheduler-btn" @click="runMonthlyNow" :disabled="schedulerRunning">
                  <WsIcon name="refresh" size="xs" /> 月任务
                </button>
                <button
                  v-if="schedulerRunning"
                  class="ap-scheduler-btn ap-scheduler-stop"
                  @click="interruptScheduler"
                >
                  <WsIcon name="close" size="xs" /> 中断
                </button>
              </div>
              <div v-if="lastTaskLog" class="ap-task-log" :class="`ap-task-log-${lastTaskLog.status}`">
                {{ lastTaskLog.taskName }}任务: {{ lastTaskLog.status === 'success' ? '成功' : lastTaskLog.status === 'failed' ? '失败' : '部分完成' }}
                <span v-if="lastTaskLog.processedCount">（处理 {{ lastTaskLog.processedCount }} 项）</span>
                <span v-if="lastTaskLog.error"> - {{ lastTaskLog.error }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 底部操作栏 -->
      <div v-if="memoryArchive.isInitialized.value" class="ap-footer" @mousedown.stop>
        <button class="ap-footer-btn" @click="refresh" :disabled="refreshing">
          <WsIcon name="refresh" size="xs" /> 刷新
        </button>
        <button class="ap-footer-btn ap-primary" @click="manualArchive" :disabled="archiving">
          <WsIcon name="save" size="xs" /> {{ archiving ? '归档中...' : '手动归档' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * ArchivePanel - 记忆库管理面板
 *
 * P3-3-3 新增：记忆库管理 UI，提供钩子列表/详情/搜索/统计/回收站/合并/配置 7 个子视图。
 *
 * 子视图已拆分为独立组件（src/agent/archive/）：
 * - HookListView：列表 + 详情视图
 * - SearchView：搜索视图（自包含搜索逻辑）
 * - StatsView：统计视图（纯 UI，接收 stats/metaInfo props）
 * - TrashView：回收站视图（自包含回收站逻辑）
 * - MergeView：待合并视图（自包含合并逻辑）
 *
 * 父组件保留：subPanel 切换、hooks 共享状态、stats computed、
 * 手动归档、周期任务调度、配置面板、面板拖拽。
 */
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { usePanelDrag } from '../agent/composables/usePanelDrag'
import { useMemoryArchive } from '../memory-archive'
import { toastError } from '@/composables/useToast'
import ArchiveConfigPanel from './ArchiveConfigPanel.vue'
import HookListView from './archive/HookListView.vue'
import SearchView from './archive/SearchView.vue'
import StatsView from './archive/StatsView.vue'
import TrashView from './archive/TrashView.vue'
import MergeView from './archive/MergeView.vue'
import { formatTime, formatBytes } from './archive/utils'
import type { Hook, ArchiveMeta, TaskLogEntry } from '@worldsmith/memory-archive'

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  dragged: boolean
}>()

const emit = defineEmits<{
  close: []
  dragstart: [e: MouseEvent]
  'open-chunk': [hookId: string, chunkId: string]
}>()

const memoryArchive = useMemoryArchive()

// ===== 子面板状态 =====
type SubPanel = 'list' | 'detail' | 'search' | 'stats' | 'config' | 'trash' | 'merge'
const subPanel = ref<SubPanel>('list')

// ===== 配置面板 ref（P3-4-3 新增）=====
const configPanel = ref<InstanceType<typeof ArchiveConfigPanel> | null>(null)

function onConfigSaved(): void {
  console.log('[ArchivePanel] 配置已保存，刷新列表')
  refresh()
}

// 切换到 config 子视图时重新加载配置（确保显示最新值）
// 注：trash/merge 视图的加载逻辑已移至对应子组件的 onMounted
watch(subPanel, (newVal) => {
  if (newVal === 'config') {
    configPanel.value?.reload()
    loadMetaInfo()
  }
})

// ===== 钩子列表（共享状态，多个视图依赖）=====
const hooks = ref<Hook[]>([])
const refreshing = ref(false)

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    hooks.value = memoryArchive.getAllHooks()
  } catch (err) {
    console.warn('[ArchivePanel] 刷新失败:', err)
  } finally {
    refreshing.value = false
  }
}

// ===== 详情视图（由 HookListView 触发）=====
const selectedHook = ref<Hook | null>(null)
const newTagInput = ref('')
const deleteConfirmId = ref<string | null>(null)

function openDetail(hookId: string): void {
  const hook = hooks.value.find((h) => h.id === hookId)
  if (hook) {
    selectedHook.value = hook
    subPanel.value = 'detail'
    newTagInput.value = ''
  }
}

async function togglePin(hook: Hook): Promise<void> {
  try {
    await memoryArchive.pinHook(hook.id, !hook.pinned)
    hook.pinned = !hook.pinned
    console.log('[ArchivePanel] 置顶状态已更新:', hook.id, hook.pinned)
  } catch (err) {
    console.warn('[ArchivePanel] 置顶失败:', err)
  }
}

async function addTag(): Promise<void> {
  if (!selectedHook.value || !newTagInput.value.trim()) return
  const tag = newTagInput.value.trim()
  if (selectedHook.value.tags.includes(tag)) {
    newTagInput.value = ''
    return
  }
  const newTags = [...selectedHook.value.tags, tag]
  try {
    await memoryArchive.tagHook(selectedHook.value.id, newTags)
    selectedHook.value.tags = newTags
    newTagInput.value = ''
  } catch (err) {
    console.warn('[ArchivePanel] 添加标签失败:', err)
  }
}

async function removeTag(tag: string): Promise<void> {
  if (!selectedHook.value) return
  const newTags = selectedHook.value.tags.filter((t) => t !== tag)
  try {
    await memoryArchive.tagHook(selectedHook.value.id, newTags)
    selectedHook.value.tags = newTags
  } catch (err) {
    console.warn('[ArchivePanel] 移除标签失败:', err)
  }
}

function confirmDelete(): void {
  if (!selectedHook.value) return
  // 二次点击确认
  if (deleteConfirmId.value === selectedHook.value.id) {
    doDelete()
  } else {
    deleteConfirmId.value = selectedHook.value.id
    console.log('[ArchivePanel] 再次点击确认删除')
    setTimeout(() => {
      if (deleteConfirmId.value === selectedHook.value?.id) {
        deleteConfirmId.value = null
      }
    }, 3000)
  }
}

async function doDelete(): Promise<void> {
  if (!selectedHook.value) return
  const hookId = selectedHook.value.id
  try {
    await memoryArchive.deleteHook(hookId)
    hooks.value = hooks.value.filter((h) => h.id !== hookId)
    selectedHook.value = null
    deleteConfirmId.value = null
    subPanel.value = 'list'
    console.log('[ArchivePanel] 钩子已删除:', hookId)
  } catch (err) {
    console.warn('[ArchivePanel] 删除失败:', err)
    toastError('删除钩子失败')
  }
}

function openChunkViewer(chunkId: string): void {
  if (!selectedHook.value) return
  emit('open-chunk', selectedHook.value.id, chunkId)
}

// ===== 待合并 tab badge 数量（由 MergeView 通过 count-change 事件同步）=====
const mergeCount = ref(0)

// ===== 统计视图（computed from hooks）=====
const stats = computed(() => {
  const all = hooks.value
  const totalHooks = all.length
  const totalTokens = all.reduce((sum, h) => sum + h.tokenCount, 0)
  const pinnedCount = all.filter((h) => h.pinned).length
  const activeCount = all.filter((h) => h.status === 'active').length
  const deprecatedCount = all.filter((h) => h.status === 'deprecated').length
  const avgImportance = totalHooks > 0 ? all.reduce((sum, h) => sum + h.importance, 0) / totalHooks : 0
  const avgDecay = totalHooks > 0 ? all.reduce((sum, h) => sum + h.decayScore, 0) / totalHooks : 0
  const llmSummaryCount = all.filter((h) => h.summaryMethod === 'llm').length
  // H3.5 新增统计项
  const totalAccessCount = all.reduce((sum, h) => sum + h.accessCount, 0) // 总访问次数（含检索）
  const totalActiveAccess = all.reduce((sum, h) => sum + h.activeAccessCount, 0) // 主动检索次数
  const orphanCount = all.filter((h) => h.status === 'orphan').length
  const trashedCount = all.filter((h) => h.status === 'trashed').length
  const pendingMergeCount = all.filter((h) => h.status === 'pending_merge').length
  return {
    totalHooks,
    totalTokens,
    pinnedCount,
    activeCount,
    deprecatedCount,
    avgImportance,
    avgDecay,
    llmSummaryCount,
    // H3.5 新增
    totalAccessCount,
    totalActiveAccess,
    orphanCount,
    trashedCount,
    pendingMergeCount,
  }
})

// ===== 手动归档 =====
const archiving = ref(false)

async function manualArchive(): Promise<void> {
  if (archiving.value) return
  archiving.value = true
  try {
    const result = await memoryArchive.archive({ source: 'manual' })
    console.log('[ArchivePanel] 手动归档完成:', result)
    await refresh()
  } catch (err) {
    console.warn('[ArchivePanel] 手动归档失败:', err)
    toastError('手动归档失败')
  } finally {
    archiving.value = false
  }
}

// ===== 周期任务（P4 新增）=====
const metaInfo = ref<ArchiveMeta | null>(null)
const schedulerRunning = ref(false)
const lastTaskLog = ref<TaskLogEntry | null>(null)

/** 加载记忆库元数据 */
async function loadMetaInfo(): Promise<void> {
  try {
    metaInfo.value = await memoryArchive.getMeta()
  } catch (err) {
    console.warn('[ArchivePanel] 加载元数据失败:', err)
    metaInfo.value = null
  }
}

/** 手动触发日任务 */
async function runDailyNow(): Promise<void> {
  if (schedulerRunning.value) return
  schedulerRunning.value = true
  lastTaskLog.value = null
  try {
    const log = await memoryArchive.runDailyNow()
    lastTaskLog.value = log
    await loadMetaInfo()
    await refresh()
    console.log('[ArchivePanel] 日任务完成:', log)
  } catch (err) {
    console.warn('[ArchivePanel] 日任务失败:', err)
    lastTaskLog.value = {
      taskName: 'daily',
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    schedulerRunning.value = false
  }
}

/** 手动触发周任务 */
async function runWeeklyNow(): Promise<void> {
  if (schedulerRunning.value) return
  schedulerRunning.value = true
  lastTaskLog.value = null
  try {
    const log = await memoryArchive.runWeeklyNow()
    lastTaskLog.value = log
    await loadMetaInfo()
    await refresh()
    console.log('[ArchivePanel] 周任务完成:', log)
  } catch (err) {
    console.warn('[ArchivePanel] 周任务失败:', err)
    lastTaskLog.value = {
      taskName: 'weekly',
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    schedulerRunning.value = false
  }
}

/** 手动触发月任务 */
async function runMonthlyNow(): Promise<void> {
  if (schedulerRunning.value) return
  schedulerRunning.value = true
  lastTaskLog.value = null
  try {
    const log = await memoryArchive.runMonthlyNow()
    lastTaskLog.value = log
    await loadMetaInfo()
    await refresh()
    console.log('[ArchivePanel] 月任务完成:', log)
  } catch (err) {
    console.warn('[ArchivePanel] 月任务失败:', err)
    lastTaskLog.value = {
      taskName: 'monthly',
      startTime: Date.now(),
      endTime: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    schedulerRunning.value = false
  }
}

/** 中断当前周期任务 */
function interruptScheduler(): void {
  try {
    memoryArchive.interruptScheduler()
    console.log('[ArchivePanel] 已请求中断周期任务')
  } catch (err) {
    console.warn('[ArchivePanel] 中断失败:', err)
  }
}

// ===== 手动初始化 =====
async function onManualInit(): Promise<void> {
  try {
    await memoryArchive.init()
    await refresh()
  } catch (err) {
    console.warn('[ArchivePanel] 初始化失败:', err)
    toastError('记忆库初始化失败')
  }
}

// ===== 拖拽 =====
const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  onDragEnd: () => {},
  excludeSelector: '.ap-body,.ap-close-btn,.ap-back-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})

// ===== 可见性变化时刷新 =====
watch(
  () => props.visible,
  (v) => {
    if (v && memoryArchive.isInitialized.value) {
      refresh()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.archive-panel {
  position: fixed;
  width: 420px;
  max-width: 90vw;
  max-height: 75vh;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.ap-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  cursor: grab;
  user-select: none;
}
.ap-drag-handle:active { cursor: grabbing }

.ap-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  font-family: var(--agent-font, sans-serif);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ap-handle-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.ap-back-btn, .ap-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.ap-back-btn:hover, .ap-close-btn:hover {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
  color: var(--agent-text, #e0e0e0);
}
.ap-back-btn { transform: rotate(180deg); }

.ap-body {
  padding: 10px 12px;
  overflow-y: auto;
  flex: 1;
}

.ap-uninit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 16px;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}

.ap-init-btn {
  padding: 6px 16px;
  border: 1px solid var(--agent-primary, #6c5ce7);
  background: transparent;
  color: var(--agent-primary, #6c5ce7);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.ap-init-btn:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }

.ap-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  padding-bottom: 6px;
}

.ap-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-xs);
  border-radius: var(--agent-radius-sm, 8px);
  font-family: var(--agent-font, sans-serif);
}
.ap-tab:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.1)); }
.ap-tab.active {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.2));
  color: var(--agent-text, #e0e0e0);
}

.ap-tab-merge {
  position: relative;
}
.ap-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: 4px;
  font-size: 10px;
  font-weight: 700;
  color: white;
  background: var(--agent-warning, #fdcb6e);
  border-radius: 8px;
}

/* 底部操作栏 */
.ap-footer {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
}

.ap-footer-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: var(--agent-font, sans-serif);
  flex: 1;
  justify-content: center;
}
.ap-footer-btn:hover:not(:disabled) { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)); }
.ap-footer-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ap-footer-btn.ap-primary {
  background: var(--agent-primary, #6c5ce7);
  border-color: var(--agent-primary, #6c5ce7);
  color: white;
}
.ap-footer-btn.ap-primary:hover:not(:disabled) { opacity: 0.85; }

/* 周期任务操作区（P4 新增，config 视图） */
.ap-scheduler-section {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}

.ap-meta-info {
  margin: 8px 0;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--agent-radius-sm, 6px);
}

.ap-meta-row {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  font-size: var(--font-size-xs);
}

.ap-meta-label {
  color: var(--agent-text-tertiary, #666);
  min-width: 72px;
}

.ap-meta-value {
  color: var(--agent-text, #e0e0e0);
  flex: 1;
  word-break: break-all;
}

.ap-meta-warn {
  color: var(--agent-warning, #fdcb6e);
}

.ap-scheduler-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.ap-scheduler-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-family: var(--agent-font, sans-serif);
}
.ap-scheduler-btn:hover:not(:disabled) {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
  border-color: var(--agent-primary, #6c5ce7);
}
.ap-scheduler-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ap-scheduler-btn.ap-scheduler-stop {
  color: var(--agent-danger, #e57373);
  border-color: var(--agent-danger, #e57373);
}
.ap-scheduler-btn.ap-scheduler-stop:hover {
  background: rgba(229, 115, 115, 0.1);
}

.ap-task-log {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  border-radius: var(--agent-radius-sm, 6px);
  line-height: 1.5;
}
.ap-task-log-success {
  background: rgba(100, 200, 100, 0.1);
  color: #6c8;
  border: 1px solid rgba(100, 200, 100, 0.3);
}
.ap-task-log-failed {
  background: rgba(200, 100, 100, 0.1);
  color: #c68;
  border: 1px solid rgba(200, 100, 100, 0.3);
}
.ap-task-log-partial {
  background: rgba(253, 203, 110, 0.1);
  color: var(--agent-warning, #fdcb6e);
  border: 1px solid rgba(253, 203, 110, 0.3);
}
</style>
