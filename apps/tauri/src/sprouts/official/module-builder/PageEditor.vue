<template>
  <div class="page-editor">
    <div class="pe-header">
      <div class="pe-left">
        <button class="btn-ghost" @click="$emit('back')">← 返回</button>
        <WsIcon :name="module.icon || 'settings'" size="md" class="pe-icon" />
        <input v-model="module.name" class="pe-name" placeholder="模块名称" />
        <input v-model="module.icon" class="pe-icon-input" maxlength="2" placeholder="图标" />
      </div>
      <div class="pe-right">
        <button class="btn-ghost" @click="undo" :disabled="!canUndo">↩ 撤销</button>
        <button class="btn-ghost" @click="redo" :disabled="!canRedo">↪ 重做</button>
        <button class="btn-secondary" @click="save">保存</button>
        <button class="btn-primary" @click="publish">发布</button>
      </div>
    </div>

    <div class="pe-body">
      <Toolbox
        :target-slot-id="targetSlotId"
        :target-name="targetName"
        @add-container="addContainer"
        @add-leaf="addLeaf"
      />

      <!-- 画布：工具条区 + 视图区 -->
      <div class="pe-canvas">
        <div class="pc-section pc-toolbar">
          <div class="pc-section-label">① 工具条区</div>
          <SlotView
            :slot="page.toolbar"
            :selected-id="selectedSlotId"
            :selected-component-id="selectedComponentId"
            :show-head="false"
            @select="onSelectSlot"
            @add-leaf="addLeaf"
            @add-container="addContainer"
            @remove-slot="removeSlot"
            @select-component="onSelectComponent"
            @add-component="addComponent"
            @remove-component="removeComponent"
            @set-size="setSize"
          />
        </div>
        <div class="pc-section pc-view">
          <div class="pc-section-label">② 视图区</div>
          <SlotView
            :slot="page.view"
            :selected-id="selectedSlotId"
            :selected-component-id="selectedComponentId"
            :show-head="false"
            @select="onSelectSlot"
            @add-leaf="addLeaf"
            @add-container="addContainer"
            @remove-slot="removeSlot"
            @select-component="onSelectComponent"
            @add-component="addComponent"
            @remove-component="removeComponent"
            @set-size="setSize"
          />
        </div>
      </div>

      <!-- 右侧：图层 + 属性 -->
      <div class="pe-right-panel">
        <div class="er-panel">
          <LayerPanel
            :toolbar="page.toolbar"
            :view="page.view"
            :selected-slot-id="selectedSlotId"
            :selected-component-id="selectedComponentId"
            :selected-key="selectedKey"
            @select="onLayerSelect"
            @reorder="reorder"
            @remove="remove"
          />
        </div>
        <div class="er-panel er-config">
          <PropertyPanel :selected-component="selectedComponent" @update-config="updateConfig" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, provide } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useCustomModuleStore } from '@worldsea/entity-core'
import type { CustomModule } from '@worldsea/entity-core'
import type { Slot, PlacedComponent, ComponentTypeId, SlotArrangement, SlotSize } from './types/layoutSchema'
import type { PageSchema } from './types/pageSchema'
import { getComponentType } from './registry/componentTypeRegistry'
import { initializeComponentTypes } from './moduleConfig'
import { createModuleRuntimeContext } from './runtime/ModuleRuntimeContext'
import { migrateToPageSchema } from './pageMigration'
import { makeSlotId, makeComponentId, findSlot, findComponentSlot, addChildSlot, removeComponent as treeRemoveComponent, removeSlot as treeRemoveSlot, reorderComponent } from './slotTree'
import Toolbox from './components/Toolbox.vue'
import SlotView from './components/SlotView.vue'
import LayerPanel from './components/LayerPanel.vue'
import PropertyPanel from './components/PropertyPanel.vue'

initializeComponentTypes()

const props = defineProps<{ moduleId: string }>()
const emit = defineEmits<{ back: []; publish: [id: string] }>()

const customModuleStore = useCustomModuleStore()

const module = reactive<CustomModule>({
  id: '', name: '', icon: 'settings', description: '', entityTypes: [], relationTypes: [], views: [],
  createdAt: '', updatedAt: '', layoutSchema: undefined,
})

provide<CustomModule>('module', module)

const page = reactive<PageSchema>({ version: 3, toolbar: { id: 'toolbar', arrangement: 'horizontal', kind: 'container', children: [] }, view: { id: 'view', arrangement: 'vertical', kind: 'container', children: [] } })

onMounted(() => {
  const mod = customModuleStore.getModule(props.moduleId)
  if (mod) Object.assign(module, { ...mod })
  const migrated = migrateToPageSchema(module.layoutSchema as unknown)
  Object.assign(page, migrated)
  module.layoutSchema = migrated as unknown as CustomModule['layoutSchema']
  initRuntime()
})

const runtimeCtx = createModuleRuntimeContext(module)
provide('moduleRuntimeContext', runtimeCtx)
onBeforeUnmount(() => runtimeCtx?.dispose())
function initRuntime() { runtimeCtx.initialize() }

/* 撤销/重做 */
const history = ref<PageSchema[]>([])
const historyIdx = ref(-1)
const canUndo = computed(() => historyIdx.value >= 0)
const canRedo = computed(() => historyIdx.value < history.value.length - 1)
function pushHistory() {
  const snap = JSON.parse(JSON.stringify(page)) as PageSchema
  history.value = history.value.slice(0, historyIdx.value + 1)
  history.value.push(snap)
  if (history.value.length > 50) history.value.shift()
  historyIdx.value = history.value.length - 1
}
function undo() {
  if (!canUndo.value) return
  historyIdx.value--
  Object.assign(page, JSON.parse(JSON.stringify(history.value[historyIdx.value])))
}
function redo() {
  if (!canRedo.value) return
  historyIdx.value++
  Object.assign(page, JSON.parse(JSON.stringify(history.value[historyIdx.value])))
}

/* 选中 */
const selectedSlotId = ref<string | null>(null)
const selectedComponentId = ref<string | null>(null)
const selectedKey = ref<string | null>(null)

const targetSlotId = computed(() => selectedSlotId.value || (selectedComponentId.value ? componentSlotId.value : null) || 'view')
const targetName = computed(() => targetSlotId.value === 'view' ? '视图区' : targetSlotId.value === 'toolbar' ? '工具条区' : targetSlotId.value)

const componentSlotId = computed(() => {
  if (!selectedComponentId.value) return null
  return findComponentSlot(page.view, selectedComponentId.value)?.id || findComponentSlot(page.toolbar, selectedComponentId.value)?.id || null
})

const selectedComponent = computed<PlacedComponent | null>(() => {
  if (!selectedComponentId.value) return null
  return findComponentSlot(page.view, selectedComponentId.value)?.components?.find(c => c.id === selectedComponentId.value)
    || findComponentSlot(page.toolbar, selectedComponentId.value)?.components?.find(c => c.id === selectedComponentId.value) || null
})

function slotIn(slotId: string): Slot | null {
  return (slotId === 'toolbar' ? page.toolbar : slotId === 'view' ? page.view : findSlot(page.view, slotId) || findSlot(page.toolbar, slotId))
}

function onSelectSlot(p: { id: string; kind: string }) {
  selectedSlotId.value = p.id; selectedComponentId.value = null; selectedKey.value = `slot:${p.id}`
}
function onSelectComponent(id: string) {
  selectedComponentId.value = id; selectedSlotId.value = null; selectedKey.value = `comp:${id}`
}
function onLayerSelect(key: string) {
  if (key.startsWith('comp:')) { selectedComponentId.value = key.slice(5); selectedSlotId.value = null; selectedKey.value = key }
  else if (key.startsWith('slot:')) { selectedSlotId.value = key.slice(5); selectedComponentId.value = null; selectedKey.value = key }
  else if (key === 'sec:toolbar') { selectedSlotId.value = 'toolbar'; selectedComponentId.value = null; selectedKey.value = key }
  else if (key === 'sec:view') { selectedSlotId.value = 'view'; selectedComponentId.value = null; selectedKey.value = key }
}

/* 槽位操作 */
function addContainer(p: { parentId: string; arrangement: SlotArrangement }) {
  const parent = slotIn(p.parentId || 'view')
  if (!parent || parent.kind !== 'container') return
  const leafId = makeSlotId('leaf')
  const container: Slot = { id: makeSlotId('slot'), name: p.arrangement, arrangement: p.arrangement, kind: 'container', children: [{ id: leafId, name: '组件区', arrangement: 'vertical', kind: 'leaf', components: [] }] }
  pushHistory(); addChildSlot(parent, container.id, container); selectedSlotId.value = leafId; selectedComponentId.value = null
}
function addLeaf(parentId: string) {
  const parent = slotIn(parentId || 'view')
  if (!parent || parent.kind !== 'container') return
  const leaf: Slot = { id: makeSlotId('leaf'), name: '组件区', arrangement: 'vertical', kind: 'leaf', components: [] }
  pushHistory(); addChildSlot(parent, leaf.id, leaf); selectedSlotId.value = leaf.id; selectedComponentId.value = null
}
function removeSlot(slotId: string) {
  pushHistory()
  if (findSlot(page.view, slotId)) removeSlotIn(page.view, slotId)
  if (findSlot(page.toolbar, slotId)) removeSlotIn(page.toolbar, slotId)
  if (selectedSlotId.value === slotId) selectedSlotId.value = null
}
function removeSlotIn(root: Slot, slotId: string) { treeRemoveSlot(root, slotId) }
function setSize(p: { id: string; size: Partial<SlotSize> }) {
  const slot = slotIn(p.id); if (slot) slot.size = { ...(slot.size || {}), ...p.size }
}

/* 组件操作 */
function addComponent(p: { slotId: string; typeId: ComponentTypeId; config?: Record<string, unknown> }) {
  const slot = slotIn(p.slotId); if (!slot || slot.kind !== 'leaf') return
  const def = getComponentType(p.typeId)
  const comp: PlacedComponent = { id: makeComponentId(), type: p.typeId, config: { ...(def?.defaultConfig || {}), ...(p.config || {}) }, order: (slot.components || []).length }
  pushHistory(); if (!slot.components) slot.components = []; slot.components.push(comp); selectedComponentId.value = comp.id; selectedSlotId.value = null
}
function removeComponent(id: string) {
  pushHistory()
  if (findComponentSlot(page.view, id)) treeRemoveComponent(page.view, id)
  if (findComponentSlot(page.toolbar, id)) treeRemoveComponent(page.toolbar, id)
  if (selectedComponentId.value === id) selectedComponentId.value = null
}
function updateConfig(id: string, config: Record<string, unknown>) {
  const slot = findComponentSlot(page.view, id) || findComponentSlot(page.toolbar, id)
  const comp = slot?.components?.find(c => c.id === id); if (comp) comp.config = config
}
function reorder(key: string, dir: number) {
  if (key.startsWith('comp:')) {
    const id = key.slice(5)
    const slot = findComponentSlot(page.view, id) || findComponentSlot(page.toolbar, id)
    if (slot) reorderComponent(slot, id, dir)
  }
}
function remove(key: string) {
  if (key.startsWith('comp:')) removeComponent(key.slice(5))
  else if (key.startsWith('slot:')) removeSlot(key.slice(5))
}

function save() { module.updatedAt = new Date().toISOString(); customModuleStore.updateModule(module.id, { ...module }) }
function publish() { emit('publish', module.id) }
</script>

<style scoped>
.page-editor { display: flex; flex-direction: column; height: 100%; }
.pe-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--border-color); background: var(--canvas-bg); flex-shrink: 0; }
.pe-left { display: flex; align-items: center; gap: 8px; }
.pe-icon { font-size: var(--font-size-2xl); }
.pe-name { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); border: none; background: transparent; padding: 4px 8px; border-radius: var(--radius-xs); width: 200px; color: var(--text-color); }
.pe-icon-input { width: 40px; text-align: center; font-size: var(--font-size-lg); border: 1px solid var(--border-color); border-radius: var(--radius-xs); padding: 4px; background: var(--bg); color: var(--text-color); }
.pe-right { display: flex; gap: 8px; }
.pe-body { display: flex; flex: 1; overflow: hidden; }
.pe-canvas { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow: auto; background: var(--canvas-bg, var(--bg)); }
.pc-section { display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.pc-toolbar { min-height: 70px; }
.pc-view { flex: 1; }
.pc-section-label { font-size: var(--font-size-xs); color: var(--text-tertiary); padding: 4px 8px; border-bottom: 1px solid var(--border-color); }
.pe-right-panel { display: flex; flex-direction: column; width: 280px; border-left: 1px solid var(--border-color); flex-shrink: 0; }
.er-panel { padding: 12px; overflow-y: auto; }
.er-config { flex: 1; border-top: 1px solid var(--border-color); }
.btn-ghost { padding: 6px 12px; background: transparent; border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary); }
.btn-ghost:hover { background: var(--hover-bg); }
.btn-secondary { padding: 8px 16px; background: var(--primary); color: var(--on-accent); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
.btn-primary { padding: 8px 16px; background: var(--success); color: var(--on-accent); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
</style>