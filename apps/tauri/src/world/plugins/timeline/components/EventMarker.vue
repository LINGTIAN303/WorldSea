<template>
  <div
    class="event-marker"
    :class="[importanceClass, { selected: isSelected, fuzzy, occurrence, 'is-skipped': skipped, 'is-peer': peer }]"
    :style="markerStyle"
    role="button"
    tabindex="0"
    :aria-pressed="isSelected"
    :aria-label="occurrence ? `选择事件：${event.name}（周期${skipped ? '，已跳过' : ''}）` : `选择事件：${event.name}`"
    @click="$emit('select')"
    @keydown.enter="$emit('select')"
    @keydown.space.prevent="$emit('select')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <span class="marker-dot"></span>

    <div v-if="hovered" class="marker-tooltip">
      <strong>{{ event.name }}<span v-if="occurrence" class="occurrence-tag">周期</span></strong>
      <p>{{ displayDate }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

const props = defineProps<{
  event: Entity
  pixelX: number
  pixelY: number
  isSelected: boolean
  /** 覆盖 tooltip 日期（周期 occurrence 用） */
  displayText?: string
  /** 模糊日期：虚线圆点 */
  fuzzy?: boolean
  /** 周期展开出的虚拟 occurrence：空心小点 */
  occurrence?: boolean
  /** 命中周期例外的发生：虚线空心点，tooltip 标「已跳过」 */
  skipped?: boolean
  /** 冲突对位高亮（另一方）：琥珀色圆环，不参与选中 */
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

const markerStyle = computed(() => ({
  left: (props.pixelX - 12) + 'px',
  top: (props.pixelY + 4) + 'px',
}))

const displayDate = computed(() =>
  props.displayText || (props.event.properties.date as string) || '?',
)
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
.event-marker:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 50%;
  z-index: 5;
}
.event-marker.selected { z-index: 3; }
.event-marker.selected .marker-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #4f46e5) 20%, transparent);
}

.marker-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
  transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast);
}

.imp-critical .marker-dot { background: var(--danger); border-color: var(--danger); }
.imp-important .marker-dot { background: var(--warning); border-color: var(--warning); }
.imp-normal .marker-dot { background: var(--primary); border-color: var(--primary); }
.imp-minor .marker-dot { background: var(--text-tertiary); border-color: var(--text-tertiary); }

/* 模糊日期：虚线描边，与精确事件区分 */
.event-marker.fuzzy .marker-dot { border-style: dashed; }
/* 冲突对位：琥珀色圆环，与选中（主色）区分 */
.event-marker.is-peer .marker-dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 40%, transparent); }
/* 周期 occurrence：空心小点，点击仍打开基础事件 */
.event-marker.occurrence .marker-dot {
  width: 8px;
  height: 8px;
  background: transparent;
  border-color: var(--primary);
}
/* 周期例外（已跳过）：虚线并可减小透明度，与有效发生区分 */
.event-marker.is-skipped .marker-dot {
  border-style: dashed;
  opacity: 0.6;
}

.marker-tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  box-shadow: var(--shadow-lg);
  z-index: 30;
  max-width: 220px;
  pointer-events: none;
  white-space: normal;
}
.marker-tooltip strong { display: block; margin-bottom: 2px; }
.marker-tooltip p { margin: 2px 0; font-size: var(--font-size-xs); color: var(--text-secondary); }
.occurrence-tag {
  margin-left: 6px;
  padding: 0 4px;
  font-size: var(--fs-2xs);
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
}
</style>
