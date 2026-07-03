<template>
  <div
    :class="['ws-tree-node', { 'ws-tree-node--selected': isSelected }]"
    :style="{ paddingLeft: `${level * 20}px` }"
    role="treeitem"
    :aria-expanded="hasChildren ? isExpanded : undefined"
    :aria-selected="isSelected"
  >
    <button class="ws-tree-node__expand" :aria-label="isExpanded ? '收起' : '展开'" @click.stop="onToggle">
      <span v-if="hasChildren" class="ws-tree-node__arrow" :class="{ open: isExpanded }">▸</span>
      <span v-else class="ws-tree-node__arrow-placeholder"></span>
    </button>
    <div class="ws-tree-node__content" @click="onSelect">
      <slot :node="node" :selected="isSelected" :expanded="isExpanded">
        <span class="ws-tree-node__label">{{ node[labelField] }}</span>
      </slot>
    </div>
  </div>
  <div v-if="hasChildren && isExpanded" class="ws-tree-node__children" role="group">
    <WsTreeNode
      v-for="child in node[childrenField]"
      :key="child[keyField]"
      :node="child"
      :key-field="keyField"
      :label-field="labelField"
      :children-field="childrenField"
      :level="level + 1"
      :selected-set="selectedSet"
      :expanded-keys="expandedKeys"
      @toggle="(key: string) => $emit('toggle', key)"
      @select="(node: TreeNode) => $emit('select', node)"
    >
      <template #default="slotProps"><slot v-bind="slotProps" /></template>
    </WsTreeNode>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TreeNode } from './WsTree.vue'

const props = withDefaults(defineProps<{
  node: TreeNode
  keyField?: string
  labelField?: string
  childrenField?: string
  level?: number
  selectedSet?: Set<string>
  expandedKeys?: Set<string>
}>(), {
  keyField: 'key',
  labelField: 'label',
  childrenField: 'children',
  level: 0,
  selectedSet: () => new Set(),
})

defineSlots<{
  default: (props: { node: TreeNode; selected: boolean; expanded: boolean }) => any
}>()

const emit = defineEmits<{
  toggle: [key: string]
  select: [node: TreeNode]
}>()

const hasChildren = computed(() => {
  const children = props.node[props.childrenField]
  return Array.isArray(children) && children.length > 0
})

const isExpanded = computed(() => props.expandedKeys?.has(props.node[props.keyField]) ?? false)
// 性能优化:用 Set.has O(1) 查找替代数组 includes O(n)
const isSelected = computed(() => props.selectedSet?.has(props.node[props.keyField]) ?? false)

function onToggle() {
  emit('toggle', props.node[props.keyField])
}

function onSelect() {
  emit('select', props.node)
}
</script>

<style scoped>
.ws-tree-node {
  display: flex; align-items: center; gap: var(--space-1);
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm);
  cursor: pointer; transition: background var(--duration-fast) var(--ease-default);
}
.ws-tree-node:hover { background: var(--color-bg-hover); }
.ws-tree-node--selected { background: var(--color-primary-subtle); color: var(--color-primary); }

.ws-tree-node__expand {
  width: 18px; height: 18px; border: none; background: transparent;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-tertiary);
  flex-shrink: 0; padding: 0;
}
.ws-tree-node__expand:focus-visible { box-shadow: var(--shadow-focus-ring); outline: none; border-radius: var(--radius-xs); }
.ws-tree-node__arrow { transition: transform var(--duration-fast) var(--ease-default); display: inline-block; }
.ws-tree-node__arrow.open { transform: rotate(90deg); }
.ws-tree-node__arrow-placeholder { width: 10px; }

.ws-tree-node__content { flex: 1; min-width: 0; }
.ws-tree-node__label { }
.ws-tree-node__children { }
</style>
