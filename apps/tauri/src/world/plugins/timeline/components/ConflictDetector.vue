<template>
  <TuiModal :show="show" size="lg" @close="$emit('close')">
    <template #header>
      <div class="cf-head">
        <h2 class="cf-title"><WsIcon name="warning" size="sm" /> 时间冲突检测</h2>
        <div class="cf-summary">
          <span class="cf-chip cf-chip--precise">精确 {{ preciseCount }}</span>
          <span v-if="fuzzyCount" class="cf-chip cf-chip--fuzzy">模糊 {{ fuzzyCount }}</span>
          <span class="cf-chip cf-chip--scope">检查范围：{{ stats.characters }} 个角色 / {{ stats.scannable }} 个事件</span>
        </div>
      </div>
    </template>

    <div v-if="conflicts.length === 0" class="cf-empty">
      <WsIcon name="check" size="lg" />
      <p>未发现时间冲突</p>
      <span>仅比较与角色关联的事件；未关联角色或时间无法解析的事件不参与检测。</span>
    </div>

    <div v-else class="cf-list">
      <div
        v-for="(c, i) in conflicts"
        :key="i"
        class="cf-item"
        :class="[c.type, { fuzzy: c.fuzzy }]"
        :title="`点击定位到「${c.entities[0]}」`"
        @click="$emit('focus', c.eventIds[0])"
      >
        <div class="cf-item-head">
          <span class="cf-type">{{ typeLabel(c.type) }}</span>
          <span v-if="c.fuzzy" class="cf-fuzzy">模糊</span>
          <span class="cf-date">{{ c.date }}</span>
        </div>
        <p class="cf-desc">{{ c.description }}</p>
        <div class="cf-entities">
          <button
            v-for="(name, idx) in c.entities"
            :key="`${name}-${idx}`"
            type="button"
            class="cf-entity"
            :title="`定位到「${name}」`"
            @click.stop="$emit('focus', c.eventIds[idx])"
          >{{ name }}</button>
        </div>
      </div>
    </div>
  </TuiModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'
import type { Conflict, ConflictScanStats } from '../composables/useConflictDetection'

const props = withDefaults(defineProps<{
  show: boolean
  conflicts: Conflict[]
  stats?: ConflictScanStats
}>(), {
  stats: () => ({ characters: 0, events: 0, scannable: 0 }),
})

defineEmits<{
  close: []
  focus: [eventId: string]
}>()

const preciseCount = computed(() => props.conflicts.filter(item => !item.fuzzy).length)
const fuzzyCount = computed(() => props.conflicts.filter(item => item.fuzzy).length)

function typeLabel(type: Conflict['type']): string {
  return type === 'same_date' ? '同日期' : type === 'overlap' ? '时间重叠' : '同地点'
}
</script>

<style scoped>
.cf-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cf-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--text-color);
}
.cf-summary { display: flex; flex-wrap: wrap; gap: 6px; }
.cf-chip {
  padding: 1px 8px;
  font-size: var(--font-size-xs);
  border-radius: var(--radius-xs);
  background: var(--hover-bg);
  color: var(--text-secondary);
}
.cf-chip--precise { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); }
.cf-chip--fuzzy { background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); }
.cf-chip--scope { color: var(--text-tertiary); }

.cf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 12px;
  text-align: center;
  color: var(--success);
}
.cf-empty p { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
.cf-empty span { color: var(--text-tertiary); font-size: var(--font-size-xs); max-width: 380px; }

.cf-list { display: flex; flex-direction: column; gap: 10px; }
.cf-item {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.cf-item:hover { background: var(--hover-bg); }
.cf-item.same_date { border-left: 3px solid var(--warning); }
.cf-item.overlap { border-left: 3px solid var(--danger); }
.cf-item.same_location { border-left: 3px solid var(--primary); }
/* 模糊日期冲突：虚线左栏 + 徽标，提醒仅供参考 */
.cf-item.fuzzy { border-left-style: dashed; }

.cf-item-head { display: flex; align-items: center; gap: 8px; }
.cf-type {
  padding: 2px 8px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-xs);
}
.same_date .cf-type { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--warning); }
.overlap .cf-type { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
.same_location .cf-type { background: color-mix(in srgb, var(--primary) 15%, transparent); color: var(--primary); }
.cf-fuzzy {
  padding: 0 5px;
  font-size: var(--fs-2xs);
  border: 1px dashed var(--warning);
  border-radius: var(--radius-xs);
  color: var(--warning);
}
.cf-date { margin-left: auto; font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cf-desc { margin: 8px 0 6px; font-size: var(--font-size-sm); color: var(--text-color); }
.cf-entities { display: flex; flex-wrap: wrap; gap: 6px; }
.cf-entity {
  padding: 2px 8px;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  background: var(--hover-bg);
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.cf-entity:hover,
.cf-entity:focus-visible { border-color: var(--primary); color: var(--primary); outline: none; }
</style>
