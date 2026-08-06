<template>
  <div class="global-search-overlay" v-if="show" @click.self="close">
    <div class="global-search-panel" role="search" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="gs-header">
        <input ref="searchInput" v-model="query" aria-label="全局搜索" placeholder="搜索实体、关系、标签..." @keydown.escape="close" @keydown.enter="search" />
        <button class="gs-close" @click="close">✕</button>
      </div>
      <div class="gs-filters">
        <select v-model="typeFilter">
          <option value="">所有类型</option>
          <option v-for="t in allTypes" :key="t.typeKey" :value="t.typeKey"><WsIcon :name="entitySchemaRegistry.getIconName(t.typeKey)" size="xs" /> {{ t.label }}</option>
        </select>
        <input v-model="tagFilter" placeholder="按标签过滤..." class="gs-tag-input" />
        <label class="gs-rel-toggle"><input type="checkbox" v-model="showRelations" /> 关系</label>
      </div>
      <div class="gs-results">
        <div v-if="!query && !tagFilter" class="gs-hint">输入关键词或选择筛选条件</div>
        <div v-for="e in filteredEntities" :key="e.id" class="gs-item" @click="goToEntity(e)">
          <WsIcon class="gs-icon" :name="typeIcon(e.type)" size="sm" />
          <span class="gs-name">{{ e.name }}</span>
          <span class="gs-type-badge">{{ typeLabel(e.type) }}</span>
          <span class="gs-tags" v-if="e.tags?.length">[{{ e.tags.join(', ') }}]</span>
          <span class="gs-desc">{{ e.description?.slice(0, 60) }}</span>
        </div>
        <div v-if="showRelations" v-for="r in filteredRelations" :key="r.id" class="gs-item gs-rel" @click="goToRelation(r)">
          <WsIcon class="gs-icon" name="link" size="sm" />
          <span class="gs-name">{{ r.label || r.type }}</span>
          <span class="gs-desc">{{ r.sourceId }} → {{ r.targetId }}</span>
        </div>
        <div v-if="hasQuery && filteredEntities.length === 0 && (!showRelations || filteredRelations.length === 0)" class="gs-empty">无匹配结果</div>
      </div>
      <div class="gs-footer">{{ filteredEntities.length }} 个实体{{ showRelations ? `, ${filteredRelations.length} 个关系` : '' }}</div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRelationStore } from '@worldsmith/entity-core'
import { useResizable } from '@worldsmith/ui-kit'
import { entitySchemaRegistry } from '@worldsmith/entity-core'
import { storage } from '@worldsmith/entity-core'
import { watchDebounced } from '@worldsmith/perf-kit'
import WsIcon from '../WsIcon.vue'
import type { Entity } from '@worldsmith/entity-core'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const relationStore = useRelationStore()
const modalResizable = useResizable({ panelId: 'modal-global-search', defaultWidth: 620, minWidth: 360 })
const searchInput = ref<HTMLInputElement>()
// 原始输入(每次按键立即变化,仅用于绑定 v-model)
const query = ref('')
const typeFilter = ref('')
const tagFilter = ref('')
const showRelations = ref(false)

// ===== 性能优化1:debounce 150ms =====
// query / tagFilter 防抖后再驱动 computed,避免每次按键全量 filter
const debouncedQuery = ref('')
const debouncedTagFilter = ref('')
const stopDebounceQuery = watchDebounced(() => query.value, () => { debouncedQuery.value = query.value }, { debounce: 150 })
const stopDebounceTag = watchDebounced(() => tagFilter.value, () => { debouncedTagFilter.value = tagFilter.value }, { debounce: 150 })

// ===== 性能优化2:预生成小写字段 =====
// 加载实体时一次性 map 出 _nameLow / _descLow / _tagsLow,filter 时直接用,避免每次按键重复 toLowerCase
interface SearchableEntity extends Entity {
  _nameLow: string
  _descLow: string
  _tagsLow: string[]
}
const allEntities = ref<SearchableEntity[]>([])

watch(() => props.show, async (v) => {
  if (v) {
    const raw = await storage.getAllEntities()
    allEntities.value = raw.map(e => ({
      ...e,
      _nameLow: (e.name || '').toLowerCase(),
      _descLow: (e.description || '').toLowerCase(),
      _tagsLow: (e.tags || []).map(t => t.toLowerCase()),
    }))
    nextTick(() => searchInput.value?.focus())
  }
})

const allTypes = computed(() => entitySchemaRegistry.getAll())
const hasQuery = computed(() => debouncedQuery.value.length > 0 || debouncedTagFilter.value.length > 0)

// ===== 性能优化3:tagFilter 拆词缓存(防抖后变化时才拆,不在 computed 内重复拆) =====
const loweredTags = ref<string[]>([])
watch(() => debouncedTagFilter.value, (v) => {
  loweredTags.value = v.toLowerCase().split(/[,，\s]+/).filter(Boolean)
})

const filteredEntities = computed(() => {
  let items: SearchableEntity[] = allEntities.value
  if (typeFilter.value) items = items.filter(e => e.type === typeFilter.value)
  if (debouncedQuery.value) {
    const q = debouncedQuery.value.toLowerCase()
    // 直接用预生成的小写字段,避免每次按键重复 toLowerCase
    items = items.filter(e => e._nameLow.includes(q) || e._descLow.includes(q))
  }
  const tags = loweredTags.value
  if (tags.length) {
    // 内层 some 提前 break(ES2023 some 命中即返回),双层 some 已是最优结构
    items = items.filter(e => e._tagsLow.some(t => tags.some(tag => t.includes(tag))))
  }
  return items
})

const filteredRelations = computed(() => {
  if (!showRelations.value || !debouncedQuery.value) return []
  const q = debouncedQuery.value.toLowerCase()
  return relationStore.relations.filter(r => (r.label || '').toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
})

function typeIcon(type: string) {
  return entitySchemaRegistry.getIconName(type)
}

function typeLabel(type: string) {
  return entitySchemaRegistry.getLabel(type)
}

function goToEntity(e: { id: string; type: string }) {
  close()
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('ws-navigate', { detail: { view: e.type, entityId: e.id } }))
  }, 50)
}

function goToRelation(_r: { id: string }) {
  close()
}

function search() { /* search handler - already reactive */ }
function close() { query.value = ''; tagFilter.value = ''; debouncedQuery.value = ''; debouncedTagFilter.value = ''; loweredTags.value = []; emit('close') }

onBeforeUnmount(() => {
  stopDebounceQuery()
  stopDebounceTag()
})
</script>

<style scoped>
.global-search-overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: var(--overlay-bg);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 80px;
  backdrop-filter: blur(4px);
}
.global-search-panel {
  position: relative; max-height: 72vh; background: var(--glass-bg, var(--content-bg));
  border: 1px solid var(--glass-border, var(--border));
  border-radius: var(--radius-xl, 16px); box-shadow: var(--shadow-xl);
  display: flex; flex-direction: column; overflow: hidden;
  backdrop-filter: blur(var(--glass-blur));
}
.gs-header { display: flex; padding: 14px 18px; gap: 8px; border-bottom: 1px solid var(--border); }
.gs-header input { flex: 1; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: var(--font-size-md); outline: none; background: var(--input-bg); color: var(--text-color); }
.gs-header input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); }
.gs-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-sm); color: var(--text-secondary); }
.gs-close:hover { background: var(--hover-bg); color: var(--text-color); }
.gs-filters { display: flex; padding: 10px 18px; gap: 8px; border-bottom: 1px solid var(--border); align-items: center; }
.gs-filters select, .gs-tag-input { padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color); }
.gs-tag-input { flex: 1; }
.gs-rel-toggle { font-size: var(--font-size-sm); display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; color: var(--text-secondary); }
.gs-results { flex: 1; overflow-y: auto; padding: 6px 0; min-height: 200px; }
.gs-hint, .gs-empty { text-align: center; padding: 48px 20px; color: var(--text-tertiary); font-size: var(--font-size-base); }
.gs-item { display: flex; align-items: center; gap: 10px; padding: 10px 18px; cursor: pointer; transition: background var(--transition-fast); border-radius: 0; }
.gs-item:hover { background: var(--gradient-subtle, var(--hover-bg)); }
.gs-item.gs-rel { opacity: 0.7; }
.gs-icon { font-size: var(--font-size-xl); flex-shrink: 0; }
.gs-name { font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); flex-shrink: 0; }
.gs-type-badge { font-size: var(--font-size-xs); padding: 2px 8px; border-radius: var(--radius-sm); background: var(--accent-bg); color: var(--accent); flex-shrink: 0; }
.gs-tags { font-size: var(--font-size-sm); color: var(--text-tertiary); }
.gs-desc { font-size: var(--font-size-sm); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gs-footer { padding: 8px 18px; border-top: 1px solid var(--border); font-size: var(--font-size-sm); color: var(--text-tertiary); }
.resize-handle-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>
