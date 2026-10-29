<template>
  <div class="gallery-view">
    <!-- 筛选 → R3 收束条 -->
    <Teleport to="#view-toolbar-filter-body">
      <CustomDropdown v-model="sourceFilter" :options="SOURCE_OPTIONS" />
      <CustomDropdown v-model="typeFilter" :options="typeOptions" />
      <input v-model="keyword" class="gg-search" type="text" placeholder="搜索名称…">
    </Teleport>
    <!-- 动作 → R3 动作落点 -->
    <Teleport to="#view-toolbar-actions">
      <span class="gg-count">{{ items.length }} 项</span>
    </Teleport>

    <div v-if="items.length > 0" class="gg-grid" :class="{ 'is-grid-entering': gridEntering }">
      <button
        v-for="item in items"
        :key="item.key"
        class="gg-card"
        :title="`${item.entity.name} · ${item.sourceLabel}`"
        @click="openItem(item)"
      >
        <EntityCardCover :entity="item.entity" cover-field-key="coverImage" />
        <span class="gg-badge">{{ item.sourceLabel }}</span>
        <span class="gg-name">{{ item.entity.name }}</span>
      </button>
    </div>
    <div v-else class="gg-empty">
      <WsIcon name="image" :size="28" :stroke-width="1.5" />
      <p>暂无图片——为实体设置封面或形象图、在画板创作后，这里会汇总展示</p>
    </div>

    <!-- 资产预览浮层：FilePreview 与笔记本素材 tab 同款（path 直读，四渲染器分发） -->
    <div v-if="previewPath" class="gg-preview-overlay" @click.self="previewPath = null">
      <div class="gg-preview-panel">
        <button class="gg-preview-close" title="关闭预览" @click="previewPath = null"><WsIcon name="close" size="sm" /></button>
        <FilePreview :path="previewPath" :name="previewName" :size="0" @close="previewPath = null" />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { WsIcon, useViewEntering } from '@worldsea/ui-kit'
import { useEntityStore, entitySchemaRegistry, type Entity } from '@worldsea/entity-core'
import { CustomDropdown, EntityCardCover } from '@worldsea/plugin-sdk'
import { collectGalleryItems, type GalleryItem } from './galleryItems'
import { mimeFromExt } from '@/composables/imageAssets'
import { resolveEntityDataDir } from '@/composables/workspace'
import FilePreview from '@/components/files/FilePreview.vue'

const SOURCE_OPTIONS = [
  { value: 'all', label: '全部来源' },
  { value: 'cover', label: '封面' },
  { value: 'portrait', label: '形象图' },
  { value: 'video', label: '视频' },
  { value: 'drawing', label: '画板作品' },
  { value: 'asset', label: '资产文件' },
]

const entityStore = useEntityStore()
const sourceFilter = ref('all')
const typeFilter = ref('all')
const keyword = ref('')

/** 只在来源/类型筛选变化时淡入；关键词逐字输入不做动画，避免高频闪烁 */
const gridEntering = useViewEntering(() => `${sourceFilter.value}|${typeFilter.value}`, 150)

/** 实体类型选项（仅收录当前存在实体的类型，按注册表 label 展示） */
const typeOptions = computed(() => {
  const types = [...new Set(entityStore.entities.map(e => e.type))]
  return [
    { value: 'all', label: '全部类型' },
    ...types.map(t => ({ value: t, label: entitySchemaRegistry.getLabel(t) || t })),
  ]
})

const allItems = computed(() => collectGalleryItems(entityStore.entities))

/** assets/ 目录图片资产（挂账②：与实体条目合并展示；id 存磁盘路径供预览） */
const assetItems = ref<GalleryItem[]>([])

onMounted(() => { void loadAssetItems() })

async function loadAssetItems(): Promise<void> {
  try {
    const root = await resolveEntityDataDir()
    if (!root) return
    const entries = await invoke<Array<{ name: string; path: string; isDir: boolean; size: number; modified: string | null }>>(
      'cmd_fs_list', { path: `${root}/assets`, recursive: false },
    )
    assetItems.value = entries
      .filter(e => !e.isDir && mimeFromExt(e.name) !== '')
      .map(e => ({
        key: `asset:${e.path}`,
        entity: {
          id: e.path, type: '__asset__', name: e.name, description: '', properties: {}, tags: [],
          coverImage: convertFileSrc(e.path), createdAt: e.modified ?? '', updatedAt: e.modified ?? '',
        } as Entity,
        source: 'asset' as const,
        sourceLabel: '资产',
      }))
      .sort((a, b) => a.entity.name.localeCompare(b.entity.name, 'zh'))
  } catch {
    // assets 目录不存在 / 未就绪 → 无资产条目（非致命）
  }
}

const items = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return [...allItems.value, ...assetItems.value].filter(item => {
    if (sourceFilter.value !== 'all' && item.source !== sourceFilter.value) return false
    if (typeFilter.value !== 'all' && item.entity.type !== typeFilter.value) return false
    if (kw && !item.entity.name.toLowerCase().includes(kw)) return false
    return true
  })
})

/** 实体卡跳源实体；资产卡开内嵌预览（无实体可跳） */
const previewPath = ref<string | null>(null)
const previewName = ref('')

function openItem(item: GalleryItem) {
  if (item.source === 'asset') {
    previewPath.value = item.entity.id
    previewName.value = item.entity.name
    return
  }
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { entityType: item.entity.type, entityId: item.entity.id } }))
}
</script>
<style scoped>
.gallery-view { display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding: 12px 16px; }
/* 筛选条内搜索框（R3 收束条内联样式，随条高 44px） */
.gg-search {
  height: 24px; width: 160px; padding: 0 8px; font-size: var(--font-size-sm);
  border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  background: var(--color-bg-elevated); color: var(--color-text-primary); outline: none;
}
.gg-search:focus { border-color: var(--color-accent); }
.gg-search::placeholder { color: var(--color-text-tertiary); }
.gg-count { font-size: var(--font-size-sm); color: var(--color-text-secondary); white-space: nowrap; }

.gg-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px;
  align-content: start; flex: 1;
}
.gg-grid.is-grid-entering { animation: ws-view-in var(--dur-fast) var(--ease-out); }
:root[data-anim-content='off'] .gg-grid.is-grid-entering,
:root[data-reduce-motion='on'] .gg-grid.is-grid-entering { animation: none; }
.gg-card {
  position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 0;
  padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-bg-elevated); overflow: hidden; cursor: pointer; text-align: left;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.gg-card:hover { border-color: var(--color-accent); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
/* EntityCardCover 内部高度写死 110px，图库卡抬高一档（scoped 打子组件内部须 :deep） */
.gg-card :deep(.card-cover),
.gg-card :deep(.card-cover-live),
.gg-card :deep(.card-cover-placeholder) { height: 150px; }
.gg-badge {
  position: absolute; top: 6px; left: 6px; z-index: 1;
  padding: 1px 6px; border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-bg-elevated) 82%, transparent);
  font-size: var(--font-size-xs); color: var(--color-text-secondary);
}
.gg-name {
  padding: 6px 8px; font-size: var(--font-size-sm); color: var(--color-text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gg-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; color: var(--color-text-tertiary); font-size: var(--font-size-sm); text-align: center;
  padding: 32px;
}

/* 资产预览浮层（notebook 素材 tab 同款形态） */
.gg-preview-overlay {
  position: fixed; inset: 0; z-index: var(--z-modal, 1000);
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--color-bg, #000) 62%, transparent);
}
.gg-preview-panel {
  position: relative; width: min(880px, 86vw); max-height: 86vh; overflow: auto;
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); padding: 12px;
}
.gg-preview-close {
  position: absolute; top: 8px; right: 8px; z-index: 1;
  display: inline-flex; padding: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-xs);
  background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer;
}
.gg-preview-close:hover { color: var(--color-text-primary); border-color: var(--color-text-secondary); }
</style>
