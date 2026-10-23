<template>
  <Transition name="ws-detail-backdrop">
    <div v-if="show" class="detail-backdrop"></div>
  </Transition>
  <Transition name="ws-detail-slide">
    <div v-if="show" class="conflict-panel">
      <button class="detail-close" @click="$emit('close')" aria-label="关闭"><WsIcon name="close" size="xs" /></button>
      <h3><WsIcon name="warning" size="sm" /> 时间冲突检测</h3>
      <p class="conflict-subtitle">{{ conflicts.length === 0 ? '未检测到时间冲突' : `发现 ${conflicts.length} 个潜在冲突` }}</p>

      <div v-if="conflicts.length === 0" class="conflict-clean">
        <WsIcon name="check" size="lg" />
        <p>所有事件时间线无冲突</p>
      </div>

      <div
        v-for="(c, i) in conflicts"
        :key="i"
        class="conflict-item"
        :class="[c.type, { fuzzy: c.fuzzy }]"
        role="button"
        tabindex="0"
        :title="`点击定位到「${c.entities[0]}」`"
        @click="$emit('focus', c.eventIds[0])"
        @keydown.enter="$emit('focus', c.eventIds[0])"
        @keydown.space.prevent="$emit('focus', c.eventIds[0])"
      >
        <div class="conflict-type-badge">
          {{ c.type === 'same_date' ? '同日期' : c.type === 'overlap' ? '时间重叠' : '同地点' }}
          <span v-if="c.fuzzy" class="fuzzy-tag">模糊</span>
        </div>
        <p class="conflict-desc">{{ c.description }}</p>
        <div class="conflict-entities">
          <span v-for="name in c.entities" :key="name" class="conflict-entity">{{ name }}</span>
        </div>
        <p class="conflict-date">{{ c.date }}</p>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { Conflict } from '../composables/useConflictDetection'

defineProps<{
  show: boolean
  conflicts: Conflict[]
}>()

defineEmits<{
  close: []
  focus: [eventId: string]
}>()
</script>

<style scoped>
.conflict-panel {
  position: fixed;
  right: 0;
  top: var(--layout-menubar-height);
  bottom: 0;
  width: 400px;
  background: var(--glass-bg, var(--panel-bg, var(--content-bg)));
  border-left: 1px solid var(--glass-border, var(--border-color));
  padding: 20px;
  overflow-y: auto;
  z-index: var(--z-detail-backdrop);
  backdrop-filter: blur(var(--glass-blur));
  box-shadow: var(--shadow-xl);
}
.conflict-panel h3 {
  font-size: var(--font-size-lg);
  margin-bottom: 4px;
}
.conflict-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 16px;
}
.conflict-clean {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0;
  color: var(--success);
}
.conflict-item {
  padding: 12px;
  border-radius: var(--radius-md);
  margin-bottom: 10px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.conflict-item:hover,
.conflict-item:focus-visible {
  background: var(--hover-bg);
  outline: none;
}
.conflict-item.same_date { border-left: 3px solid var(--warning, #f59e0b); }
.conflict-item.overlap { border-left: 3px solid var(--danger, #ef4444); }
.conflict-item.same_location { border-left: 3px solid var(--primary, #4f46e5); }
/* 模糊日期冲突：虚线左栏 + 徽标，提醒仅供参考 */
.conflict-item.fuzzy { border-left-style: dashed; }
.fuzzy-tag {
  margin-left: 6px;
  padding: 0 4px;
  font-size: var(--fs-2xs);
  border: 1px dashed currentColor;
  border-radius: var(--radius-xs);
}
.conflict-type-badge {
  display: inline-block;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  margin-bottom: 6px;
}
.same_date .conflict-type-badge { background: color-mix(in srgb, var(--color-warning) 20%, transparent); color: var(--color-warning); }
.overlap .conflict-type-badge { background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger); }
.same_location .conflict-type-badge { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.conflict-desc { font-size: var(--font-size-sm); margin: 4px 0; }
.conflict-entities { display: flex; gap: 4px; flex-wrap: wrap; margin: 6px 0; }
.conflict-entity { font-size: var(--font-size-sm); padding: 2px 8px; background: var(--hover-bg); border-radius: var(--radius-xs); }
.conflict-date { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 4px; }
.detail-close { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-lg); color: var(--text-tertiary); display: flex; align-items: center; justify-content: center; }
.detail-close:hover { background: var(--hover-bg); color: var(--text-color); }

.detail-backdrop { position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: var(--z-detail-backdrop); background: rgba(0,0,0,0.2); pointer-events: none; }

</style>