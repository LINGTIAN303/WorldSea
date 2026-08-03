<template>
  <div class="kanban-view" @keydown.escape="editingField = null">
    <!-- 工具栏 -->
    <div class="toolbar">
      <button class="btn-primary" @click="openNewForm">＋ 新建</button>
      <input v-model="searchQuery" class="search-input" placeholder="搜索卡片..." />
    </div>

    <!-- 看板列 -->
    <div class="kanban-board">
      <div
        v-for="col in columns"
        :key="col.value"
        class="kanban-column"
        @drop="onDrop($event, col.value)"
        @dragover.prevent
      >
        <div class="kanban-column-header">
          <span class="kch-label">{{ col.label }}</span>
          <span class="kch-count">{{ col.cards.length }}</span>
        </div>

        <div class="kanban-cards">
          <div
            v-for="card in col.cards"
            :key="card.id"
            class="kanban-card"
            :draggable="true"
            @dragstart="onDragStart($event, card.id, col.value)"
            @dragend="onDragEnd"
            @touchstart.passive="onTouchStart($event, card.id, col.value)"
            @touchmove.prevent="onTouchMove($event)"
            @touchend="onTouchEnd($event)"
            @click="selectedCard = card"
          >
            <div class="kc-header">
              <span class="kc-name">{{ card.name }}</span>
            </div>
            <div class="kc-body">
              <div v-for="f in displayFields" :key="f.key" class="kc-field">
                <span class="kcf-label">{{ f.label }}:</span>
                <span class="kcf-value">{{ formatValue(card.properties[f.key], f) }}</span>
              </div>
            </div>
            <div v-if="card.tags?.length" class="kc-tags">
              <span v-for="tag in card.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
        </div>

        <!-- 内联新建 -->
        <div class="kanban-add-card">
          <template v-if="inlineAdding === col.value">
            <input v-model="inlineTitle" class="kia-input" placeholder="卡片名称..." @keyup.enter="commitInlineAdd(col.value)" @keyup.escape="cancelInlineAdd" ref="inlineInput" />
            <div class="kia-actions">
              <button class="btn-sm btn-primary" @click="commitInlineAdd(col.value)">添加</button>
              <button class="btn-sm btn-ghost" @click="cancelInlineAdd">取消</button>
            </div>
          </template>
          <button v-else class="kia-btn" @click="startInlineAdd(col.value)">＋ 添加</button>
        </div>
      </div>
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
import { ref, computed, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import type { ModuleViewConfig } from '../types'
import { DetailField, useEntityEdit } from '@worldsmith/plugin-sdk'

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
const inlineAdding = ref<string | null>(null)
const inlineTitle = ref('')
const inlineInput = ref<HTMLInputElement>()

// 拖拽状态
let draggedCardId: string | null = null
let draggedFromCol: string | null = null
let touchCardId: string | null = null
let touchCol: string | null = null

const { isEditing: editing, editForm, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedCard)

const editingField = ref<string | null>(null)

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
  }).filter(col => columnOrder.length > 0 || col.cards.length > 0 || !columnOrder.length)
})

/* —— 拖拽 —— */
function onDragStart(e: DragEvent, cardId: string, col: string) {
  draggedCardId = cardId
  draggedFromCol = col
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  draggedCardId = null
  draggedFromCol = null
}

async function onDrop(_e: DragEvent, targetCol: string) {
  if (!draggedCardId || draggedFromCol === targetCol) return
  await es.update(draggedCardId, { properties: { ...(es.entityMap.get(draggedCardId)?.properties ?? {}), [groupByField]: targetCol } })
  await es.loadByType(props.entityType)
  draggedCardId = null
  draggedFromCol = null
}

/* —— 触屏拖拽 —— */
let touchStartY = 0
let touchStartX = 0
let touchCurrentEl: Element | null = null

function onTouchStart(e: TouchEvent, cardId: string, col: string) {
  touchCardId = cardId
  touchCol = col
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  touchCurrentEl = (e.target as HTMLElement).closest('.kanban-card') ?? null
  if (touchCurrentEl) {
    (touchCurrentEl as HTMLElement).style.opacity = '0.5'
  }
}

function onTouchMove(e: TouchEvent) {
  // 偏移太小不触发
  const dx = Math.abs(e.touches[0].clientX - touchStartX)
  const dy = Math.abs(e.touches[0].clientY - touchStartY)
  if (dx < 10 && dy < 10) return

  // 查找拖拽目标列
  const el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)
  const colEl = el?.closest('.kanban-column')
  if (colEl) {
    const colValue = colEl.getAttribute('data-col')
    if (colValue && colValue !== touchCol) {
      ;(colEl as HTMLElement).style.background = 'var(--primary-light, #eef2ff)'
    }
  }
}

async function onTouchEnd(_e: TouchEvent) {
  if (touchCurrentEl) {
    (touchCurrentEl as HTMLElement).style.opacity = '1'
  }

  if (!touchCardId || !touchCol) return

  // 查找释放位置所在列
  const el = document.elementFromPoint(touchStartX, touchStartY)
  const colEl = el?.closest('.kanban-column')
  if (colEl) {
    ;(colEl as HTMLElement).style.background = ''
    const colValue = colEl.getAttribute('data-col')
    if (colValue && colValue !== touchCol) {
      await es.update(touchCardId, { properties: { ...(es.entityMap.get(touchCardId)?.properties ?? {}), [groupByField]: colValue } })
      await es.loadByType(props.entityType)
    }
  }

  touchCardId = null
  touchCol = null
}

/* —— 内联新建 —— */
function startInlineAdd(col: string) {
  inlineAdding.value = col
  inlineTitle.value = ''
  nextTick(() => inlineInput.value?.focus())
}

function cancelInlineAdd() {
  inlineAdding.value = null
  inlineTitle.value = ''
}

async function commitInlineAdd(col: string) {
  if (!inlineTitle.value.trim()) return
  const now = new Date().toISOString()
  const id = props.entityType + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  await es.add({
    id,
    type: props.entityType,
    name: inlineTitle.value.trim(),
    description: '',
    properties: { [groupByField]: col },
    tags: [],
    createdAt: now,
    updatedAt: now,
  } as Entity)
  await es.loadByType(props.entityType)
  cancelInlineAdd()
}

/* —— 新建弹窗 —— */
function openNewForm() {
  selectedCard.value = null
  // 暂时用内联新建替代
  if (columns.value.length > 0) startInlineAdd(columns.value[0].value)
}

/* —— 删除 —— */
async function deleteCard() {
  if (!selectedCard.value) return
  await es.remove(selectedCard.value.id)
  selectedCard.value = null
  await es.loadByType(props.entityType)
}

/* —— 格式化 —— */
function formatValue(val: unknown, field: any): string {
  if (val === null || val === undefined) return ''
  if (field.type === 'select' || field.type === 'multi-select') return String(val)
  if (field.type === 'boolean') return val ? '✓' : '✗'
  if (field.type === 'date') return String(val).slice(0, 10)
  return String(val).slice(0, 60)
}
</script>

<style scoped>
.kanban-view { display: flex; flex-direction: column; height: 100%; padding: 20px; overflow: hidden; }
.kanban-board { display: flex; gap: 12px; flex: 1; overflow-x: auto; padding-bottom: 12px; }
.kanban-column { min-width: 240px; max-width: 300px; flex: 1; display: flex; flex-direction: column; background: var(--bg-secondary, #f3f4f6); border-radius: 8px; padding: 8px; transition: background 0.15s; }
.kanban-column-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 8px; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.kch-count { font-size: var(--font-size-xs); background: var(--border-color, #ddd); color: var(--text-secondary); padding: 1px 6px; border-radius: 8px; }
.kanban-cards { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; min-height: 40px; }
.kanban-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 6px; padding: 10px; cursor: pointer; transition: box-shadow 0.12s, opacity 0.12s; }
.kanban-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.kc-header { margin-bottom: 4px; }
.kc-name { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); color: var(--text-color); }
.kc-body { font-size: var(--font-size-xs); color: var(--text-secondary); }
.kc-field { display: flex; gap: 4px; }
.kcf-label { color: var(--text-tertiary); }
.kcf-value { color: var(--text-color); }
.kc-tags { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 6px; }
.kanban-add-card { padding: 6px 4px 0; }
.kia-btn { width: 100%; padding: 4px; border: 1px dashed var(--border-color, #ccc); border-radius: 4px; background: transparent; cursor: pointer; font-size: var(--font-size-sm); color: var(--text-tertiary); transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s; }
.kia-btn:hover { border-color: var(--primary, #4f46e5); color: var(--primary, #4f46e5); }
.kia-input { width: 100%; padding: 6px 8px; border: 1px solid var(--border-color, #ddd); border-radius: 4px; font-size: var(--font-size-sm); font-family: inherit; }
.kia-actions { display: flex; gap: 4px; margin-top: 4px; }
</style>
