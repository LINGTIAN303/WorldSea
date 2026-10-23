<template>
  <div class="chronicle">
    <div class="timeline-line"></div>

    <template v-for="group in groups" :key="group.id">
      <div v-if="group.label" class="group-header">
        <span class="group-label">{{ group.label }}</span>
        <span v-if="group.detail" class="group-range">{{ group.detail }}</span>
        <span class="group-count">{{ group.events.length }}</span>
      </div>

      <template v-if="sortMode === 'tree'">
        <TreeNode
          v-for="(rootNode, idx) in rootNodesFor(group)"
          :key="rootNode.entity.id"
          :node="rootNode"
          :depth="0"
          :is-last="idx === rootNodesFor(group).length - 1"
          :collapsed-set="treeCollapsedSet"
          :selected-event-id="selectedEventId"
          :selected-ids="selectedIds"
          :batch-mode="batchMode"
          :compact="compactMode"
          :parent-names="[]"
          @select="(e: Entity) => $emit('selectEvent', e)"
          @toggle-select="(id: string) => $emit('toggleSelect', id)"
          @toggle-collapse="tree.toggleCollapse"
        />
      </template>

      <template v-else>
        <div v-for="event in group.events" :key="event.id" class="chrono-item">
          <span class="chrono-dot" :class="importanceClass(event)"></span>
          <EventCard
            :event="event"
            :data-event-id="event.id"
            :highlighted="selectedEventId === event.id"
            :batch-selected="selectedIds.has(event.id)"
            :batch-mode="batchMode"
            :compact="compactMode"
            @select="$emit('selectEvent', event)"
            @toggle-select="$emit('toggleSelect', event.id)"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { TreeNode as TreeNodeType } from '../composables/useEventTree'
import type { TimelineGroup } from '../composables/timelineGroups'
import EventCard from './EventCard.vue'
import TreeNode from './TreeNode.vue'

const props = defineProps<{
  groups: TimelineGroup[]
  sortMode: 'chrono' | 'tree'
  tree: {
    roots: { value: TreeNodeType[] } | TreeNodeType[]
    collapsedSet: { value: Set<string> } | Set<string>
    toggleCollapse: (id: string) => void
  }
  compactMode: boolean
  selectedEventId: string | null
  selectedIds: Set<string>
  batchMode?: boolean
}>()

defineEmits<{
  selectEvent: [event: Entity]
  toggleSelect: [id: string]
}>()

const treeCollapsedSet = computed<Set<string>>(() => {
  const source = props.tree.collapsedSet
  return source instanceof Set ? source : source.value
})
const treeRoots = computed<TreeNodeType[]>(() => {
  const source = props.tree.roots
  return Array.isArray(source) ? source : source.value
})

function rootNodesFor(group: TimelineGroup): TreeNodeType[] {
  const ids = new Set(group.events.map(event => event.id))
  return treeRoots.value.filter(node => ids.has(node.entity.id))
}

function importanceClass(event: Entity): string {
  const importance = event.properties.importance as string
  return importance === '关键' ? 'dot-critical'
    : importance === '重要' ? 'dot-important'
      : importance === '细微' ? 'dot-minor' : 'dot-normal'
}
</script>

<style scoped>
.chronicle {
  flex: 1;
  overflow-y: auto;
  position: relative;
  padding: 10px 0 10px 20px;
}

.timeline-line {
  position: absolute;
  left: 28px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom, var(--primary-light), var(--primary), var(--primary-light));
}

.group-header {
  position: relative;
  padding: 16px 0 8px 30px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.group-header::before {
  content: '';
  position: absolute;
  left: 18px;
  top: 50%;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary);
  border: 3px solid var(--primary-light);
  transform: translate(-11px, -50%);
  z-index: 1;
}
.group-label {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--primary);
}
.group-range {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
.group-count {
  margin-left: auto;
  padding-right: 12px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.chrono-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0 4px 30px;
}
.chrono-dot {
  position: absolute;
  left: 22px;
  top: 14px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
  flex-shrink: 0;
  z-index: 1;
}
.dot-critical { background: var(--danger); border-color: var(--danger); }
.dot-important { background: var(--warning); border-color: var(--warning); }
.dot-normal { background: var(--primary); border-color: var(--primary); }
.dot-minor { background: var(--text-tertiary); border-color: var(--text-tertiary); }
</style>
