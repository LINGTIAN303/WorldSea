<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{
        selected: isSelected,
        'batch-selected': batchSelected,
        'drag-over': dragOver && dropPosition === 'inside',
        'drag-before': dragOver && dropPosition === 'before',
        'drag-after': dragOver && dropPosition === 'after',
      }"
      :style="{ paddingLeft: depth * 20 + 8 + 'px' }"
      draggable="true"
      role="button"
      tabindex="0"
      :aria-current="isSelected ? 'true' : undefined"
      :aria-expanded="node.children.length > 0 ? expanded : undefined"
      :aria-label="`打开 ${node.entity.name}`"
      @click="$emit('select', node.entity)"
      @keydown.enter.prevent="$emit('select', node.entity)"
      @keydown.space.prevent="$emit('select', node.entity)"
      @dragstart="onDragStart"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @dragend="onDragEnd"
    >
      <button class="tree-toggle" @click.stop="toggleExpand">
        <WsIcon v-if="node.children.length > 0" :name="expanded ? 'chevron-down' : 'chevron-right'" size="xs" />
        <span v-else class="tree-toggle-spacer"></span>
      </button>

      <!-- 批量选择复选框（可选） -->
      <label v-if="showCheckbox" class="tree-check-label" @click.stop>
        <input
          type="checkbox"
          class="tree-checkbox"
          :checked="batchSelected"
          @change="$emit('toggle-select', node.entity.id)"
        />
      </label>

      <!-- 图标（可自定义） -->
      <span v-if="$slots.icon" class="tree-icon">
        <slot name="icon" :entity="node.entity" />
      </span>
      <span v-else class="tree-icon"><WsIcon name="manuscript" size="sm" /></span>

      <!-- 名称 -->
      <span class="tree-label">{{ node.entity.name }}</span>

      <!-- 类型标签（可自定义） -->
      <span v-if="$slots.typeLabel" class="tree-type">
        <slot name="typeLabel" :entity="node.entity" />
      </span>

      <!-- 附加操作（可自定义） -->
      <span v-if="$slots.actions" class="tree-actions" @click.stop>
        <slot name="actions" :entity="node.entity" />
      </span>
    </div>

    <!-- 递归渲染子节点 -->
    <div v-if="expanded && node.children.length > 0" class="tree-children">
      <GenericTreeView
        v-for="child in node.children"
        :key="child.entity.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        :show-checkbox="showCheckbox"
        :selected-ids="selectedIds"
        :expanded-ids="expandedIds"
        @select="(e: any) => $emit('select', e)"
        @toggle-select="(id: string) => $emit('toggle-select', id)"
        @add-child="(e: any) => $emit('add-child', e)"
        @move-node="(id: string, target: string, pos: number) => $emit('move-node', id, target, pos)"
        @toggle-expand="(id: string, exp: boolean) => $emit('toggle-expand', id, exp)"
      >
        <template #icon="slotProps">
          <slot name="icon" v-bind="slotProps" />
        </template>
        <template #typeLabel="slotProps">
          <slot name="typeLabel" v-bind="slotProps" />
        </template>
        <template #actions="slotProps">
          <slot name="actions" v-bind="slotProps" />
        </template>
        <template #entityLinks="slotProps">
          <slot name="entityLinks" v-bind="slotProps" />
        </template>
      </GenericTreeView>
    </div>
    <div v-if="expanded && $slots.entityLinks" class="tree-entity-links"
      :style="{ paddingLeft: (depth + 1) * 20 + 8 + 'px' }">
      <slot name="entityLinks" :entity="node.entity" :depth="depth" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import WsIcon from '../WsIcon.vue'

export interface TreeNodeData {
  entity: { id: string; name: string; properties: Record<string, unknown> }
  children: TreeNodeData[]
}

const props = defineProps<{
  node: TreeNodeData
  depth: number
  selectedId?: string
  showCheckbox?: boolean
  selectedIds?: Set<string>
  /** 外部控制的展开节点 ID 集合，传入后组件不再自行管理展开状态 */
  expandedIds?: Set<string>
}>()

const emit = defineEmits<{
  select: [entity: any]
  'toggle-select': [id: string]
  'add-child': [entity: any]
  'move-node': [nodeId: string, targetParentId: string, position: number]
  /** 节点展开/折叠时触发 */
  'toggle-expand': [nodeId: string, expanded: boolean]
}>()

defineSlots<{
  icon?(props: { entity: any }): any
  typeLabel?(props: { entity: any }): any
  actions?(props: { entity: any }): any
  entityLinks?(props: { entity: any; depth: number }): any
}>()

const internalExpanded = ref(true)

const expanded = computed(() => {
  if (props.expandedIds !== undefined) {
    return props.expandedIds.has(props.node.entity.id)
  }
  return internalExpanded.value
})

function toggleExpand() {
  if (props.expandedIds !== undefined) {
    emit('toggle-expand', props.node.entity.id, !expanded.value)
  } else {
    internalExpanded.value = !internalExpanded.value
  }
}
const dropPosition = ref<'before' | 'after' | 'inside'>('inside')
const dragOver = ref(false)
let dragTimer: ReturnType<typeof setTimeout> | null = null

const isSelected = computed(() => props.selectedId === props.node.entity.id)

const batchSelected = computed(() =>
  props.showCheckbox && props.selectedIds?.has(props.node.entity.id)
)

function onDragStart(e: DragEvent) {
  e.dataTransfer?.setData('text/plain', props.node.entity.id)
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragOver(e: DragEvent) {
  dragOver.value = true
  if (!e.dataTransfer) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = e.clientY - rect.top
  const h = rect.height
  if (y < h * 0.25) {
    dropPosition.value = 'before'
  } else if (y > h * 0.75) {
    dropPosition.value = 'after'
  } else {
    dropPosition.value = 'inside'
  }
  if (!expanded.value && props.node.children.length > 0) {
    if (!dragTimer) {
      dragTimer = setTimeout(() => { toggleExpand(); dragTimer = null }, 500)
    }
  }
}

function onDragLeave() {
  dragOver.value = false
  dropPosition.value = 'inside'
  if (dragTimer) { clearTimeout(dragTimer); dragTimer = null }
}

function onDrop(e: DragEvent) {
  const pos = dropPosition.value
  dragOver.value = false
  dropPosition.value = 'inside'
  const draggedId = e.dataTransfer?.getData('text/plain')
  if (draggedId && draggedId !== props.node.entity.id) {
    const isDesc = findNode(props.node, draggedId)
    if (!isDesc) {
      emit('move-node', draggedId, props.node.entity.id, pos === 'before' ? -1 : pos === 'after' ? 1 : 0)
    }
  }
}

function onDragEnd() {
  dragOver.value = false
}

function findNode(node: any, targetId: string): boolean {
  if (node.entity.id === targetId) return true
  if (node.children) {
    for (const c of node.children) {
      if (findNode(c, targetId)) return true
    }
  }
  return false
}
</script>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: var(--font-size-base);
  transition: background 0.1s;
}
.tree-row.drag-over {
  background: var(--primary-light, #eef2ff) !important;
  outline: 2px dashed var(--primary, #4f46e5);
  outline-offset: -2px;
}
.tree-row:hover {
  background: var(--hover-bg, #f3f4f6);
}
.tree-row.selected {
  background: var(--active-bg, #eef2ff);
  font-weight: var(--font-weight-semibold);
}
.tree-row.batch-selected {
  background: var(--primary-light, #eef2ff) !important;
}
.tree-toggle {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary, #888);
  flex-shrink: 0;
}
.tree-check-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 2px;
  cursor: pointer;
}
.tree-checkbox {
  margin: 0;
  cursor: pointer;
  accent-color: var(--primary, #4f46e5);
}
.tree-icon {
  font-size: var(--font-size-lg);
  width: 22px;
  text-align: center;
  flex-shrink: 0;
}
.tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-type {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary, #999);
  margin-right: 8px;
  flex-shrink: 0;
}
.tree-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.tree-children {
  /* depth is managed via paddingLeft on tree-row */
}
.tree-row.drag-before {
  border-top: 2px solid var(--primary, #4f46e5) !important;
}
.tree-row.drag-after {
  border-bottom: 2px solid var(--primary, #4f46e5) !important;
}
.tree-entity-links {
  padding-top: 4px;
  padding-bottom: 4px;
}
</style>