<template>
  <div class="gallery-view">
    <!-- 筛选 → R3 收束条 -->
    <Teleport to="#view-toolbar-filter-body">
      <CustomDropdown v-model="sourceFilter" :options="SOURCE_OPTIONS" />
      <CustomDropdown v-model="typeFilter" :options="typeOptions" />
      <input v-model="keyword" class="gg-search" type="text" placeholder="搜索实体名…">
    </Teleport>
    <!-- 动作 → R3 动作落点 -->
    <Teleport to="#view-toolbar-actions">
      <span class="gg-count">{{ items.length }} 项</span>
    </Teleport>

    <div v-if="items.length > 0" class="gg-grid">
      <button
        v-for="item in items"
        :key="item.key"
        class="gg-card"
        :title="`${item.entity.name} · ${item.sourceLabel}`"
        @click="openEntity(item.entity)"
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
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, entitySchemaRegistry, type Entity } from '@worldsea/entity-core'
import { CustomDropdown, EntityCardCover } from '@worldsea/plugin-sdk'
import { collectGalleryItems } from './galleryItems'

const SOURCE_OPTIONS = [
  { value: 'all', label: '全部来源' },
  { value: 'cover', label: '封面' },
  { value: 'portrait', label: '形象图' },
  { value: 'drawing', label: '画板作品' },
]

const entityStore = useEntityStore()
const sourceFilter = ref('all')
const typeFilter = ref('all')
const keyword = ref('')

/** 实体类型选项（仅收录当前存在实体的类型，按注册表 label 展示） */
const typeOptions = computed(() => {
  const types = [...new Set(entityStore.entities.map(e => e.type))]
  return [
    { value: 'all', label: '全部类型' },
    ...types.map(t => ({ value: t, label: entitySchemaRegistry.getLabel(t) || t })),
  ]
})

const allItems = computed(() => collectGalleryItems(entityStore.entities))

const items = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return allItems.value.filter(item => {
    if (sourceFilter.value !== 'all' && item.source !== sourceFilter.value) return false
    if (typeFilter.value !== 'all' && item.entity.type !== typeFilter.value) return false
    if (kw && !item.entity.name.toLowerCase().includes(kw)) return false
    return true
  })
})

/** 点卡跳源实体（Shell 单点导航：切视图 + 选中） */
function openEntity(entity: Entity) {
  window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { entityType: entity.type, entityId: entity.id } }))
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
</style>
