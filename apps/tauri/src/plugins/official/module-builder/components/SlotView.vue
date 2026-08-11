<template>
  <div
    class="sv"
    :class="[`sv-${slot.arrangement}`, { 'sv--selected': selectedId === slot.id }]"
    :data-slot-id="slot.id"
    :style="slotStyle"
    @click.stop="$emit('select', { id: slot.id, kind: 'slot' })"
  >
    <!-- 槽位头（非根） -->
    <div v-if="showHead" class="sv-head">
      <span class="sv-label">{{ slot.name || slot.arrangement }}</span>
      <button class="sv-remove" title="删除槽位" aria-label="删除槽位" @click.stop="$emit('remove-slot', slot.id)"><WsIcon name="close" size="xs" /></button>
    </div>

    <!-- container：渲染子槽位 -->
    <div v-if="slot.kind === 'container'" class="sv-children" :class="`sv-children-${slot.arrangement}`" :style="containerStyle">
      <SlotView
        v-for="child in slot.children"
        :key="child.id"
        :slot="child"
        :selected-id="selectedId"
        :show-head="child.id !== 'root'"
        @select="$emit('select', $event)"
        @add-leaf="$emit('add-leaf', $event)"
        @add-container="$emit('add-container', $event)"
        @remove-slot="$emit('remove-slot', $event)"
        @select-component="$emit('select-component', $event)"
        @add-component="$emit('add-component', $event)"
        @remove-component="$emit('remove-component', $event)"
        @set-size="$emit('set-size', $event)"
      />
      <button v-if="!slot.children || slot.children.length === 0" class="sv-add-leaf" @click.stop="$emit('add-leaf', slot.id)">＋ 加组件区</button>
    </div>

    <!-- leaf：渲染组件（真实预览） -->
    <div v-else class="sv-leaf" :data-slot-id="slot.id" @dragover.prevent @drop="onDrop($event, slot.id)">
      <div
        v-for="comp in slot.components || []"
        :key="comp.id"
        class="sv-comp"
        :class="{ 'sv-comp--selected': selectedComponentId === comp.id }"
        @click.stop="$emit('select-component', comp.id)"
      >
        <component
          v-if="rendererFor(comp.type)"
          :is="rendererFor(comp.type)"
          :config="comp.config"
          :component-id="comp.id"
        />
        <div v-else class="sv-comp-fallback"><WsIcon :name="iconFor(comp.type)" size="sm" /> {{ labelFor(comp.type) }}</div>
        <div v-if="selectedComponentId === comp.id" class="sv-comp-bar">
          <span class="sv-comp-label">{{ labelFor(comp.type) }}</span>
          <button class="sv-remove" aria-label="移除组件" @click.stop="$emit('remove-component', comp.id)"><WsIcon name="close" size="xs" /></button>
        </div>
      </div>
      <div v-if="!slot.components || slot.components.length === 0" class="sv-drop-hint">拖组件/数据到此处</div>
    </div>

    <!-- 尺寸拖拽手柄 -->
    <div v-if="resizable" class="sv-resize" @mousedown.stop="startResize($event)"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { getComponentType } from '../registry/componentTypeRegistry'
import type { Slot, ComponentTypeId, SlotSize, SlotArrangement } from '../types/layoutSchema'

const props = defineProps<{
  slot: Slot
  selectedId: string | null
  selectedComponentId?: string | null
  showHead?: boolean
  resizable?: boolean
}>()

const emit = defineEmits<{
  select: [payload: { id: string; kind: 'slot' }]
  'add-leaf': [parentId: string]
  'add-container': [payload: { parentId: string; arrangement: SlotArrangement }]
  'remove-slot': [id: string]
  'select-component': [id: string]
  'add-component': [payload: { slotId: string; typeId: ComponentTypeId; config?: Record<string, unknown> }]
  'remove-component': [id: string]
  'set-size': [payload: { id: string; size: Partial<SlotSize> }]
}>()

const slotStyle = computed(() => {
  const s = props.slot.size || {}
  const style: Record<string, string> = {}
  if (s.width && s.width !== 'auto') style.width = s.width + 'px'
  if (s.height && s.height !== 'auto') style.height = s.height + 'px'
  if (s.flex) style.flex = String(s.flex)
  if (s.minWidth) style.minWidth = s.minWidth + 'px'
  if (s.minHeight) style.minHeight = s.minHeight + 'px'
  return style
})

const containerStyle = computed(() => {
  const s = props.slot.options || {}
  if (props.slot.arrangement === 'grid') {
    const cols = Number(s.columns) || 2
    return { gridTemplateColumns: `repeat(${cols}, 1fr)` }
  }
  return {}
})

function rendererFor(typeId: ComponentTypeId): Component | null {
  return getComponentType(typeId)?.renderer || null
}
function iconFor(typeId: ComponentTypeId) { return getComponentType(typeId)?.icon || 'item' }
function labelFor(typeId: ComponentTypeId) { return getComponentType(typeId)?.label || String(typeId) }

function onDrop(e: DragEvent, slotId: string) {
  e.stopPropagation()
  const typeId = e.dataTransfer?.getData('application/worldsmith-component-type')
  const entityName = e.dataTransfer?.getData('application/worldsmith-entity-type')
  if (typeId) emit('add-component', { slotId, typeId: typeId as ComponentTypeId })
  else if (entityName) emit('add-component', { slotId, typeId: 'entity-list', config: { entityType: entityName } })
}

let resizeState: { startX: number; startY: number; origW: number; origH: number; id: string } | null = null

function startResize(e: MouseEvent) {
  e.preventDefault()
  const s = props.slot.size || {}
  const origW = typeof s.width === 'number' ? s.width : 240
  const origH = typeof s.height === 'number' ? s.height : 120
  resizeState = { startX: e.clientX, startY: e.clientY, origW, origH, id: props.slot.id }
  function onMove(ev: MouseEvent) {
    if (!resizeState) return
    const w = Math.max(80, resizeState.origW + ev.clientX - resizeState.startX)
    const h = Math.max(40, resizeState.origH + ev.clientY - resizeState.startY)
    emit('set-size', { id: resizeState.id, size: { width: w, height: h } })
  }
  function onUp() {
    resizeState = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.sv { position: relative; display: flex; flex-direction: column; border: 1px solid transparent; border-radius: var(--radius-sm); min-width: 0; min-height: 40px; }
.sv--selected { border-color: var(--primary); }
.sv-head { display: flex; align-items: center; gap: 6px; padding: 2px 6px; font-size: var(--font-size-xs); color: var(--text-tertiary); border-bottom: 1px dashed var(--border-color); }
.sv-label { font-weight: var(--font-weight-medium); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-remove { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--danger); cursor: pointer; border-radius: var(--radius-2xs); margin-left: auto; flex-shrink: 0; }
.sv-remove:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); }

.sv-children { display: flex; flex: 1; gap: 8px; min-height: 60px; }
.sv-children-horizontal { flex-direction: row; }
.sv-children-vertical { flex-direction: column; }
.sv-children-grid { display: grid; align-items: stretch; }
.sv-children-tabs, .sv-children-accordion, .sv-children-carousel, .sv-children-split { flex-direction: row; }
.sv-add-leaf { padding: 6px; border: 1px dashed var(--border-color); border-radius: var(--radius-xs); background: transparent; color: var(--text-secondary); font-size: var(--font-size-xs); cursor: pointer; align-self: stretch; }

.sv-leaf { position: relative; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 56px; }
.sv-comp { position: relative; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg); min-height: 48px; overflow: hidden; }
.sv-comp:hover { border-color: var(--primary); }
.sv-comp--selected { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft, rgba(79, 70, 229, 0.2)); }
.sv-comp-fallback { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 48px; color: var(--text-secondary); font-size: var(--font-size-sm); }
.sv-comp-bar { position: absolute; top: 4px; right: 4px; display: flex; align-items: center; gap: 4px; background: var(--modal-bg, var(--bg)); border: 1px solid var(--border-color); border-radius: var(--radius-xs); padding: 2px 6px; z-index: 20; box-shadow: var(--shadow-dropdown, none); }
.sv-comp-label { font-size: var(--font-size-xs); color: var(--text-secondary); }
.sv-drop-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: 16px; border: 1px dashed var(--border-color); border-radius: var(--radius-xs); }

.sv-resize { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; cursor: se-resize; }
.sv-resize::after { content: ''; position: absolute; right: 2px; bottom: 2px; width: 6px; height: 6px; border-right: 2px solid var(--text-tertiary); border-bottom: 2px solid var(--text-tertiary); }
</style>