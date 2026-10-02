import { onMounted, computed, ref } from 'vue'
import { TuiButton, WsIcon } from '@worldsea/ui-kit'
import { CardDeck } from '@worldsea/ui-kit'
import TuiCheckbox from '@/components/ui/TuiCheckbox.vue'
import { useStorageStats } from '@worldsea/entity-core/composables'
import { useOrphanCleanup } from '@worldsea/entity-core/composables'
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

// ── 叠放翻卡：复用通用 CardDeck（count=3，三个功能分区为三张卡；左列标题点击 → goToCard） ──
const emit = defineEmits<{ 'card-change': [index: number] }>()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })

// ── 设置搜索：按关键词过滤三张功能卡（面板三契约之一；存储为即时操作型面板，dirty 豁免） ──
const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })

function match(keywords: string): boolean {
  if (!props.searchQuery) return true
  const q = props.searchQuery.toLowerCase()
  return keywords.toLowerCase().split(/\s+/).some((k) => q.includes(k))
}

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

/** 跳转一致性检查（2026-10-02 裁定：原「数据诊断」卡退役，体检统一归一致性检查面板） */
function openConsistencyCheck(): void {
  window.dispatchEvent(new CustomEvent('ws-open-consistency'))
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
    <CardDeck :count="3" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
      <template #card="{ idx, cls }">
        <div v-if="idx === 0" class="set-card deck-card" :class="cls" :data-index="0" v-show="match('系统集成 自启 开机 autostart settings')">
          <div class="sc-head">
            <WsIcon name="settings" size="xs" />
            <span>系统集成</span>
          </div>
          <div class="set-row">
            <span>开机自启</span>
            <label class="set-toggle">
              <input type="checkbox" :checked="autostartOn" @change="onToggleAutostart" />
              <span class="set-toggle-slider"></span>
            </label>
            <span class="sm-row-hint">登录系统后自动启动 WorldSea</span>
          </div>
        </div>

        <div v-else-if="idx === 1" class="set-card deck-card" :class="cls" :data-index="1" v-show="match('存储 概览 空间 实体 关系 文件 一致性 stats storage')">
          <div class="sc-head">
            <WsIcon name="dashboard" size="xs" />
            <span>存储概览</span>
            <TuiButton size="sm" variant="ghost" @click="onRefreshStats" :disabled="statsScanning">
              刷新统计
            </TuiButton>
          </div>
          <div class="sm-stats-grid">
            <div class="sm-stat-item">
              <span class="sm-stat-value">{{ stats.totalUsageMB.toFixed(1) }} MB</span>
              <span class="sm-stat-label">数据占用（估算）</span>
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
              <span class="sm-stat-value">{{ stats.fileTotalMB.toFixed(1) }} MB</span>
              <span class="sm-stat-label">文件体积</span>
            </div>
            <div class="sm-stat-item">
              <span class="sm-stat-value">{{ stats.kvCount }}</span>
              <span class="sm-stat-label">键值项</span>
            </div>
          </div>
          <div class="sm-orphan-hint" v-if="stats.orphanFileCount !== null && stats.orphanFileCount > 0">
            <WsIcon name="warning" size="xs" />
            <span>孤立文件: {{ stats.orphanFileCount }} 个</span>
          </div>
          <div class="sm-consistency-row">
            <span>实体/关系体检（悬空关系、重名、失效引用等 10 项）</span>
            <TuiButton size="sm" variant="secondary" @click="openConsistencyCheck">打开一致性检查</TuiButton>
          </div>
        </div>

        <div v-else-if="idx === 2" class="set-card deck-card" :class="cls" :data-index="2" v-show="match('孤立 文件 清理 扫描 orphan cleanup')">
          <div class="sc-head">
            <WsIcon name="delete" size="xs" />
            <span>孤立文件清理</span>
            <TuiButton size="sm" variant="ghost" @click="onScanOrphans" :disabled="orphanScanning">
              {{ orphanScanning ? `扫描中 ${scanProgress}%` : '扫描' }}
            </TuiButton>
          </div>
          <div v-if="orphans.length > 0" class="sm-orphan-list">
            <div class="sm-orphan-actions">
              <TuiButton size="sm" variant="ghost" @click="selectAll">全选</TuiButton>
              <TuiButton size="sm" variant="ghost" @click="deselectAll">全不选</TuiButton>
              <span class="sm-selected-info">已选 {{ selectedCount }} 项 ({{ formatSize(selectedSize) }})</span>
            </div>
            <div v-for="o in orphans" :key="o.id" class="sm-orphan-item">
              <TuiCheckbox :model-value="selectedIds.has(o.id)" @update:model-value="toggleSelect(o.id)" />
              <span class="sm-orphan-name">{{ o.name }}</span>
              <span class="sm-orphan-size">{{ formatSize(o.sizeEstimate) }}</span>
            </div>
            <div class="sm-orphan-actions">
              <TuiButton size="sm" variant="danger" @click="onCleanSelected" :disabled="selectedCount === 0 || isCleaning">
                清理选中项
              </TuiButton>
              <TuiButton size="sm" variant="danger" @click="onCleanAll" :disabled="isCleaning">
                清理全部
              </TuiButton>
            </div>
          </div>
          <div v-else-if="!orphanScanning" class="sm-empty-hint">
            {{ stats.orphanFileCount === 0 ? '未发现孤立文件' : '点击"扫描"检测孤立文件' }}
          </div>
        </div>
      </template>
    </CardDeck>
  </div>
</template>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle）见 ui-kit settings-panels.css。
   本面板私有：布局类（sm-*）与 sc-head 的 flex 覆盖（标题行右侧带操作按钮，同 Plugins 特例） */
.sm-tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sc-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sc-head > span {
  flex: 1;
  min-width: 0;
}
.set-row .set-toggle { margin-left: auto; }
.sm-row-hint { margin-left: 12px; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
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
.sm-consistency-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-md);
  font-size: var(--text-body-sm-font-size);
  color: var(--color-text-secondary);
}
.sm-consistency-row > span {
  flex: 1;
  min-width: 0;
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
</style>
