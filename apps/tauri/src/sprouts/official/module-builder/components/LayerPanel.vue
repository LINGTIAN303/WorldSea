<template>
  <div class="layer-panel">
    <h4 class="lp-title">图层</h4>
    <div v-if="items.length === 0" class="lp-empty">还没有内容<br/>在画布上画槽位、放组件</div>
    <div v-for="item in items" :key="item.key" class="lp-item" :class="{ selected: selectedKey === item.key }" @click="onSelect(item)">
      <span class="lp-indent" :style="{ paddingLeft: item.depth * 12 + 'px' }"></span>
      <WsIcon :name="item.icon" size="xs" class="lp-icon" />
      <span class="lp-name">{{ item.label }}</span>
      <button class="lp-btn" :disabled="!item.canUp" aria-label="上移" @click.stop="$emit('reorder', item.key, -1)"><WsIcon name="chevron-up" size="xs" /></button>
      <button class="lp-btn" :disabled="!item.canDown" aria-label="下移" @click.stop="$emit('reorder', item.key, 1)"><WsIcon name="chevron-down" size="xs" /></button>
      <button class="lp-btn lp-btn-danger" aria-label="删除" @click.stop="$emit('remove', item.key)"><WsIcon name="close" size="xs" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { getComponentType } from '../registry/componentTypeRegistry'
import { ARRANGEMENT_ICON } from '../slotTree'
import type { Slot, ComponentTypeId } from '../types/layoutSchema'

const props = defineProps<{
  toolbar: Slot
  view: Slot
  selectedKey: string | null
  selectedSlotId: string | null
  selectedComponentId: string | null
}>()

const emit = defineEmits<{
  select: [key: string]
  reorder: [key: string, dir: number]
  remove: [key: string]
}>()

interface Item { key: string; label: string; icon: string; depth: number; kind: 'slot' | 'component'; slotId: string; compId?: string; canUp: boolean; canDown: boolean }

function flattenSequence(slot: Slot, depth: number, out: Item[]): void {
  const isRoot = slot.id === 'root' || slot.id === 'toolbar' || slot.id === 'view'
  if (!isRoot) {
    out.push({ key: `slot:${slot.id}`, label: slot.name || slot.arrangement, icon: ARRANGEMENT_ICON[slot.arrangement], depth, kind: 'slot', slotId: slot.id, canUp: out.length > 0, canDown: true })
  }
  if (slot.kind === 'leaf') {
    for (const c of slot.components || []) {
      out.push({ key: `comp:${c.id}`, label: labelFor(c.type), icon: iconFor(c.type), depth: depth + 1, kind: 'component', slotId: slot.id, compId: c.id, canUp: out.length > 0, canDown: true })
    }
  } else {
    for (const child of slot.children || []) flattenSequence(child, depth + (isRoot ? 0 : 1), out)
  }
}

const items = computed<Item[]>(() => {
  const out: Item[] = []
  out.push({ key: 'sec:toolbar', label: '工具条区', icon: 'settings', depth: 0, kind: 'slot', slotId: props.toolbar.id, canUp: false, canDown: true })
  flattenSequence(props.toolbar, 0, out)
  out.push({ key: 'sec:view', label: '视图区', icon: 'dashboard', depth: 0, kind: 'slot', slotId: props.view.id, canUp: true, canDown: false })
  flattenSequence(props.view, 0, out)
  // 计算 canDown
  for (let i = 0; i < out.length; i++) out[i].canDown = i < out.length - 1
  return out
})

const selectedKey = computed(() => {
  if (props.selectedComponentId) return `comp:${props.selectedComponentId}`
  if (props.selectedSlotId) return `slot:${props.selectedSlotId}`
  return null
})

function onSelect(item: Item) {
  emit('select', item.key)
}

function iconFor(typeId: ComponentTypeId) { return getComponentType(typeId)?.icon || 'item' }
function labelFor(typeId: ComponentTypeId) { return getComponentType(typeId)?.label || String(typeId) }
</script>

<style scoped>
.layer-panel { display: flex; flex-direction: column; height: 100%; overflow-y: auto; }
.lp-title { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 8px; }
.lp-empty { color: var(--text-tertiary); font-size: var(--font-size-sm); text-align: center; padding: 20px; line-height: 1.5; }
.lp-item { display: flex; align-items: center; gap: 5px; padding: 4px 6px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); margin-bottom: 3px; cursor: pointer; }
.lp-item:hover { background: var(--hover-bg); }
.lp-item.selected { border-color: var(--primary); background: var(--primary-soft, rgba(79,70,229,0.08)); }
.lp-indent { flex-shrink: 0; }
.lp-icon { flex-shrink: 0; }
.lp-name { flex: 1; font-size: var(--font-size-xs); color: var(--text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lp-btn { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; border-radius: var(--radius-2xs); flex-shrink: 0; }
.lp-btn:disabled { opacity: 0.3; cursor: default; }
.lp-btn:hover:not(:disabled) { background: var(--hover-bg); }
.lp-btn-danger { color: var(--danger); }
</style>