<template>
  <div
    class="event-marker"
    :class="[importanceClass, { selected: isSelected }]"
    :style="markerStyle"
    @click="$emit('select')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <span class="marker-dot"></span>

    <Teleport to="body">
      <div v-if="hovered" class="marker-tooltip" :style="tooltipStyle">
        <strong>{{ event.name }}</strong>
        <p>{{ displayDate }}</p>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Entity } from '@worldsmith/entity-core'

const props = defineProps<{
  event: Entity
  pixelX: number
  pixelY: number
  isSelected: boolean
}>()

defineEmits<{
  select: []
}>()

const hovered = ref(false)

const importanceClass = computed(() => {
  const imp = props.event.properties.importance as string
  return imp === '关键' ? 'imp-critical' : imp === '重要' ? 'imp-important' : imp === '细微' ? 'imp-minor' : 'imp-normal'
})

const markerStyle = computed(() => ({
  left: (props.pixelX - 12) + 'px',
  top: (props.pixelY + 4) + 'px',
}))

const displayDate = computed(() => (props.event.properties.date as string) || '?')

const tooltipStyle = computed(() => ({
  position: 'fixed' as const,
  left: props.pixelX + 'px',
  top: (props.pixelY - 4) + 'px',
  transform: 'translate(-50%, -100%)',
}))
</script>

<style scoped>
.event-marker {
  position: absolute;
  width: 24px;
  height: 24px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  transition: transform var(--transition-fast);
}
.event-marker:hover {
  transform: scale(1.3);
  z-index: 2;
}
.event-marker.selected {
  z-index: 3;
}
.event-marker.selected .marker-dot {
  box-shadow: 0 0 0 3px rgba(79,70,229,0.2);
}

.marker-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}

.imp-critical .marker-dot { background: var(--danger); border-color: var(--danger); }
.imp-important .marker-dot { background: var(--warning); border-color: var(--warning); }
.imp-normal .marker-dot { background: var(--primary); border-color: var(--primary); }
.imp-minor .marker-dot { background: var(--text-tertiary); border-color: var(--text-tertiary); }

.marker-tooltip {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  box-shadow: var(--shadow-lg);
  z-index: 9999;
  max-width: 200px;
  pointer-events: none;
}
.marker-tooltip strong { display: block; margin-bottom: 2px; }
.marker-tooltip p { margin: 2px 0; font-size: var(--font-size-xs); color: var(--text-secondary); }
</style>
