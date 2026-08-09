<template>
  <div class="editor-view">
    <div class="editor-header">
      <div class="eh-left">
        <button class="btn-ghost" @click="$emit('back')">← 返回</button>
        <span class="eh-icon"><WsIcon :name="module.icon || 'settings'" size="md" /></span>
        <input v-model="module.name" class="eh-name" placeholder="模块名称" @input="markDirty" />
        <input v-model="module.icon" class="eh-icon-input" maxlength="2" placeholder="图标" @input="markDirty" />
      </div>
      <div class="eh-right">
        <button class="btn-ghost" @click="handleUndo" :disabled="!undoRedo.canUndo.value">↩ 撤销</button>
        <button class="btn-ghost" @click="handleRedo" :disabled="!undoRedo.canRedo.value">↪ 重做</button>
        <button class="btn-secondary" @click="saveModule"><WsIcon name="item" size="xs" /> 保存</button>
      </div>
    </div>

    <div class="editor-body">
      <ComponentPalette />
      <SlotCanvas
        :schema="layoutSchema"
        :selected-component-id="selectedComponentId"
        @add-component="onAddComponent"
        @select-component="onSelectComponent"
        @update-schema="onUpdateSchema"
        @remove-component="onRemoveComponent"
        @layout-change-start="onLayoutChangeStart"
        @layout-change="onLayoutChange"
      />
      <ComponentConfigPanel
        :selected-component="selectedComponent"
        @update-config="onUpdateConfig"
      />
    </div>

    <div class="editor-bottom">
      <button class="eb-toggle" @click="showBottomPanel = !showBottomPanel">
        <WsIcon :name="showBottomPanel ? 'chevron-down' : 'chevron-right'" size="xs" /> {{ showBottomPanel ? '收起' : '实体/关系/字段定义' }}
      </button>
      <div v-if="showBottomPanel" class="eb-panel">
        <div class="eb-section">
          <h5>实体类型</h5>
          <button class="eb-add-btn" @click="addEntityType">＋ 新建实体类型</button>
          <div v-for="(et, idx) in module.entityTypes" :key="et.name" class="eb-item" role="button" tabindex="0" :aria-label="`选择 ${et.label || et.name}`" @click="selectEntityType(idx)" @keydown.enter.prevent="selectEntityType(idx)" @keydown.space.prevent="selectEntityType(idx)">
            <span>{{ et.icon }} {{ et.label || et.name }}</span>
            <button class="eb-rm" @click.stop="removeEntityType(idx)"><WsIcon name="close" size="xs" /></button>
          </div>
        </div>
        <div class="eb-section">
          <h5>关系类型</h5>
          <button class="eb-add-btn" @click="addRelationType">＋ 新建关系类型</button>
          <div v-for="(rt, idx) in module.relationTypes" :key="rt.name" class="eb-item" role="button" tabindex="0" :aria-label="`选择 ${rt.label || rt.name}`" @click="selectRelationType(idx)" @keydown.enter.prevent="selectRelationType(idx)" @keydown.space.prevent="selectRelationType(idx)">
            <span>{{ rt.icon || 'link' }} {{ rt.label || rt.name }}</span>
            <button class="eb-rm" @click.stop="removeRelationType(idx)"><WsIcon name="close" size="xs" /></button>
          </div>
        </div>
        <div class="eb-section" v-if="selectedEntityTypeIdx !== null">
          <h5>字段（{{ module.entityTypes[selectedEntityTypeIdx]?.label }}）</h5>
          <button class="eb-add-btn" @click="addField(selectedEntityTypeIdx!)">＋ 添加字段</button>
          <div v-for="(f, fi) in currentEntityFields" :key="f.key" class="eb-field-item">
            <input v-model="f.key" class="eb-field-input" placeholder="字段键" />
            <input v-model="f.label" class="eb-field-input" placeholder="显示名" />
            <select v-model="f.type" class="eb-field-select">
              <option v-for="ft in fieldTypes" :key="ft.value" :value="ft.value">{{ ft.label }}</option>
            </select>
            <button class="eb-rm" @click="removeField(selectedEntityTypeIdx!, fi)" aria-label="移除"><WsIcon name="close" size="xs" /></button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, provide, onUnmounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useCustomModuleStore } from '@worldsmith/entity-core'
import type { CustomModule } from '@worldsmith/entity-core'
import type { ModuleLayoutSchema, PlacedComponent, ComponentTypeId } from './types/layoutSchema'
import { getComponentType } from './registry/componentTypeRegistry'
import { initializeComponentTypes, fieldTypes } from './moduleConfig'
import { useUndoRedo } from './composables/useUndoRedo'
import ComponentPalette from './components/ComponentPalette.vue'
import SlotCanvas from './components/SlotCanvas.vue'
import ComponentConfigPanel from './components/ComponentConfigPanel.vue'

initializeComponentTypes()

const props = defineProps<{ moduleId: string }>()
defineEmits<{ back: [] }>()

const customModuleStore = useCustomModuleStore()

const module = reactive<CustomModule>({
  id: '',
  name: '',
  icon: 'settings',
  description: '',
  entityTypes: [],
  relationTypes: [],
  views: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  layoutSchema: { version: 1, layout: { id: 'root', direction: 'vertical', children: [] }, components: [] },
})

provide<CustomModule>('module', module)

onMounted(() => {
  const mod = customModuleStore.getModule(props.moduleId)
  if (mod) {
    Object.assign(module, { ...mod })
  }
  if (!module.layoutSchema) {
    module.layoutSchema = { version: 1, layout: { id: 'root', direction: 'vertical', children: [] }, components: [] }
  }
})

const layoutSchema = computed({
  get: () => module.layoutSchema!,
  set: (val) => { module.layoutSchema = val },
})

const undoRedo = useUndoRedo(module.layoutSchema || { version: 1, layout: { id: 'root', direction: 'vertical', children: [] }, components: [] })

function handleUndo() {
  const schema = undoRedo.undo()
  if (schema) module.layoutSchema = schema
}

function handleRedo() {
  const schema = undoRedo.redo()
  if (schema) module.layoutSchema = schema
}

function pushHistory(label: string) {
  undoRedo.push(module.layoutSchema!, label)
}

function handleKeyboard(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo() }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo() }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyboard)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyboard)
})

const selectedComponentId = ref<string | null>(null)
const showBottomPanel = ref(false)
const selectedEntityTypeIdx = ref<number | null>(null)

const selectedComponent = computed(() => {
  if (!selectedComponentId.value) return null
  return layoutSchema.value.components.find(c => c.id === selectedComponentId.value) || null
})

const currentEntityFields = computed(() => {
  if (selectedEntityTypeIdx.value === null) return []
  return module.entityTypes[selectedEntityTypeIdx.value]?.fields || []
})

function markDirty() {}

function saveModule() {
  module.updatedAt = new Date().toISOString()
  customModuleStore.updateModule(module.id, { ...module })
}

function onAddComponent(zoneId: string, typeId: ComponentTypeId) {
  const def = getComponentType(typeId)
  const comp: PlacedComponent = {
    id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
    type: typeId,
    zoneId,
    config: { ...(def?.defaultConfig || {}) },
    order: layoutSchema.value.components.filter(c => c.zoneId === zoneId).length,
  }
  layoutSchema.value.components.push(comp)
  selectedComponentId.value = comp.id
}

function onSelectComponent(componentId: string | null) {
  selectedComponentId.value = componentId
}

function onUpdateSchema(schema: ModuleLayoutSchema) {
  pushHistory('更新布局')
  module.layoutSchema = schema
}

function onUpdateConfig(componentId: string, config: Record<string, unknown>) {
  pushHistory('更新配置')
  const comp = layoutSchema.value.components.find(c => c.id === componentId)
  if (comp) comp.config = config
}

function onRemoveComponent(componentId: string) {
  pushHistory('移除组件')
  const idx = layoutSchema.value.components.findIndex(c => c.id === componentId)
  if (idx !== -1) layoutSchema.value.components.splice(idx, 1)
  if (selectedComponentId.value === componentId) selectedComponentId.value = null
}

function onLayoutChangeStart() {
  pushHistory('拖拽/拉伸')
}

function onLayoutChange() {
  markDirty()
}

function addEntityType() {
  const name = `entity_${module.entityTypes.length + 1}`
  module.entityTypes.push({ name, label: `实体类型${module.entityTypes.length + 1}`, icon: 'manuscript', color: '#4a6cf7', fields: [{ key: 'description', label: '描述', type: 'textarea' }] })
  selectedEntityTypeIdx.value = module.entityTypes.length - 1
}

function addRelationType() {
  module.relationTypes.push({ name: `relation_${module.relationTypes.length + 1}`, label: `关系${module.relationTypes.length + 1}`, sourceTypes: [], targetTypes: [], directed: true, properties: [] })
}

function addField(etIdx: number) {
  const et = module.entityTypes[etIdx]
  if (!et) return
  et.fields.push({ key: `field_${et.fields.length + 1}`, label: `字段${et.fields.length + 1}`, type: 'text' })
}

function removeEntityType(idx: number) {
  module.entityTypes.splice(idx, 1)
  selectedEntityTypeIdx.value = null
}

function removeRelationType(idx: number) {
  module.relationTypes.splice(idx, 1)
}

function removeField(etIdx: number, fi: number) {
  module.entityTypes[etIdx]?.fields.splice(fi, 1)
}

function selectEntityType(idx: number) {
  selectedEntityTypeIdx.value = idx
}

function selectRelationType(_idx: number) {}
</script>

<style scoped>
.editor-view { display: flex; flex-direction: column; height: 100%; }
.editor-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--border-color); background: var(--canvas-bg); flex-shrink: 0; }
.eh-left { display: flex; align-items: center; gap: 8px; }
.eh-icon { font-size: var(--font-size-2xl); }
.eh-name { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); border: none; background: transparent; padding: 4px 8px; border-radius: var(--radius-xs); width: 200px; color: var(--text-color); }
.eh-name:focus { background: var(--bg); outline: 1px solid var(--primary); }
.eh-icon-input { width: 40px; text-align: center; font-size: var(--font-size-lg); border: 1px solid var(--border-color); border-radius: var(--radius-xs); padding: 4px; background: var(--bg); color: var(--text-color); }
.eh-right { display: flex; gap: 8px; }
.editor-body { display: flex; flex: 1; overflow: hidden; }
.editor-bottom { border-top: 1px solid var(--border-color); flex-shrink: 0; }
.eb-toggle { width: 100%; padding: 6px 12px; background: var(--bg-secondary); border: none; cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary); text-align: left; }
.eb-panel { display: flex; gap: 16px; padding: 12px; max-height: 200px; overflow-y: auto; }
.eb-section { min-width: 200px; }
.eb-section h5 { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0 0 6px; }
.eb-add-btn { display: block; width: 100%; padding: 6px; border: 1px dashed var(--text-tertiary); background: var(--canvas-bg); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-sm); color: var(--primary); margin-bottom: 4px; }
.eb-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-2xs); }
.eb-item:hover { background: var(--hover-bg); }
.eb-rm { width: 18px; height: 18px; border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: var(--font-size-xs); border-radius: var(--radius-xs); }
.eb-field-item { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
.eb-field-input { width: 70px; padding: 3px 6px; border: 1px solid var(--border-color); border-radius: var(--radius-2xs); font-size: var(--font-size-xs); background: var(--bg); color: var(--text-color); }
.eb-field-select { padding: 3px; border: 1px solid var(--border-color); border-radius: var(--radius-2xs); font-size: var(--font-size-xs); background: var(--bg); color: var(--text-color); }
.btn-ghost { padding: 6px 12px; background: transparent; border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary); }
.btn-ghost:hover { background: var(--hover-bg); }
.btn-secondary { padding: 8px 16px; background: var(--primary); color: var(--on-accent); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
.btn-secondary:hover { opacity: 0.9; }
</style>
