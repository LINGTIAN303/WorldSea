<template>
  <div class="slot-editor" :class="[`slot-${slot.direction}`]">
    <template v-for="(child, idx) in slot.children" :key="idx">
      <div v-if="child.type === 'zone'" class="slot-zone-editor" :data-zone-id="child.zoneId" :style="zoneStyle(child)"
        @dragover.prevent @drop="onDropInZone($event, child.zoneId)">
        <div class="zone-label">{{ child.zoneId }}</div>
        <div class="zone-canvas">
          <div v-for="comp in zoneComponents(child.zoneId)" :key="comp.id"
            class="zone-component"
            :class="{ selected: selectedId === comp.id, expanded: comp.expanded }"
            :style="compStyle(comp)"
            @mousedown.stop="startDrag($event, comp)"
            @click.stop="$emit('select', comp.id)"
          >
            <div class="zc-header">
              <span class="zc-icon"><WsIcon :name="getCompIcon(comp.type)" size="xs" /></span>
              <span class="zc-label">{{ getCompLabel(comp.type) }}</span>
              <button class="zc-expand" v-if="isExpandable(comp.type)" @click.stop="toggleExpand(comp)" aria-label="展开"><WsIcon :name="comp.expanded ? 'chevron-down' : 'chevron-right'" size="xs" /></button>
              <button class="zc-remove" @click.stop="removeComponent(comp.id)" aria-label="移除"><WsIcon name="close" size="xs" /></button>
            </div>
            <div v-if="comp.expanded && comp.childSlot" class="zc-child-slot">
              <SlotEditorRenderer :slot="comp.childSlot" :components="components" :selected-id="selectedId" @select="$emit('select', $event)" @remove-component="$emit('remove-component', $event)" @layout-change="$emit('layout-change')" />
            </div>
            <div class="zc-resize-handle" @mousedown.stop="startResize($event, comp)"></div>
          </div>
        </div>
        <div class="zone-drop-hint" v-if="zoneComponents(child.zoneId).length === 0">拖拽组件到此处</div>
      </div>
      <SlotEditorRenderer v-else :slot="child.slot" :components="components" :selected-id="selectedId" @select="$emit('select', $event)" @remove-component="$emit('remove-component', $event)" @layout-change-start="$emit('layout-change-start')" @layout-change="$emit('layout-change')" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { getComponentType } from '../registry/componentTypeRegistry'
import { WsIcon } from '@worldsmith/ui-kit'
import type { LayoutSlot, LayoutSlotChild, PlacedComponent, ComponentTypeId } from '../types/layoutSchema'

const EXPANDABLE_TYPES: ComponentTypeId[] = ['detail-panel', 'edit-form', 'property-panel', 'tab-container', 'accordion-container', 'split-panel']

const props = defineProps<{
  slot: LayoutSlot
  components: PlacedComponent[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string | null]
  'add-component': [zoneId: string, typeId: ComponentTypeId]
  'remove-component': [id: string]
  'layout-change': []
  'layout-change-start': []
}>()

function zoneStyle(child: LayoutSlotChild) {
  if (child.type !== 'zone') return {}
  const style: Record<string, string> = {}
  if (child.width && child.width !== 'auto') style.width = child.width + 'px'
  if (child.height && child.height !== 'auto') style.height = child.height + 'px'
  if (child.flex) style.flex = String(child.flex)
  return style
}

function compStyle(comp: PlacedComponent) {
  const style: Record<string, string> = {}
  if (comp.x !== undefined) style.left = comp.x + 'px'
  if (comp.y !== undefined) style.top = comp.y + 'px'
  if (comp.width && comp.width !== 'auto') style.width = comp.width + 'px'
  if (comp.height && comp.height !== 'auto') style.height = comp.height + 'px'
  return style
}

function zoneComponents(zoneId: string): PlacedComponent[] {
  return props.components.filter(c => c.zoneId === zoneId).sort((a, b) => a.order - b.order)
}

function getCompIcon(typeId: ComponentTypeId) {
  return getComponentType(typeId)?.icon || 'item'
}

function getCompLabel(typeId: ComponentTypeId) {
  return getComponentType(typeId)?.label || typeId
}

function isExpandable(typeId: ComponentTypeId) {
  return EXPANDABLE_TYPES.includes(typeId)
}

function toggleExpand(comp: PlacedComponent) {
  comp.expanded = !comp.expanded
  if (comp.expanded && !comp.childSlot) {
    comp.childSlot = {
      id: `child-${comp.id}`,
      direction: 'vertical',
      children: [{ type: 'zone', zoneId: `child-zone-${comp.id}`, flex: 1 }],
    }
  }
}

function removeComponent(id: string) {
  emit('remove-component', id)
}

function onDropInZone(e: DragEvent, zoneId: string) {
  const typeId = e.dataTransfer?.getData('application/worldsmith-component-type')
  if (!typeId) return
  emit('add-component', zoneId, typeId as ComponentTypeId)
}

function startDrag(e: MouseEvent, comp: PlacedComponent) {
  const startX = e.clientX
  const startY = e.clientY
  const origX = comp.x || 0
  const origY = comp.y || 0

  function onMove(ev: MouseEvent) {
    comp.x = Math.max(0, origX + ev.clientX - startX)
    comp.y = Math.max(0, origY + ev.clientY - startY)
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startResize(e: MouseEvent, comp: PlacedComponent) {
  emit('layout-change-start')
  const startX = e.clientX
  const startY = e.clientY
  const origW = typeof comp.width === 'number' ? comp.width : 200
  const origH = typeof comp.height === 'number' ? comp.height : 80

  function onMove(ev: MouseEvent) {
    comp.width = Math.max(80, origW + ev.clientX - startX)
    comp.height = Math.max(40, origH + ev.clientY - startY)
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.slot-editor { display: flex; gap: 8px; }
.slot-horizontal { flex-direction: row; }
.slot-vertical { flex-direction: column; }
.slot-zone-editor { border: 2px dashed var(--border-color); border-radius: var(--radius-mid); padding: 8px; min-height: 80px; display: flex; flex-direction: column; gap: 4px; }
.zone-label { font-size: var(--font-size-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.zone-canvas { position: relative; min-height: 60px; flex: 1; }
.zone-component { position: absolute; display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg); cursor: grab; font-size: var(--font-size-sm); min-width: 80px; min-height: 40px; user-select: none; }
.zone-component:hover { background: var(--hover-bg); }
.zone-component.selected { border-color: var(--primary); background: var(--primary-light); }
.zone-component.expanded { z-index: 10; }
.zc-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border-color); }
.zc-icon { font-size: var(--font-size-base); }
.zc-label { flex: 1; }
.zc-expand { width: 20px; height: 20px; border: none; background: transparent; cursor: pointer; font-size: var(--font-size-xs); border-radius: var(--radius-2xs); color: var(--text-secondary); }
.zc-expand:hover { background: var(--hover-bg); }
.zc-remove { width: 18px; height: 18px; border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: var(--font-size-xs); border-radius: var(--radius-xs); }
.zc-remove:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.zc-child-slot { padding: 8px; min-height: 60px; }
.zc-resize-handle { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; cursor: se-resize; }
.zc-resize-handle::after { content: ''; position: absolute; right: 2px; bottom: 2px; width: 6px; height: 6px; border-right: 2px solid var(--text-tertiary); border-bottom: 2px solid var(--text-tertiary); }
.zone-drop-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; padding: 8px; border: 1px dashed var(--border-color); border-radius: var(--radius-xs); }
</style>
