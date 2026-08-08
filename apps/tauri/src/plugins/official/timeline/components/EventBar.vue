<template>
  <div
    class="event-bar"
    :class="[importanceClass, { selected: isSelected, 'is-dragging': isDragging }]"
    :style="barStyle"
    @click="$emit('select')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <span class="bar-label">{{ event.name }}</span>
    <span v-if="childCount > 0" class="bar-badge">+{{ childCount }}</span>

    <Teleport to="body">
      <div v-if="hovered" class="bar-tooltip" :style="tooltipStyle">
        <strong>{{ event.name }}</strong>
        <p>{{ displayDate }}</p>
        <p v-if="event.description">{{ event.description.slice(0, 100) }}</p>
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
  pixelWidth: number
  pixelY: number
  isSelected: boolean
  isDragging: boolean
  childCount: number
}>()

defineEmits<{
  select: []
}>()

const hovered = ref(false)

const importanceClass = computed(() => {
  const imp = props.event.properties.importance as string
  return imp === '关键' ? 'imp-critical' : imp === '重要' ? 'imp-important' : imp === '细微' ? 'imp-minor' : 'imp-normal'
})

const barStyle = computed(() => ({
  left: props.pixelX + 'px',
  top: props.pixelY + 'px',
  width: Math.max(24, props.pixelWidth) + 'px',
}))

const displayDate = computed(() => {
  const date = (props.event.properties.date as string) || '?'
  const dateEnd = props.event.properties.dateEnd as string
  return dateEnd ? `${date} ~ ${dateEnd}` : date
})

const tooltipStyle = computed(() => ({
  position: 'fixed' as const,
  left: (props.pixelX + props.pixelWidth / 2) + 'px',
  top: (props.pixelY - 8) + 'px',
  transform: 'translate(-50%, -100%)',
}))
</script>

<style scoped>
.event-bar {
  position: absolute;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
  overflow: hidden;
  white-space: nowrap;
  border: 1px solid transparent;
}
.event-bar:hover {
  transform: translateY(-1px);
  box-shadow: var(--card-shadow-hover);
  z-index: 2;
}
.event-bar.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(79,70,229,0.15);
  z-index: 3;
}
.event-bar.is-dragging {
  opacity: 0.7;
  z-index: 10;
}

.imp-critical { background: color-mix(in srgb, var(--danger) 20%, var(--card-bg)); color: var(--danger); border-left: 3px solid var(--danger); }
.imp-important { background: color-mix(in srgb, var(--warning) 20%, var(--card-bg)); color: var(--warning); border-left: 3px solid var(--warning); }
.imp-normal { background: color-mix(in srgb, var(--primary) 15%, var(--card-bg)); color: var(--primary); border-left: 3px solid var(--primary); }
.imp-minor { background: var(--hover-bg); color: var(--text-tertiary); border-left: 3px solid var(--text-tertiary); }

.bar-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.bar-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0,0,0,0.1);
  margin-left: 4px;
  flex-shrink: 0;
}

.bar-tooltip {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  box-shadow: var(--shadow-lg);
  z-index: 9999;
  max-width: 240px;
  pointer-events: none;
}
.bar-tooltip strong { display: block; margin-bottom: 2px; }
.bar-tooltip p { margin: 2px 0; font-size: var(--font-size-xs); color: var(--text-secondary); }
</style>
