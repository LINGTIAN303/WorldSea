<template>
  <div
    class="kanban-column"
    :data-col="col.value"
    @drop="onDrop($event, col.value)"
    @dragover.prevent
  >
    <div class="kanban-column-header">
      <span class="kch-label">{{ col.label }}</span>
      <span class="kch-count">{{ col.cards.length }}</span>
    </div>

    <div
      ref="cardContainerRef"
      class="kanban-cards"
      @scroll.passive="onScroll"
    >
      <!-- 顶部占位：撑开已滚过的卡片高度 -->
      <div v-if="topPlaceholderHeight > 0" :style="{ height: topPlaceholderHeight + 'px' }" />

      <div
        v-for="(card, i) in visibleCards"
        :key="card.id"
        class="kanban-card"
        :data-virtual-index="visibleStartIndex + i"
        :draggable="true"
        @dragstart="onDragStart($event, card.id, col.value)"
        @dragend="onDragEnd"
        @touchstart.passive="onTouchStart($event, card.id, col.value)"
        @touchmove.prevent="onTouchMove($event)"
        @touchend="onTouchEnd($event)"
        @click="emit('select', card)"
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

      <!-- 底部占位：撑开未渲染的卡片高度 -->
      <div v-if="bottomPlaceholderHeight > 0" :style="{ height: bottomPlaceholderHeight + 'px' }" />
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
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import { useVirtualList } from '@worldsmith/perf-kit/render'
import type { Entity } from '@worldsmith/entity-core'

interface KanbanColumn {
  value: string
  label: string
  cards: Entity[]
}

const props = defineProps<{
  col: KanbanColumn
  displayFields: any[]
}>()

const emit = defineEmits<{
  (e: 'select', card: Entity): void
  (e: 'dragStart', cardId: string, col: string): void
  (e: 'dragEnd'): void
  (e: 'drop', col: string): void
  (e: 'addCard', col: string, title: string): void
}>()

/* —— 虚拟滚动 —— */
const cards = computed(() => props.col.cards)
const {
  containerRef: cardContainerRef,
  visibleStartIndex,
  visibleItems: visibleCards,
  topPlaceholderHeight,
  bottomPlaceholderHeight,
  onScroll,
} = useVirtualList<Entity>({ items: cards, estimatedHeight: 96 })
// 模板 ref 绑定写回该容器，供 useVirtualList 读取滚动位置/高度；此处仅挂载，不读取。
void cardContainerRef

/* —— 内联新建 —— */
const inlineAdding = ref<string | null>(null)
const inlineTitle = ref('')
const inlineInput = ref<HTMLInputElement>()

function startInlineAdd(col: string) {
  inlineAdding.value = col
  inlineTitle.value = ''
  nextTick(() => inlineInput.value?.focus())
}

function cancelInlineAdd() {
  inlineAdding.value = null
  inlineTitle.value = ''
}

function commitInlineAdd(col: string) {
  if (!inlineTitle.value.trim()) return
  emit('addCard', col, inlineTitle.value.trim())
  cancelInlineAdd()
}

// 监听父组件"新建"广播：命中本列时触发内联输入
function onStartInlineEvent(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail && detail.col === props.col.value) {
    startInlineAdd(props.col.value)
  }
}

onMounted(() => window.addEventListener('ws-kanban-start-inline', onStartInlineEvent))
onBeforeUnmount(() => window.removeEventListener('ws-kanban-start-inline', onStartInlineEvent))

/* —— 拖拽（转发给父组件） —— */
function onDragStart(e: DragEvent, cardId: string, col: string) {
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  emit('dragStart', cardId, col)
}

function onDragEnd() {
  emit('dragEnd')
}

function onDrop(_e: DragEvent, targetCol: string) {
  emit('drop', targetCol)
}

/* —— 触屏拖拽（内部处理视觉反馈，统一通过 drop 通知父组件） —— */
let touchCardId: string | null = null
let touchCol: string | null = null
let touchStartY = 0
let touchStartX = 0
let touchCurrentEl: Element | null = null

function onTouchStart(e: TouchEvent, cardId: string, col: string) {
  touchCardId = cardId
  touchCol = col
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  touchCurrentEl = (e.target as HTMLElement).closest('.kanban-card') ?? null
  if (touchCurrentEl) (touchCurrentEl as HTMLElement).style.opacity = '0.5'
}

function onTouchMove(e: TouchEvent) {
  const dx = Math.abs(e.touches[0].clientX - touchStartX)
  const dy = Math.abs(e.touches[0].clientY - touchStartY)
  if (dx < 10 && dy < 10) return
  const el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)
  const colEl = el?.closest('.kanban-column')
  if (colEl) {
    const colValue = colEl.getAttribute('data-col')
    if (colValue && colValue !== touchCol) {
      ;(colEl as HTMLElement).style.background = 'var(--primary-light, #eef2ff)'
    }
  }
}

function onTouchEnd(_e: TouchEvent) {
  if (touchCurrentEl) (touchCurrentEl as HTMLElement).style.opacity = '1'
  if (!touchCardId || !touchCol) return
  const el = document.elementFromPoint(touchStartX, touchStartY)
  const colEl = el?.closest('.kanban-column')
  if (colEl) {
    ;(colEl as HTMLElement).style.background = ''
    const colValue = colEl.getAttribute('data-col')
    if (colValue && colValue !== touchCol) {
      emit('drop', colValue)
    }
  }
  touchCardId = null
  touchCol = null
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