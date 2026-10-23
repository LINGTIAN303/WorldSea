<template>
  <div class="swimlane-header" :style="{ borderLeftColor: lane.color }" :title="lane.detail || lane.label">
    <button class="lane-collapse-btn" @click="$emit('toggleCollapse', lane.id)">
      <WsIcon :name="lane.collapsed ? 'chevron-right' : 'chevron-down'" size="xs" />
    </button>
    <span class="lane-color-dot" :style="{ background: lane.color }"></span>
    <span class="lane-label">{{ lane.label }}</span>
    <span class="lane-count">{{ lane.count }}</span>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { Swimlane } from '../composables/useSwimlaneLayout'

defineProps<{
  lane: Swimlane
}>()

defineEmits<{
  toggleCollapse: [laneId: string]
}>()
</script>

<style scoped>
.swimlane-header {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border-left: 3px solid;
  background: var(--hover-bg);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}
.swimlane-header:hover { background: var(--card-bg); }

.lane-collapse-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  border-radius: var(--radius-2xs);
}
.lane-collapse-btn:hover { background: var(--hover-bg); }

.lane-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lane-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lane-count {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--card-bg);
}
</style>
