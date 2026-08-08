<template>
  <div class="slot-canvas" @dragover.prevent @drop="onDrop">
    <div v-if="!schema || !schema.layout || schema.layout.children.length === 0" class="canvas-empty">
      <div class="canvas-empty-guide">
        <span class="ceg-icon"><WsIcon name="settings" size="xl" /></span>
        <h3>开始构建布局</h3>
        <p>点击下方工具栏添加槽位区域，然后从左侧拖拽组件到区域中</p>
      </div>
    </div>
    <div v-else class="canvas-layout">
      <SlotEditorRenderer :slot="schema.layout" :components="schema.components" :selected-id="selectedComponentId" @select="onSelectComponent" @remove-component="onRemoveComponent" @layout-change="onLayoutChange" />
    </div>
    <div class="canvas-toolbar">
      <button class="ct-btn" @click="addHorizontalSplit">↔ 水平分割</button>
      <button class="ct-btn" @click="addVerticalSplit">↕ 垂直分割</button>
      <button class="ct-btn ct-btn-danger" @click="removeLastZone" v-if="zoneCount > 1">✕ 删除末尾区域</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ModuleLayoutSchema, ComponentTypeId } from '../types/layoutSchema'
import SlotEditorRenderer from './SlotEditorRenderer.vue'

const props = defineProps<{
  schema: ModuleLayoutSchema
  selectedComponentId: string | null
}>()

const emit = defineEmits<{
  'add-component': [zoneId: string, typeId: ComponentTypeId]
  'select-component': [componentId: string | null]
  'update-schema': [schema: ModuleLayoutSchema]
  'remove-component': [componentId: string]
  'layout-change': []
}>()

const zoneCount = computed(() => {
  let count = 0
  if (!props.schema?.layout) return 0
  function walk(children: any[]) {
    for (const c of children) {
      if (c.type === 'zone') count++
      else if (c.type === 'slot') walk(c.slot.children)
    }
  }
  walk(props.schema.layout.children)
  return count
})

function onDrop(e: DragEvent) {
  const typeId = e.dataTransfer?.getData('application/worldsmith-component-type')
  if (!typeId) return
  const zoneEl = (e.target as HTMLElement).closest('[data-zone-id]')
  const zoneId = zoneEl?.getAttribute('data-zone-id')
  if (zoneId) {
    emit('add-component', zoneId, typeId as ComponentTypeId)
  }
}

function onSelectComponent(componentId: string | null) {
  emit('select-component', componentId)
}

function onRemoveComponent(componentId: string) {
  emit('remove-component', componentId)
}

function onLayoutChange() {
  emit('layout-change')
}

function addHorizontalSplit() {
  const schema: ModuleLayoutSchema = props.schema
    ? { ...props.schema, layout: { ...props.schema.layout }, components: [...props.schema.components] }
    : { version: 1, layout: { id: 'root', direction: 'horizontal', children: [] }, components: [] }
  if (!schema.layout || schema.layout.children.length === 0) {
    schema.layout = { id: 'root', direction: 'horizontal', children: [{ type: 'zone', zoneId: 'zone-1', flex: 1 }] }
  } else {
    const zoneId = `zone-${Date.now()}`
    schema.layout = { ...schema.layout, children: [...schema.layout.children, { type: 'zone', zoneId, flex: 1 }] }
  }
  emit('update-schema', schema)
}

function addVerticalSplit() {
  const schema: ModuleLayoutSchema = props.schema
    ? { ...props.schema, layout: { ...props.schema.layout }, components: [...props.schema.components] }
    : { version: 1, layout: { id: 'root', direction: 'vertical', children: [] }, components: [] }
  if (!schema.layout || schema.layout.children.length === 0) {
    schema.layout = { id: 'root', direction: 'vertical', children: [{ type: 'zone', zoneId: 'zone-1', flex: 1 }] }
  } else {
    const zoneId = `zone-${Date.now()}`
    schema.layout = { ...schema.layout, children: [...schema.layout.children, { type: 'zone', zoneId, flex: 1 }] }
  }
  emit('update-schema', schema)
}

function removeLastZone() {
  if (!props.schema?.layout) return
  const schema = { ...props.schema, layout: { ...props.schema.layout }, components: [...props.schema.components] }
  if (schema.layout && schema.layout.children.length > 1) {
    schema.layout = { ...schema.layout, children: schema.layout.children.slice(0, -1) }
    emit('update-schema', schema)
  }
}
</script>

<style scoped>
.slot-canvas { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.canvas-layout { flex: 1; padding: 12px; overflow: auto; }
.canvas-empty { display: flex; align-items: center; justify-content: center; flex: 1; }
.canvas-empty-guide { text-align: center; }
.ceg-icon { font-size: var(--icon-2xl); display: block; margin-bottom: 12px; }
.canvas-empty-guide h3 { font-size: var(--font-size-lg); margin: 0 0 8px; }
.canvas-empty-guide p { font-size: var(--font-size-sm); color: var(--text-secondary); }
.canvas-toolbar { display: flex; gap: 6px; padding: 6px 12px; border-top: 1px solid var(--border-color); background: var(--bg-secondary); }
.ct-btn { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg); font-size: var(--font-size-sm); cursor: pointer; color: var(--text-secondary); }
.ct-btn:hover { background: var(--hover-bg); }
.ct-btn-danger { color: var(--danger); }
</style>
