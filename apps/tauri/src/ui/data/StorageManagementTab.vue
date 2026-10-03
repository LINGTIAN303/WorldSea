<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { TuiButton, WsIcon } from '@worldsea/ui-kit'
import { CardDeck } from '@worldsea/ui-kit'
import TuiCheckbox from '@/components/ui/TuiCheckbox.vue'
import { useStorageStats } from '@worldsea/entity-core/composables'
import { useOrphanCleanup } from '@worldsea/entity-core/composables'
import { useEntityStore, getFileStorageBackend, entitySchemaRegistry } from '@worldsea/entity-core'
import { useToast } from '../../composables/useToast'
import { useSystemBridge } from '@/composables/useSystemBridge'
import { invoke } from '@/composables/transport'

const toast = useToast()
const { autostartEnabled, setAutostart } = useSystemBridge()
const autostartOn = ref(false)
const entityStore = useEntityStore()
const { stats, isScanning: statsScanning, refresh, scanOrphanCount } = useStorageStats()
const {
  orphans, selectedIds, isScanning: orphanScanning, isCleaning,
  scanProgress, scan, cleanSelected, cleanAll, selectAll, deselectAll, toggleSelect,
} = useOrphanCleanup()

// ── 项目目录 + 磁盘占用（cmd_fs_usage 递归真值，2026-10-02）──
interface FsUsageEntry { name: string; fileCount: number; size: number }
interface FsUsage { fileCount: number; totalSize: number; entries: FsUsageEntry[] }

const projectDir = ref<string | null>(null)
const usage = ref<FsUsage | null>(null)

async function refreshUsage(): Promise<void> {
  projectDir.value = getFileStorageBackend()?.projectDir ?? null
  const dir = projectDir.value
  if (!dir) {
    usage.value = null
    return
  }
  try {
    usage.value = await invoke<FsUsage>('cmd_fs_usage', { dir })
  } catch (err) {
    console.warn('[Storage] 目录占用统计失败:', err)
    usage.value = null
  }
}

async function openProjectDir(): Promise<void> {
  if (!projectDir.value) return
  try {
    await invoke('cmd_open_in_explorer', { path: projectDir.value })
  } catch (err) {
    console.warn('[Storage] 打开项目文件夹失败:', err)
    toast.toastError('打开项目文件夹失败')
  }
}

// ── 数据构成：按芽类型的实体数细分（纯前端 groupBy）──
const composition = computed(() => {
  const counts = new Map<string, number>()
  for (const e of entityStore.entities) counts.set(e.type, (counts.get(e.type) || 0) + 1)
  return [...counts.entries()]
    .map(([type, count]) => ({ type, label: entitySchemaRegistry.getLabel(type) || type, count }))
    .sort((a, b) => b.count - a.count)
})

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
  await refreshUsage()
}

async function onScanOrphans(): Promise<void> {
  await scan()
}

async function onCleanSelected(): Promise<void> {
  await cleanSelected(Array.from(selectedIds.value))
  await refresh()
  await refreshUsage()
}

async function onCleanAll(): Promise<void> {
  await cleanAll()
  await refresh()
  await refreshUsage()
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
  refreshUsage()
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
          <div class="sm-dir-row">
            <WsIcon name="folder" size="xs" />
            <span class="sm-dir-path" :title="projectDir || ''">{{ projectDir || '（未打开文件项目）' }}</span>
            <TuiButton size="sm" variant="ghost" :disabled="!projectDir" @click="openProjectDir">打开文件夹</TuiButton>
          </div>
          <div class="sm-stats-grid">
            <div class="sm-stat-item" :title="usage ? 'worlddata 数据目录逻辑大小（与资源管理器「大小」口径一致）' : undefined">
              <span class="sm-stat-value">{{ usage ? formatSize(usage.totalSize) : stats.totalUsageMB.toFixed(1) + ' MB' }}</span>
              <span class="sm-stat-label">{{ usage ? '数据目录占用' : '数据占用（估算）' }}</span>
            </div>
            <div class="sm-stat-item" title="文件原始字节；落盘为 base64 JSON，略大于此值">
              <span class="sm-stat-value">{{ stats.fileTotalMB.toFixed(1) }} MB</span>
              <span class="sm-stat-label">文件体积（原始）</span>
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
              <span class="sm-stat-value">{{ stats.kvCount }}</span>
              <span class="sm-stat-label">键值项</span>
            </div>
          </div>
          <!-- 磁盘占用分项：让总数可核对（entities/relations/.worldsea/… 各占多少） -->
          <div v-if="usage && usage.entries.length" class="sm-usage-list">
            <div v-for="en in usage.entries" :key="en.name" class="sm-usage-item">
              <span class="sm-usage-name" :title="en.name">{{ en.name }}</span>
              <span class="sm-usage-count">{{ en.fileCount }} 文件</span>
              <span class="sm-usage-size">{{ formatSize(en.size) }}</span>
            </div>
          </div>
          <div v-if="usage" class="sm-usage-note">
            实体/关系/文件均以 JSON 落盘（图片等二进制转 base64，实际略大于原始体积）；应用设置存于内部，不在此目录。
          </div>
          <div v-if="composition.length" class="sm-comp-row">
            <span v-for="c in composition.slice(0, 8)" :key="c.type" class="sm-comp-chip">{{ c.label }} × {{ c.count }}</span>
            <span v-if="composition.length > 8" class="sm-comp-chip">其他 × {{ composition.length - 8 }}</span>
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
.sm-dir-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 6px 8px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-md);
  font-size: var(--text-body-sm-font-size);
}
.sm-dir-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl; /* 长路径省略号保留末段（离文件名近的一端） */
  text-align: left;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
}
.sm-comp-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.sm-comp-chip {
  padding: 3px 10px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-pill, 999px);
  font-size: var(--text-caption-font-size);
  color: var(--color-text-secondary);
}
.sm-usage-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sm-usage-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-caption-font-size);
}
.sm-usage-item:hover { background: var(--color-bg-hover); }
.sm-usage-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}
.sm-usage-count { color: var(--color-text-tertiary); }
.sm-usage-size { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.sm-usage-note {
  margin-top: 6px;
  font-size: var(--text-caption-font-size);
  color: var(--color-text-tertiary);
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
