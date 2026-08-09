<template>
  <div class="tree-node" :style="{ paddingLeft: depth * 20 + 'px' }">
    <div class="tree-line-container">
      <span v-if="depth > 0" class="tree-branch" :class="isLast ? 'tree-last' : 'tree-mid'"></span>
    </div>

    <button
      v-if="hasChildren"
      class="collapse-btn"
      :class="{ collapsed: isCollapsed }"
      @click.stop="$emit('toggleCollapse', node.entity.id)"
    >
      <WsIcon :name="isCollapsed ? 'chevron-right' : 'chevron-down'" size="xs" />
    </button>
    <span v-else class="collapse-placeholder"></span>

    <span class="node-marker" :class="markerClass"></span>

    <EventCard
      :event="node.entity"
      :highlighted="isSelected"
      :batch-selected="isBatchSelected"
      :compact="compact"
      :breadcrumb="breadcrumbText"
      @select="$emit('select', node.entity)"
      @toggle-select="$emit('toggleSelect', node.entity.id)"
    />

    <span v-if="isCollapsed && totalChildCount > 0" class="collapsed-badge">+{{ totalChildCount }}</span>
  </div>

  <template v-if="!isCollapsed">
    <TreeNode
      v-for="(child, idx) in node.children"
      :key="child.entity.id"
      :node="child"
      :depth="depth + 1"
      :is-last="idx === node.children.length - 1"
      :collapsed-set="collapsedSet"
      :selected-event-id="selectedEventId"
      :selected-ids="selectedIds"
      :compact="compact"
      :parent-names="[...parentNames, node.entity.name]"
      @select="(e: Entity) => $emit('select', e)"
      @toggle-select="(id: string) => $emit('toggleSelect', id)"
      @toggle-collapse="(id: string) => $emit('toggleCollapse', id)"
    />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Entity } from '@worldsmith/entity-core'
import type { TreeNode as TreeNodeType } from '../composables/useEventTree'
import { WsIcon } from '@worldsmith/ui-kit'
import EventCard from './EventCard.vue'

const props = defineProps<{
  node: TreeNodeType
  depth: number
  isLast: boolean
  collapsedSet: Set<string>
  selectedEventId: string | null
  selectedIds: Set<string>
  compact: boolean
  parentNames: string[]
}>()

defineEmits<{
  select: [event: Entity]
  toggleSelect: [id: string]
  toggleCollapse: [id: string]
}>()

const hasChildren = computed(() => props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsedSet.has(props.node.entity.id))
const isSelected = computed(() => props.selectedEventId === props.node.entity.id)
const isBatchSelected = computed(() => props.selectedIds.has(props.node.entity.id))

const totalChildCount = computed(() => {
  function count(n: TreeNodeType): number {
    return n.children.reduce((acc, c) => acc + 1 + count(c), 0)
  }
  return count(props.node)
})

const markerClass = computed(() => {
  if (props.depth === 0) return 'marker-root'
  if (props.depth === 1) return 'marker-child'
  return 'marker-grandchild'
})

const breadcrumbText = computed(() => {
  if (props.depth === 0) return ''
  return [...props.parentNames, props.node.entity.name].join(' > ')
})
</script>

<style scoped>
.tree-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  padding: 2px 0;
}

.tree-line-container {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 20px;
}

.tree-branch {
  position: absolute;
  left: 10px;
}
.tree-mid {
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--border-color);
}
.tree-mid::before {
  content: '';
  position: absolute;
  top: 14px;
  left: 0;
  width: 10px;
  border-top: 1px solid var(--border-color);
}
.tree-last {
  top: 0;
  height: 15px;
  border-left: 1px solid var(--border-color);
}
.tree-last::before {
  content: '';
  position: absolute;
  top: 14px;
  left: 0;
  width: 10px;
  border-top: 1px solid var(--border-color);
}

.collapse-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-2xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
  margin-top: 6px;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}
.collapse-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}
.collapse-placeholder {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.node-marker {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin: 9px 6px 0 2px;
}
.marker-root { background: var(--primary); }
.marker-child { background: transparent; border: 2px solid var(--primary); }
.marker-grandchild {
  background: transparent;
  border: 2px solid var(--text-tertiary);
  border-radius: 2px;
  transform: rotate(45deg);
  width: 8px;
  height: 8px;
  margin: 10px 7px 0 3px;
}

.collapsed-badge {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--primary-light);
  color: var(--primary);
  margin-top: 8px;
  flex-shrink: 0;
}
</style>
