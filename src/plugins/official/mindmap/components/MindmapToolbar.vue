<template>
  <div class="mindmap-toolbar">
    <input :value="searchQuery" class="search-input" placeholder="搜索节点...  (Enter 下一处)" @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)" @keydown.enter="$emit('search-next')" @keydown.shift.enter="$emit('search-prev')" />

    <span v-if="searchMatchCount > 0" class="search-counter">{{ searchMatchIndex + 1 }} / {{ searchMatchCount }}</span>

    <CustomDropdown :model-value="layout" :options="layoutOptions" class="layout-dropdown" @update:model-value="$emit('update:layout', $event)" />

    <div v-if="safeTypes && safeTypes.size !== undefined" class="type-filters">
      <label v-for="type in typeFilters" :key="type.value" class="type-chip"
        :class="{ active: safeTypes.has(type.value) }"
        :style="{ borderColor: type.color, background: safeTypes.has(type.value) ? type.color + '18' : 'transparent' }">
        <input type="checkbox" :checked="safeTypes.has(type.value)" @change="$emit('toggle-type', type.value)" />
        {{ type.label }}
      </label>
    </div>

    <div class="toolbar-actions">
      <div class="action-group">
        <button v-if="canGoBack" class="icon-btn" @click="$emit('go-back')" title="返回上层 (Esc)">←</button>
        <button class="icon-btn" :class="{ active: detailPanelVisible }" @click="$emit('toggle-detail')" title="详情侧栏 (I)"><WsIcon name="outline" size="sm" /></button>
        <button class="icon-btn" :class="{ active: minimapVisible }" @click="$emit('toggle-minimap')" title="小地图 (M)"><WsIcon name="search" size="sm" /></button>
      </div>

      <div class="action-group">
        <button class="icon-btn" :disabled="!canUndo" :class="{ disabled: !canUndo }" @click="$emit('undo')" title="撤销 (Ctrl+Z)"><WsIcon name="refresh" size="sm" /></button>
        <button class="icon-btn" :disabled="!canRedo" :class="{ disabled: !canRedo }" @click="$emit('redo')" title="重做 (Ctrl+Y)"><WsIcon name="refresh" size="sm" /></button>
        <button v-if="editMode" class="icon-btn" @click="$emit('add-textbox')" title="添加文本框"><WsIcon name="edit" size="sm" /></button>
        <button v-if="editMode" class="icon-btn" @click="$emit('add-image')" title="添加图片"><WsIcon name="image" size="sm" /></button>
        <button v-if="editMode" class="icon-btn" @click="$emit('add-note')" title="添加备注"><WsIcon name="outline" size="sm" /></button>
        <button v-if="editMode" class="icon-btn" @click="$emit('add-link')" title="添加链接"><WsIcon name="link" size="sm" /></button>
        <button v-if="editMode" class="icon-btn" @click="$emit('add-group')" title="添加分组"><WsIcon name="item" size="sm" /></button>
        <button v-if="editMode" class="icon-btn" @click="$emit('add-center')" title="添加中心节点"><WsIcon name="star" size="sm" /></button>
      </div>

      <div v-if="selectedCount >= 2" class="action-group">
        <button class="icon-btn" @click="$emit('align-selection', 'h')" title="水平对齐"><WsIcon name="arrow-up" size="sm" /></button>
        <button class="icon-btn" @click="$emit('align-selection', 'v')" title="垂直对齐"><WsIcon name="refresh" size="sm" /></button>
        <button class="icon-btn" @click="$emit('distribute-selection')" title="均匀分布">≣</button>
        <button class="icon-btn" @click="$emit('create-section-from-selection')" title="创建分组框"><WsIcon name="item" size="sm" /></button>
      </div>

      <div class="action-group">
        <button class="icon-btn" :class="{ active: editMode }" @click="$emit('toggle-edit-mode')" title="编辑模式 (E)"><WsIcon name="edit" size="sm" /></button>
        <button class="icon-btn" :class="{ active: freeDrawMode }" @click="$emit('toggle-free-draw')" title="自由绘图 (D)"><WsIcon name="brush" size="sm" /></button>
        <button class="icon-btn" @click="$emit('toggle-ai-suggest')" title="AI 关系建议 (Ctrl+J)"><WsIcon name="concept" size="sm" /></button>
        <button class="icon-btn primary" @click="$emit('ai-organize')" title="AI 整理（让 Agent 帮你布局/找孤立/找环）"><WsIcon name="magic" size="sm" /> AI</button>
      </div>

      <div class="action-group">
        <button class="icon-btn" @click="$emit('fit')" title="适应视图">⊞</button>
        <button class="icon-btn" @click="$emit('zoom-in')" title="放大">＋</button>
        <button class="icon-btn" @click="$emit('zoom-out')" title="缩小">－</button>
        <span class="zoom-level">{{ zoomLevel }}%</span>
      </div>

      <div class="action-group">
        <button class="icon-btn" @click="$emit('export-png')" title="导出 PNG">🖼</button>
        <button class="icon-btn" @click="$emit('export-svg')" title="导出 SVG">📐</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import { LAYOUT_OPTIONS } from '../mindmapConfig'
import WsIcon from '../../../../ui/WsIcon.vue'

const props = withDefaults(defineProps<{
  searchQuery: string
  searchMatchCount?: number
  searchMatchIndex?: number
  layout: string
  enabledTypes?: Set<string>
  editMode: boolean
  freeDrawMode: boolean
  zoomLevel: number
  canGoBack: boolean
  detailPanelVisible: boolean
  minimapVisible: boolean
  canUndo: boolean
  canRedo: boolean
  selectedCount: number
}>(), {
  searchMatchCount: 0,
  searchMatchIndex: 0,
  enabledTypes: () => new Set<string>(),
})

// 防御性：若 prop 在挂载前为 undefined，提供空 Set 兜底
const safeTypes = computed(() => props.enabledTypes instanceof Set ? props.enabledTypes : new Set<string>())

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  'search-next': []
  'search-prev': []
  'update:layout': [value: string]
  'toggle-type': [value: string]
  'update:enabledTypes': [value: Set<string>]
  'toggle-edit-mode': []
  'toggle-free-draw': []
  'toggle-ai-suggest': []
  'ai-organize': []
  'add-textbox': []
  'add-image': []
  'add-note': []
  'add-link': []
  'add-group': []
  'add-center': []
  fit: []
  'zoom-in': []
  'zoom-out': []
  'go-back': []
  'toggle-detail': []
  'toggle-minimap': []
  undo: []
  redo: []
  'align-selection': [direction: 'h' | 'v']
  'distribute-selection': []
  'create-section-from-selection': []
  'export-png': []
  'export-svg': []
}>()

const layoutOptions = LAYOUT_OPTIONS

const typeFilters = [
  { value: 'character', label: '角色', color: '#4a6cf7' },
  { value: 'region', label: '区域', color: '#27ae60' },
  { value: 'event', label: '事件', color: '#e67e22' },
  { value: 'organization', label: '势力', color: '#e74c3c' },
  { value: 'concept', label: '概念', color: '#9b59b6' },
  { value: 'item', label: '道具', color: '#f39c12' },
  { value: 'textbox', label: '文本框', color: '#eab308' },
  { value: 'image', label: '图片', color: '#999' },
  { value: 'note', label: '备注', color: '#ca8a04' },
  { value: 'link', label: '链接', color: '#3b82f6' },
  { value: 'group', label: '分组', color: '#999' },
]
</script>

<style scoped>
.mindmap-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: var(--card-bg);
  border-bottom: 1px solid var(--border-color); flex-wrap: wrap;
}
.search-input {
  padding: 4px 10px;
  font-size: var(--font-size-sm);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--text-color);
  outline: none;
  min-width: 180px;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}
.search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--color-primary-subtle); }
.search-counter {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding: 2px 6px;
  background: var(--color-bg-elevated);
  border-radius: 3px;
}
.type-filters { display: flex; gap: 4px; flex-wrap: wrap; }
.type-chip {
  display: flex; align-items: center; gap: 3px;
  padding: 2px 6px; border-radius: 4px; border: 1px solid;
  font-size: var(--font-size-xs); cursor: pointer; white-space: nowrap;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}
.type-chip:hover { transform: translateY(-1px); }
.type-chip input { width: 12px; height: 12px; margin: 0; cursor: pointer; accent-color: var(--primary); }
.toolbar-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }
.action-group { display: flex; gap: 2px; align-items: center; padding: 0 4px; border-right: 1px solid var(--border-color); }
.action-group:last-child { border-right: none; }
.icon-btn {
  width: 28px; height: 28px; border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); background: transparent; cursor: pointer;
  font-size: var(--font-size-base); display: flex; align-items: center; justify-content: center;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
  color: var(--text-secondary);
}
.icon-btn:hover { background: var(--hover-bg); color: var(--text-color); transform: translateY(-1px); }
.icon-btn.active { background: var(--color-primary-subtle, var(--primary-light)); border-color: var(--primary); color: var(--primary); }
.icon-btn.primary { background: linear-gradient(135deg, var(--primary), var(--color-primary-hover, var(--primary))); color: white; border-color: var(--primary); font-weight: var(--font-weight-semibold); }
.icon-btn.primary:hover { opacity: 0.9; }
.icon-btn.disabled, .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn.disabled:hover, .icon-btn:disabled:hover { background: transparent; transform: none; }
.zoom-level { font-size: var(--font-size-xs); color: var(--text-tertiary); min-width: 36px; text-align: center; }
</style>
