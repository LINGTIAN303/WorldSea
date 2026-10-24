<template>
  <div
    class="event-bar"
    :class="[importanceClass, { selected: isSelected, 'is-dragging': isDragging, fuzzy, draggable, 'is-peer': peer }]"
    :style="barStyle"
    role="button"
    tabindex="0"
    :aria-pressed="isSelected"
    :aria-label="`选择事件：${event.name}`"
    @click="$emit('select')"
    @keydown.enter="$emit('select')"
    @keydown.space.prevent="$emit('select')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <span class="bar-label">{{ event.name }}</span>
    <span v-if="certaintyLabel" class="bar-badge bar-fuzzy">{{ certaintyLabel }}</span>
    <span v-if="cycle" class="bar-badge bar-cycle">周期</span>
    <span v-if="childCount > 0" class="bar-badge">+{{ childCount }}</span>

    <div v-if="hovered" class="bar-tooltip">
      <strong>{{ event.name }}</strong>
      <p>{{ displayDate }}</p>
      <p v-if="event.description">{{ event.description.slice(0, 100) }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

const props = defineProps<{
  event: Entity
  pixelX: number
  pixelWidth: number
  pixelY: number
  isSelected: boolean
  isDragging: boolean
  childCount: number
  /** 精度徽标（约/早于/晚于/传说） */
  certaintyLabel?: string
  /** 模糊日期：虚线描边 */
  fuzzy?: boolean
  /** 周期事件：显示周期徽标 */
  cycle?: boolean
  /** 「拖拽改时间」开启：显示抓取光标与两端拉伸手柄 */
  draggable?: boolean
  /** 冲突对位高亮（另一方）：琥珀色虚线环，不参与选中 */
  peer?: boolean
}>()

defineEmits<{
  select: []
}>()

const hovered = ref(false)

const importanceClass = computed(() => {
  const importance = props.event.properties.importance as string
  return importance === '关键' ? 'imp-critical'
    : importance === '重要' ? 'imp-important'
      : importance === '细微' ? 'imp-minor' : 'imp-normal'
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
</script>

<style scoped>
.event-bar {
  position: absolute;
  height: 28px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
  white-space: nowrap;
  border: 1px solid transparent;
}
.event-bar:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  z-index: 5;
}
.event-bar:hover {
  transform: translateY(-1px);
  box-shadow: var(--card-shadow-hover);
  z-index: 2;
}
.event-bar.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #4f46e5) 15%, transparent);
  z-index: 3;
}
.event-bar.is-dragging {
  opacity: 0.7;
  z-index: 10;
}
.event-bar.fuzzy { border-style: dashed; }
/* 冲突对位：与选中区分开（选中=实心环，对位=琥珀虚线环） */
.event-bar.is-peer { outline: 2px dashed var(--warning); outline-offset: 2px; }
.event-bar.draggable { cursor: grab; }
.event-bar.draggable:active { cursor: grabbing; }
/* 两端拉伸手柄：只在可拖拽时出现，热区与拖拽判定一致（6px） */
.event-bar.draggable::before,
.event-bar.draggable::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 6px;
  border-radius: 2px;
  background: color-mix(in srgb, currentColor 45%, transparent);
  opacity: 0;
  transition: opacity var(--transition-fast);
  cursor: ew-resize;
}
.event-bar.draggable::before { left: 2px; }
.event-bar.draggable::after { right: 2px; }
.event-bar.draggable:hover::before,
.event-bar.draggable:hover::after { opacity: 0.75; }

.imp-critical { background: color-mix(in srgb, var(--danger) 20%, var(--card-bg)); color: var(--danger); border-left: 3px solid var(--danger); }
.imp-important { background: color-mix(in srgb, var(--warning) 20%, var(--card-bg)); color: var(--warning); border-left: 3px solid var(--warning); }
.imp-normal { background: color-mix(in srgb, var(--primary) 15%, var(--card-bg)); color: var(--primary); border-left: 3px solid var(--primary); }
.imp-minor { background: var(--hover-bg); color: var(--text-tertiary); border-left: 3px solid var(--text-tertiary); }

.bar-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.bar-badge {
  font-size: var(--fs-2xs);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  background: rgba(0,0,0,0.1);
  margin-left: 4px;
  flex-shrink: 0;
}
.bar-fuzzy { border: 1px dashed currentColor; background: transparent; }
.bar-cycle { background: color-mix(in srgb, var(--primary) 18%, transparent); }

/* tooltip 在容器内绝对定位（不再 teleport + fixed，避免整体偏移与裁切） */
.bar-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  box-shadow: var(--shadow-lg);
  z-index: 30;
  max-width: 240px;
  pointer-events: none;
  white-space: normal;
}
.bar-tooltip strong { display: block; margin-bottom: 2px; }
.bar-tooltip p { margin: 2px 0; font-size: var(--font-size-xs); color: var(--text-secondary); }
</style>
