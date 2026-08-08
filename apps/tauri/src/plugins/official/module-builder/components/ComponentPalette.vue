<template>
  <div class="component-palette">
    <h4 class="cp-title">组件库</h4>
    <div v-for="cat in categories" :key="cat.id" class="cp-category">
      <h5 class="cp-cat-label"><WsIcon :name="cat.icon" size="xs" /> {{ cat.label }}</h5>
      <div
        v-for="comp in cat.components"
        :key="comp.typeId"
        class="cp-item"
        draggable="true"
        @dragstart="onDragStart(comp, $event)"
      >
        <span class="cp-item-icon"><WsIcon :name="comp.icon" size="xs" /></span>
        <span class="cp-item-label">{{ comp.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { getAllComponentTypes } from '../registry/componentTypeRegistry'
import type { ComponentTypeDefinition, ComponentCategory } from '../types/layoutSchema'

const CATEGORY_META: Record<string, { id: ComponentCategory; icon: string; label: string }> = {
  'detail-edit': { id: 'detail-edit', icon: 'settings', label: '详情与编辑' },
  'action-tool': { id: 'action-tool', icon: 'lightning', label: '操作与工具' },
  'search-filter': { id: 'search-filter', icon: 'search', label: '搜索与筛选' },
  'data-display': { id: 'data-display', icon: 'dashboard', label: '数据展示' },
  'visualization': { id: 'visualization', icon: 'dashboard', label: '可视化与图表' },
  'layout-container': { id: 'layout-container', icon: 'settings', label: '布局与容器' },
}

const categories = computed(() => {
  const all = getAllComponentTypes()
  const grouped = new Map<ComponentCategory, ComponentTypeDefinition[]>()
  for (const comp of all) {
    const list = grouped.get(comp.category) || []
    list.push(comp)
    grouped.set(comp.category, list)
  }
  const result = []
  for (const [catId, meta] of Object.entries(CATEGORY_META)) {
    const components = grouped.get(catId as ComponentCategory)
    if (components && components.length > 0) {
      result.push({ ...meta, components })
    }
  }
  return result
})

function onDragStart(comp: ComponentTypeDefinition, e: DragEvent) {
  e.dataTransfer!.setData('application/worldsmith-component-type', comp.typeId)
  e.dataTransfer!.effectAllowed = 'copy'
}
</script>

<style scoped>
.component-palette { width: 180px; border-right: 1px solid var(--border-color); padding: 12px; overflow-y: auto; flex-shrink: 0; }
.cp-title { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 12px; }
.cp-category { margin-bottom: 12px; }
.cp-cat-label { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0 0 6px; }
.cp-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px dashed var(--border-color); border-radius: 6px; margin-bottom: 4px; cursor: grab; font-size: var(--font-size-sm); color: var(--primary); transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s; }
.cp-item:hover { background: var(--hover-bg); border-color: var(--primary); }
.cp-item:active { cursor: grabbing; }
.cp-item-icon { font-size: var(--font-size-base); }
.cp-item-label { font-size: var(--font-size-sm); }
</style>
