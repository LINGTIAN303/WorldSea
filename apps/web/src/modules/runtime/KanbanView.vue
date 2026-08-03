<template>
  <div class="kanban-view" @keydown.escape="editingField = null">
    <!-- 工具栏 -->
    <div class="toolbar">
      <button class="btn-primary" @click="openNewForm">＋ 新建</button>
      <input v-model="searchQuery" class="search-input" placeholder="搜索卡片..." />
    </div>

    <!-- 看板列 -->
    <div class="kanban-board">
      <KanbanColumn
        v-for="col in columns"
        :key="col.value"
        :col="col"
        :display-fields="displayFields"
        @select="selectedCard = $event"
        @drag-start="onDragStart"
        @drag-end="onDragEnd"
        @drop="onDrop"
        @add-card="onAddCard"
      />
    </div>

    <!-- 详情面板 -->
    <div v-if="selectedCard" class="detail-panel">
      <button class="detail-close" @click="selectedCard = null">✕</button>
      <div class="dp-header">
        <span class="dp-avatar"><WsIcon name="manuscript" size="sm" /></span>
        <div>
          <input v-if="editing" v-model="editForm._name" class="dp-name-input" />
          <h2 v-else>{{ selectedCard.name }}</h2>
        </div>
        <button class="detail-edit-toggle" :class="{active:editing}" @click="editing ? cancelEdit() : startEdit()">
          {{ editing ? '取消' : '编辑' }}
        </button>
      </div>
      <div class="detail-fields">
        <DetailField v-for="f in allFields" :key="f.key" :label="f.label" :value="selectedCard.properties[f.key]"
          :editing="editing" :type="f.type as any" :options="f.options"
          @update:value="editForm[f.key]=$event" @commit="saveEdit" />
      </div>
      <DetailField label="描述" :value="selectedCard.description" :editing="editing" type="textarea"
        @update:value="editForm._description=$event" @commit="saveEdit" />
      <div class="detail-actions" v-if="!editing">
        <button class="btn-danger btn-sm" @click="deleteCard">删除</button>
      </div>
      <div class="detail-edit-bar" v-if="editing">
        <button class="btn-primary btn-sm" @click="saveEdit()">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import type { ModuleViewConfig } from '../types'
import { DetailField, useEntityEdit } from '@worldsmith/plugin-sdk'
import KanbanColumn from './KanbanColumn.vue'

const props = defineProps<{
  viewConfig: ModuleViewConfig
  entityType: string
}>()

const es = useEntityStore()

/* —— 看板配置 —— */
const groupByField = (props.viewConfig.viewOptions?.groupBy as string) || 'status'
const columnOrder = (props.viewConfig.viewOptions?.columnOrder as string[]) || []
const displayFieldKeys = (props.viewConfig.viewOptions?.cardFields as string[]) || []
const sortBy = (props.viewConfig.viewOptions?.cardSortBy as string) || ''
const sortOrder = (props.viewConfig.viewOptions?.cardSortOrder as string) || 'asc'

/* —— 状态 —— */
const searchQuery = ref('')
const selectedCard = ref<Entity | null>(null)
const editingField = ref<string | null>(null)

// 拖拽状态
let draggedCardId: string | null = null
let draggedFromCol: string | null = null

const { isEditing: editing, editForm, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedCard)

/* —— Schema —— */
const schema = computed(() => entitySchemaRegistry.get(props.entityType))
const allFields = computed(() => schema.value?.fields ?? [])
const groupByOptions = computed(() => {
  const gf = allFields.value.find(f => f.key === groupByField)
  return gf?.options ?? []
})

/* 展示字段 */
const displayFields = computed(() => {
  return allFields.value.filter(f => displayFieldKeys.includes(f.key))
})

/* 过滤后的实体列表 */
const entities = computed(() => {
  let list = (es.entities ?? []).filter(e => e && e.type === props.entityType)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(e => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
  }
  return list
})

/* 看板列 */
const columns = computed(() => {
  const grouped: Record<string, Entity[]> = {}
  for (const e of entities.value) {
    const val = String(e.properties[groupByField] ?? '')
    if (!grouped[val]) grouped[val] = []
    grouped[val].push(e)
  }

  const cols = columnOrder.length > 0 ? columnOrder : groupByOptions.value
  return cols.map(val => {
    const cards = grouped[val] || []
    if (sortBy) {
      cards.sort((a, b) => {
        const va = String(a.properties[sortBy] ?? '')
        const vb = String(b.properties[sortBy] ?? '')
        return sortOrder === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb)
      })
    }
    return {
      value: val,
      label: val || '未分组',
      cards,
    }
  }).filter(col => columnOrder.length > 0 || col.cards.length > 0)
})

/* —— 拖拽 —— */
function onDragStart(cardId: string, col: string) {
  draggedCardId = cardId
  draggedFromCol = col
}

function onDragEnd() {
  draggedCardId = null
  draggedFromCol = null
}

async function onDrop(targetCol: string) {
  if (!draggedCardId || draggedFromCol === targetCol) return
  await es.update(draggedCardId, { properties: { ...(es.entityMap.get(draggedCardId)?.properties ?? {}), [groupByField]: targetCol } })
  await es.loadByType(props.entityType)
  draggedCardId = null
  draggedFromCol = null
}

/* —— 内联新建 —— */
async function onAddCard(col: string, title: string) {
  const now = new Date().toISOString()
  const id = props.entityType + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  await es.add({
    id,
    type: props.entityType,
    name: title,
    description: '',
    properties: { [groupByField]: col },
    tags: [],
    createdAt: now,
    updatedAt: now,
  } as Entity)
  await es.loadByType(props.entityType)
}

/* —— 新建弹窗 —— */
function openNewForm() {
  selectedCard.value = null
  // 暂时用内联新建替代
  if (columns.value.length > 0) {
    // 触发第一列的"添加"按钮：通过广播事件让对应子组件聚焦
    window.dispatchEvent(new CustomEvent('ws-kanban-start-inline', { detail: { col: columns.value[0].value } }))
  }
}

/* —— 删除 —— */
async function deleteCard() {
  if (!selectedCard.value) return
  await es.remove(selectedCard.value.id)
  selectedCard.value = null
  await es.loadByType(props.entityType)
}
</script>

<style scoped>
.kanban-view { display: flex; flex-direction: column; height: 100%; padding: 20px; overflow: hidden; }
.kanban-board { display: flex; gap: 12px; flex: 1; overflow-x: auto; padding-bottom: 12px; }
.detail-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 320px; background: var(--card-bg, #fff); border-left: 1px solid var(--border-color, #e5e7eb); padding: 16px; overflow-y: auto; z-index: 100; box-shadow: -4px 0 12px rgba(0,0,0,0.06); }
.detail-close { position: absolute; top: 12px; right: 12px; background: transparent; border: none; font-size: 18px; cursor: pointer; color: var(--text-tertiary); }
.dp-header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.dp-avatar { color: var(--primary, #4f46e5); }
.dp-header h2 { margin: 0; font-size: 18px; flex: 1; }
.dp-name-input { width: 100%; padding: 4px 8px; border: 1px solid var(--border-color, #ddd); border-radius: 4px; font-size: 16px; font-family: inherit; }
.detail-edit-toggle { border: 1px solid var(--border-color, #ddd); background: transparent; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: var(--font-size-sm); }
.detail-edit-toggle.active { border-color: var(--primary, #4f46e5); color: var(--primary, #4f46e5); }
.detail-fields { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
.detail-actions { margin-top: 16px; }
.detail-edit-bar { margin-top: 16px; }
</style>