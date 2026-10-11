<template>
  <div
    class="event-card"
    :class="{ highlighted: highlighted, 'is-range': isRange, compact, 'batch-selected': batchSelected, 'batch-mode': batchMode }"
    role="button"
    tabindex="0"
    :aria-label="batchMode ? `选中事件 ${event.name}` : `打开事件 ${event.name}`"
    :aria-pressed="batchMode ? batchSelected : undefined"
    @click="onActivate"
    @keydown.enter="onActivate"
    @keydown.space.prevent="onActivate"
  >
    <div v-if="breadcrumb && !compact" class="ec-breadcrumb">{{ breadcrumb }}</div>

    <div class="ec-header">
      <span class="ec-date">{{ displayDate }}</span>
      <span v-if="!compact" class="ec-importance">{{ importanceStars }}</span>
    </div>
    <h3 class="ec-title" :class="{ 'ec-title-compact': compact }">{{ event.name }}</h3>
    <p v-if="!compact && event.description" class="ec-desc">{{ event.description.slice(0, 80) }}</p>
    <div v-if="!compact" class="ec-meta">
      <span v-if="event.properties.location" class="ec-tag"><WsIcon name="location" size="xs" /> {{ event.properties.location }}</span>
      <span v-if="event.properties.era" class="ec-tag"><WsIcon name="manuscript" size="xs" /> {{ event.properties.era }}</span>
      <span class="ec-tag" :class="statusClass">{{ event.properties.status || '正史' }}</span>
      <span v-if="isRange" class="ec-tag ec-range">↔ 持续事件</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'

const props = withDefaults(defineProps<{
  event: Entity
  highlighted: boolean
  batchSelected: boolean
  /** 批量态：点击/回车路由到选中切换而非打开详情 */
  batchMode?: boolean
  compact?: boolean
  breadcrumb?: string
}>(), {
  compact: false,
  breadcrumb: '',
})

const emit = defineEmits<{
  select: []
  toggleSelect: []
}>()

/** 激活：批量态=选中切换；浏览态=打开详情 */
function onActivate() {
  props.batchMode ? emit('toggleSelect') : emit('select')
}

const isRange = computed(() => {
  const dateEnd = props.event.properties.dateEnd as string
  return !!dateEnd
})

const displayDate = computed(() => {
  const date = (props.event.properties.date as string) || '?'
  const dateEnd = props.event.properties.dateEnd as string
  if (dateEnd) return `${date} ~ ${dateEnd}`
  return date
})

const importanceStars = computed(() => {
  const imp = props.event.properties.importance as string
  const map: Record<string, string> = { '关键': '★', '重要': '★★', '普通': '★★★', '细微': '★★★★' }
  return map[imp] || ''
})

const statusClass = computed(() => {
  const status = props.event.properties.status as string
  return status === '废案' ? 'status-abandoned' : status === '备选' ? 'status-alternate' : 'status-canon'
})
</script>

<style scoped>
.event-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition), color var(--transition), box-shadow var(--transition), transform var(--transition), opacity var(--transition), filter var(--transition);
  box-shadow: var(--card-shadow);
  position: relative;
  flex: 1;
  min-width: 0;
}
.event-card:hover {
  box-shadow: var(--card-shadow-hover);
  border-color: var(--primary);
}
.event-card.highlighted {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #4f46e5) 12%, transparent);
}
.event-card.is-range {
  border-left: 3px solid var(--primary);
}
.event-card.compact {
  padding: 4px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.event-card.compact .ec-header {
  margin-bottom: 0;
}

.ec-breadcrumb {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ec-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.ec-date {
  font-size: var(--font-size-sm);
  color: var(--primary);
  font-weight: var(--font-weight-semibold);
  background: var(--primary-light);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  white-space: nowrap;
}
.ec-importance {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  letter-spacing: 1px;
}
.ec-title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}
.ec-title-compact {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}
.ec-desc {
  margin: 4px 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}
.ec-meta {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.ec-tag {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  background: var(--hover-bg);
}
.ec-range {
  background: var(--primary-light);
  color: var(--primary);
}
.status-canon { background: var(--success-light); color: var(--success); }
.status-abandoned { background: var(--danger-light); color: var(--danger); }
.status-alternate { background: var(--warning-light); color: var(--warning); }

.batch-selected {
  border-color: var(--accent, #4f46e5) !important;
  background: var(--accent-soft, #eef2ff);
}
/* 批量态：hover 虚线描边示意「点击=选中」（常驻复选框已撤） */
.event-card.batch-mode:hover {
  border-color: var(--accent, #4f46e5);
  border-style: dashed;
}
</style>
