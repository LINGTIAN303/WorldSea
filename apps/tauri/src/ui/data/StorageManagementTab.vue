<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import WsButton from '../WsButton.vue'
import WsCheckbox from '../WsCheckbox.vue'
import { useStorageStats } from '@worldsmith/entity-core/composables'
import { useOrphanCleanup } from '@worldsmith/entity-core/composables'
import { useDataDiagnostics } from '@worldsmith/entity-core/composables'
import { useAutoCleanup } from '@worldsmith/entity-core/composables'
import { useToast } from '../../composables/useToast'
import { useSystemBridge } from '@/composables/useSystemBridge'

const toast = useToast()
const { autostartEnabled, setAutostart } = useSystemBridge()
const autostartOn = ref(false)
const { stats, isScanning: statsScanning, refresh, scanOrphanCount } = useStorageStats()
const {
  orphans, selectedIds, isScanning: orphanScanning, isCleaning,
  scanProgress, scan, cleanSelected, cleanAll, selectAll, deselectAll, toggleSelect,
} = useOrphanCleanup()
const { result: diagResult, isRunning: diagRunning, backendAvailable, run: runDiag } = useDataDiagnostics()
const { lastRunAt, forceRun } = useAutoCleanup()

const selectedCount = computed(() => selectedIds.value.size)
const selectedSize = computed(() => {
  const ids = selectedIds.value
  return orphans.value.filter(o => ids.has(o.id)).reduce((s, o) => s + o.sizeEstimate, 0)
})

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDate(ts: number): string {
  if (!ts) return '从未'
  return new Date(ts).toLocaleString('zh-CN')
}

async function onRefreshStats(): Promise<void> {
  await refresh()
  await scanOrphanCount()
}

async function onScanOrphans(): Promise<void> {
  await scan()
}

async function onCleanSelected(): Promise<void> {
  await cleanSelected(Array.from(selectedIds.value))
  await refresh()
}

async function onCleanAll(): Promise<void> {
  await cleanAll()
  await refresh()
}

async function onRunDiagnostics(): Promise<void> {
  await runDiag()
}

async function onForceAutoCleanup(): Promise<void> {
  const count = await forceRun()
  toast.toastSuccess(`自动清理完成，清理了 ${count} 项缓存`)
}

async function onToggleAutostart(e: Event): Promise<void> {
  const on = (e.target as HTMLInputElement).checked
  const ok = await setAutostart(on)
  if (!ok) {
    console.error('[Storage] 设置开机自启失败')
    autostartOn.value = !on
    return
  }
  autostartOn.value = on
  toast.toastSuccess(on ? '已开启开机自启' : '已关闭开机自启')
}

onMounted(async () => {
  autostartOn.value = await autostartEnabled()
  refresh()
  scanOrphanCount()
})
</script>

<template>
  <div class="sm-tab">
    <div class="sm-section sm-section--auto">
      <div class="sm-section-head">
        <WsIcon name="settings" size="xs" />
        <span>系统集成</span>
      </div>
      <div class="sm-row">
        <span class="sm-row-label">开机自启</span>
        <label class="sm-toggle">
          <input type="checkbox" :checked="autostartOn" @change="onToggleAutostart" />
          <span class="sm-toggle-slider"></span>
        </label>
        <span class="sm-row-hint">登录系统后自动启动 WorldSmith</span>
      </div>
    </div>

    <div class="sm-section">
      <div class="sm-section-head">
        <WsIcon name="dashboard" size="xs" />
        <span>存储概览</span>
        <WsButton size="sm" variant="ghost" @click="onRefreshStats" :disabled="statsScanning">
          刷新统计
        </WsButton>
      </div>
      <div class="sm-stats-grid">
        <div class="sm-stat-item">
          <span class="sm-stat-value">{{ stats.totalUsageMB.toFixed(1) }} MB</span>
          <span class="sm-stat-label">已用空间</span>
        </div>
        <div class="sm-stat-item" v-if="stats.quotaMB">
          <span class="sm-stat-value">{{ stats.quotaMB.toFixed(0) }} MB</span>
          <span class="sm-stat-label">存储配额</span>
        </div>
        <div class="sm-stat-item">
          <span class="sm-stat-value">{{ stats.entityCount }}</span>
          <span class="sm-stat-label">实体</span>
        </div>
        <div class="sm-stat-item">
          <span class="sm-stat-value">{{ stats.relationCount }}</span>
          <span class="sm-stat-label">关系</span>
        </div>
        <div class="sm-stat-item">
          <span class="sm-stat-value">{{ stats.fileCount }}</span>
          <span class="sm-stat-label">文件</span>
        </div>
        <div class="sm-stat-item">
          <span class="sm-stat-value">{{ stats.sessionCount }}</span>
          <span class="sm-stat-label">Agent 会话</span>
        </div>
      </div>
      <div class="sm-orphan-hint" v-if="stats.orphanFileCount !== null && stats.orphanFileCount > 0">
        <WsIcon name="warning" size="xs" />
        <span>孤立文件: {{ stats.orphanFileCount }} 个</span>
      </div>
    </div>

    <div class="sm-section">
      <div class="sm-section-head">
        <WsIcon name="delete" size="xs" />
        <span>孤立文件清理</span>
        <WsButton size="sm" variant="ghost" @click="onScanOrphans" :disabled="orphanScanning">
          {{ orphanScanning ? `扫描中 ${scanProgress}%` : '扫描' }}
        </WsButton>
      </div>
      <div v-if="orphans.length > 0" class="sm-orphan-list">
        <div class="sm-orphan-actions">
          <WsButton size="sm" variant="ghost" @click="selectAll">全选</WsButton>
          <WsButton size="sm" variant="ghost" @click="deselectAll">全不选</WsButton>
          <span class="sm-selected-info">已选 {{ selectedCount }} 项 ({{ formatSize(selectedSize) }})</span>
        </div>
        <div v-for="o in orphans" :key="o.id" class="sm-orphan-item">
          <WsCheckbox :checked="selectedIds.has(o.id)" @change="toggleSelect(o.id)" />
          <span class="sm-orphan-name">{{ o.name }}</span>
          <span class="sm-orphan-size">{{ formatSize(o.sizeEstimate) }}</span>
        </div>
        <div class="sm-orphan-actions">
          <WsButton size="sm" variant="danger" @click="onCleanSelected" :disabled="selectedCount === 0 || isCleaning">
            清理选中项
          </WsButton>
          <WsButton size="sm" variant="danger" @click="onCleanAll" :disabled="isCleaning">
            清理全部
          </WsButton>
        </div>
      </div>
      <div v-else-if="!orphanScanning" class="sm-empty-hint">
        {{ stats.orphanFileCount === 0 ? '未发现孤立文件' : '点击"扫描"检测孤立文件' }}
      </div>
    </div>

    <div class="sm-section">
      <div class="sm-section-head">
        <WsIcon name="search" size="xs" />
        <span>数据诊断</span>
      </div>
      <div class="sm-diag-backend">
        WASM 后端:
        <span v-if="backendAvailable"><WsIcon name="check-circle" size="xs" /> 可用</span>
        <span v-else><WsIcon name="alert" size="xs" /> 不可用（降级模式）</span>
      </div>
      <WsButton size="sm" variant="secondary" @click="onRunDiagnostics" :disabled="diagRunning">
        {{ diagRunning ? '诊断中...' : '运行诊断' }}
      </WsButton>
      <div v-if="diagResult" class="sm-diag-results">
        <div class="sm-diag-item" :class="{ 'sm-diag-ok': diagResult.orphanEntities.length === 0 }">
          <WsIcon v-if="diagResult.orphanEntities.length > 0" name="alert" size="xs" />
          <WsIcon v-else name="check-circle" size="xs" />
          孤立实体: {{ diagResult.orphanEntities.length }} 个
        </div>
        <div class="sm-diag-item" :class="{ 'sm-diag-ok': diagResult.danglingRelations.length === 0 }">
          <WsIcon v-if="diagResult.danglingRelations.length > 0" name="alert" size="xs" />
          <WsIcon v-else name="check-circle" size="xs" />
          悬空关系: {{ diagResult.danglingRelations.length }} 个
        </div>
        <div class="sm-diag-item" :class="{ 'sm-diag-ok': diagResult.duplicateNames.length === 0 }">
          <WsIcon v-if="diagResult.duplicateNames.length > 0" name="alert" size="xs" />
          <WsIcon v-else name="check-circle" size="xs" />
          重名冲突: {{ diagResult.duplicateNames.length }} 处
        </div>
        <div class="sm-diag-item" :class="{ 'sm-diag-ok': diagResult.inconsistentTypes.length === 0 }">
          <WsIcon v-if="diagResult.inconsistentTypes.length > 0" name="alert" size="xs" />
          <WsIcon v-else name="check-circle" size="xs" />
          未注册类型: {{ diagResult.inconsistentTypes.length }} 个
        </div>
      </div>
    </div>

    <div class="sm-section">
      <div class="sm-section-head">
        <WsIcon name="refresh" size="xs" />
        <span>自动清理</span>
      </div>
      <div class="sm-autoclean-info">
        <div>上次自动清理: {{ formatDate(lastRunAt) }}</div>
        <div>自动清理范围: 过期缓存 + 临时标记</div>
        <div>执行频率: 每 24 小时（应用启动时）</div>
      </div>
      <WsButton size="sm" variant="ghost" @click="onForceAutoCleanup">
        立即执行一次
      </WsButton>
    </div>
  </div>
</template>

<style scoped>
.sm-tab {
  width: 616px;
  height: 699px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.sm-section {
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  height: 212px;
  padding: 16px;
  background: var(--color-bg-surface);
}
.sm-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: var(--text-subheading-font-size);
}
/* 系统集成区：高度自适应（区别于固定高度的存储概览区） */
.sm-section--auto { height: auto; }
.sm-row { display: flex; align-items: center; gap: 10px; padding: 4px 2px; }
.sm-row-label { font-size: var(--font-size-sm); color: var(--color-text-primary); }
.sm-row-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.sm-toggle { display: inline-flex; cursor: pointer; }
.sm-toggle input { accent-color: var(--color-primary); width: 14px; height: 14px; cursor: pointer; }
.sm-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.sm-stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-md);
}
.sm-stat-value {
  font-size: var(--text-heading-font-size);
  font-weight: 600;
  color: var(--color-text-primary);
}
.sm-stat-label {
  font-size: var(--text-caption-font-size);
  color: var(--color-text-tertiary);
  margin-top: 2px;
}
.sm-orphan-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--color-primary-subtle);
  border-radius: var(--radius-md);
  font-size: var(--text-body-sm-font-size);
  color: var(--color-primary);
}
.sm-orphan-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm-orphan-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sm-selected-info {
  font-size: var(--text-caption-font-size);
  color: var(--color-text-secondary);
  margin-left: auto;
}
.sm-orphan-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: var(--color-bg-hover);
}
.sm-orphan-name {
  flex: 1;
  font-size: var(--text-body-sm-font-size);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-orphan-size {
  font-size: var(--text-caption-font-size);
  color: var(--color-text-tertiary);
}
.sm-empty-hint {
  font-size: var(--text-body-sm-font-size);
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 12px;
}
.sm-diag-backend {
  font-size: var(--text-body-sm-font-size);
  margin-bottom: 8px;
  color: var(--color-text-secondary);
}
.sm-diag-results {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sm-diag-item {
  font-size: var(--text-body-sm-font-size);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.sm-diag-ok {
  color: var(--color-text-secondary);
}
.sm-autoclean-info {
  font-size: var(--text-body-sm-font-size);
  color: var(--color-text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
</style>
