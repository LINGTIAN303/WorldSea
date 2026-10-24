<template>
  <TuiModal :show="show" size="lg" @close="$emit('close')">
    <template #header>
      <div class="cf-head">
        <h2 class="cf-title"><WsIcon name="warning" size="sm" /> 时间冲突检测</h2>
        <div class="cf-modes" role="tablist" aria-label="检测口径">
          <button
            type="button" role="tab" class="cf-mode" :class="{ active: mode === 'time' }"
            :aria-selected="mode === 'time'" @click="$emit('update:mode', 'time')"
          >时间重叠 <b>{{ counts.time }}{{ truncated ? '+' : '' }}</b></button>
          <button
            type="button" role="tab" class="cf-mode" :class="{ active: mode === 'character' }"
            :aria-selected="mode === 'character'" @click="$emit('update:mode', 'character')"
          >角色日程 <b>{{ counts.character }}</b></button>
        </div>
        <div class="cf-summary">
          <span class="cf-chip cf-chip--precise">精确 {{ preciseCount }}</span>
          <span v-if="fuzzyCount" class="cf-chip cf-chip--fuzzy">模糊 {{ fuzzyCount }}</span>
          <span class="cf-chip cf-chip--scope">{{ scopeText }}</span>
        </div>
      </div>
    </template>

    <div v-if="conflicts.length === 0" class="cf-empty">
      <WsIcon name="check" size="lg" />
      <template v-if="mode === 'time'">
        <p>未发现时间重叠</p>
        <span>按当前历法比较全部可上轴事件；「早于 / 晚于」这类开放式日期不参与比较。</span>
      </template>
      <template v-else>
        <p>未发现角色日程冲突</p>
        <span v-if="stats.involveRelations === 0">尚未建立「涉及」关系：在事件详情「关联」页的「涉及」分组点「＋」关联角色/组织，才能比对同一角色的行程。</span>
        <span v-else>已比对 {{ stats.characters }} 个角色关联的 {{ stats.scannable }} 个事件，未发现时间重叠。</span>
      </template>
    </div>

    <template v-else>
      <div class="cf-list">
        <div
          v-for="(c, i) in conflicts"
          :key="i"
          class="cf-item"
          :class="[c.type, { fuzzy: c.fuzzy }]"
          :title="`定位「${c.entities[0]}」并高亮双方`"
          @click="$emit('focus', c.eventIds[0], c.eventIds[1])"
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
              :title="`定位到「${name}」（另一方同时高亮）`"
              @click.stop="$emit('focus', c.eventIds[idx], c.eventIds[1 - idx])"
            >{{ name }}</button>
          </div>
        </div>
      </div>
      <p v-if="truncated && mode === 'time'" class="cf-note">仅显示前 {{ counts.time }} 对；用「角色日程」看精度更高的双重预订冲突。</p>
    </template>
  </TuiModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'
import type { Conflict, ConflictMode, ConflictScanStats } from '../composables/useConflictDetection'

const props = withDefaults(defineProps<{
  show: boolean
  conflicts: Conflict[]
  /** 当前检测口径（与工具条徽标同源） */
  mode: ConflictMode
  /** 两种口径的条数（切换按钮上展示） */
  counts?: { time: number; character: number }
  /** 全量口径命中展示上限 */
  truncated?: boolean
  stats?: ConflictScanStats
}>(), {
  counts: () => ({ time: 0, character: 0 }),
  truncated: false,
  stats: () => ({ characters: 0, events: 0, scannable: 0, involveRelations: 0 }),
})

defineEmits<{
  close: []
  'update:mode': [mode: ConflictMode]
  /** 定位方 + 对位方（对位方只高亮不选中，便于同时看到冲突双方） */
  focus: [eventId: string, peerId: string]
}>()

const preciseCount = computed(() => props.conflicts.filter(item => !item.fuzzy).length)
const fuzzyCount = computed(() => props.conflicts.filter(item => item.fuzzy).length)
const scopeText = computed(() => (
  props.mode === 'time'
    ? `当前历法 ${props.stats.scannable} 个可比较事件`
    : `检查范围：${props.stats.characters} 个角色 / ${props.stats.scannable} 个事件`
))

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
.cf-modes { display: flex; gap: 4px; }
.cf-mode {
  padding: 3px 10px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--hover-bg);
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
}
.cf-mode.active {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
}
.cf-mode b { margin-left: 4px; font-weight: var(--font-weight-semibold); }

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
.cf-note { margin: 10px 0 0; font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
