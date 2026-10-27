<template>
  <div class="isl-list">
    <div v-if="groups.length === 0" class="isl-empty">{{ emptyText }}</div>
    <section v-for="group in groups" :key="group.id" class="isl-group">
      <div class="isl-group-head">
        <WsIcon v-if="group.icon" :name="group.icon" size="xs" class="isl-group-icon" />
        <span class="isl-group-label">{{ group.label }}</span>
        <span class="isl-group-count">{{ group.items.length }}</span>
      </div>
      <div class="isl-rows">
        <div v-for="slot in group.items" :key="slot.key" class="isl-row">
          <button
            type="button"
            class="isl-icon-btn"
            :title="`换图标：${slot.label}`"
            :aria-label="`${slot.label}图标，点击更换`"
            @click="emit('edit', slot)"
          >
            <WsIcon :name="iconOf(slot)" size="sm" />
          </button>
          <span class="isl-label">{{ slot.label }}</span>
          <span class="isl-source" :class="`is-${sourceOf(slot)}`">{{ iconSourceLabel(sourceOf(slot)) }}</span>
          <span v-if="showIgnoredGlobal(slot)" class="isl-ignored" title="全局有设置，但本项目已停止跟随">全局未跟随</span>
          <button
            v-if="sourceOf(slot) === 'project'"
            type="button"
            class="isl-reset"
            title="取消本项目设置"
            :aria-label="`取消${slot.label}的本项目图标设置`"
            @click="emit('reset', slot)"
          >撤销</button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { IconOverrideSource } from '@worldsea/entity-core'
import { iconSourceLabel, type IconSlotListGroup } from '@/world/iconPanelModel'
import type { IconSlot } from '@/world/iconSlots'

const props = withDefaults(defineProps<{
  groups: IconSlotListGroup[]
  iconOf: (slot: IconSlot) => string
  sourceOf: (slot: IconSlot) => IconOverrideSource
  hasGlobal?: (slot: IconSlot) => boolean
  emptyText?: string
}>(), {
  hasGlobal: () => () => false,
  emptyText: '没有匹配的图标',
})

const emit = defineEmits<{
  edit: [slot: IconSlot]
  reset: [slot: IconSlot]
}>()

function showIgnoredGlobal(slot: IconSlot): boolean {
  return props.sourceOf(slot) === 'default' && props.hasGlobal(slot)
}
</script>

<style scoped>
.isl-list { display: flex; flex-direction: column; gap: 8px; }
.isl-empty { padding: 20px 8px; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary); }
.isl-group { border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-md); overflow: hidden; }
.isl-group-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--bg-secondary, var(--color-bg-elevated)); color: var(--text-secondary); font-size: var(--font-size-xs, 12px); }
.isl-group-icon { color: var(--text-tertiary); }
.isl-group-label { font-weight: var(--font-weight-medium, 500); }
.isl-group-count { margin-left: auto; color: var(--text-tertiary); font-size: var(--text-micro-font-size, 10px); }
.isl-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.isl-row { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 6px; border-top: 1px solid var(--border, var(--color-border)); }
.isl-row:nth-child(-n + 2) { border-top: none; }
.isl-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex-shrink: 0; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; }
.isl-icon-btn:hover, .isl-icon-btn:focus-visible { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); background: var(--hover-bg, var(--color-bg-hover)); }
.isl-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-sm); color: var(--text-color, var(--color-text)); }
.isl-source { flex-shrink: 0; padding: 1px 5px; border-radius: 999px; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); background: var(--bg-secondary, var(--color-bg-elevated)); }
.isl-source.is-global { color: var(--primary, var(--color-primary)); }
.isl-source.is-project { color: var(--success, var(--color-success)); }
.isl-ignored { flex-shrink: 0; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.isl-reset { margin-left: auto; flex-shrink: 0; padding: 0 4px; border: none; background: transparent; color: var(--text-tertiary); font-size: var(--text-micro-font-size, 10px); cursor: pointer; }
.isl-reset:hover { color: var(--danger, var(--color-danger)); }
@media (max-width: 720px) {
  .isl-rows { grid-template-columns: 1fr; }
  .isl-row:nth-child(2) { border-top: 1px solid var(--border, var(--color-border)); }
}
</style>
