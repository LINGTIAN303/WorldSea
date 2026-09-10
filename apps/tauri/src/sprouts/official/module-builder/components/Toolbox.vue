<template>
  <div class="toolbox">
    <!-- 画槽位 -->
    <div class="tb-group">
      <h4 class="tb-title">画槽位</h4>
      <div class="tb-arrs">
        <button
          v-for="(label, key) in ARRANGEMENT_LABEL"
          :key="key"
          class="tb-arr"
          :class="{ active: arrangement === key }"
          :title="label"
          @click="arrangement = key"
        ><WsIcon :name="ARRANGEMENT_ICON[key]" size="xs" /></button>
      </div>
      <button class="tb-action" @click="$emit('add-container', { parentId: targetSlotId || 'view', arrangement })">＋ 画「{{ ARRANGEMENT_LABEL[arrangement] }}」区</button>
      <button class="tb-action" @click="$emit('add-leaf', targetSlotId || 'view')">＋ 画组件区</button>
      <p class="tb-target">目标：{{ targetName }}</p>
    </div>

    <!-- 数据 -->
    <div class="tb-group">
      <h4 class="tb-title">数据</h4>
      <div class="tb-sec-head">
        <span>实体类型</span>
        <button class="tb-add" title="新建实体类型" aria-label="新建实体类型" @click="addEntityType"><WsIcon name="plus" size="xs" /></button>
      </div>
      <div
        v-for="(et, idx) in module.entityTypes"
        :key="et.name"
        class="tb-data-item"
        draggable="true"
        @dragstart="onEntityDrag(et, $event)"
        @click="toggleEntity(idx)"
      >
        <span class="tb-data-name">{{ et.label || et.name }}</span>
        <button class="tb-rm" aria-label="移除实体类型" @click.stop="removeEntityType(idx)"><WsIcon name="close" size="xs" /></button>
      </div>
      <div v-if="openEntityIdx !== null" class="tb-fields" @click.stop>
        <div v-for="(f, fi) in currentFields" :key="f.key" class="tb-field-row">
          <input class="tb-input" v-model="f.key" placeholder="键" />
          <input class="tb-input" v-model="f.label" placeholder="显示名" />
          <select class="tb-select" v-model="f.type">
            <option v-for="ft in fieldTypes" :key="ft.value" :value="ft.value">{{ ft.label }}</option>
          </select>
          <button class="tb-rm" aria-label="移除字段" @click="removeField(fi, $event)"><WsIcon name="close" size="xs" /></button>
        </div>
        <button class="tb-action" @click="addField">＋ 添加字段</button>
      </div>
      <div class="tb-sec-head">
        <span>关系类型</span>
        <button class="tb-add" title="新建关系类型" aria-label="新建关系类型" @click="addRelationType"><WsIcon name="plus" size="xs" /></button>
      </div>
      <div v-for="(rt, idx) in module.relationTypes" :key="rt.name" class="tb-data-item">
        <span class="tb-data-name">{{ rt.label || rt.name }}</span>
        <button class="tb-rm" aria-label="移除关系类型" @click.stop="removeRelationType(idx)"><WsIcon name="close" size="xs" /></button>
      </div>
    </div>

    <!-- 组件 -->
    <div class="tb-group">
      <h4 class="tb-title">组件</h4>
      <div v-for="cat in categories" :key="cat.id" class="tb-cat">
        <h5 class="tb-cat-label">{{ cat.label }}</h5>
        <div v-for="comp in cat.components" :key="comp.typeId" class="tb-comp" draggable="true" @dragstart="onCompDrag(comp, $event)">
          <WsIcon :name="comp.icon" size="xs" /><span>{{ comp.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, inject } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { getAllComponentTypes } from '../registry/componentTypeRegistry'
import { fieldTypes } from '../moduleConfig'
import { ARRANGEMENT_LABEL, ARRANGEMENT_ICON } from '../slotTree'
import type { ComponentTypeDefinition, SlotArrangement } from '../types/layoutSchema'
import type { CustomModule, ModuleEntityType } from '@worldsea/entity-core'

const module = inject<CustomModule>('module', {
  id: '', name: '', icon: 'settings', description: '',
  entityTypes: [], relationTypes: [], views: [],
  createdAt: '', updatedAt: '',
})

const props = defineProps<{ targetSlotId: string | null; targetName: string }>()
const emit = defineEmits<{
  'add-container': [payload: { parentId: string; arrangement: SlotArrangement }]
  'add-leaf': [parentId: string]
}>()

const arrangement = ref<SlotArrangement>('horizontal')
const openEntityIdx = ref<number | null>(null)

const categories = computed(() => {
  const all = getAllComponentTypes()
  const map = new Map<string, ComponentTypeDefinition[]>()
  for (const c of all) {
    const list = map.get(c.category) || []; list.push(c); map.set(c.category, list)
  }
  const order: Record<string, string> = {
    'detail-edit': '详情编辑', 'action-tool': '操作工具', 'search-filter': '搜索筛选',
    'data-display': '数据展示', 'visualization': '可视化', 'layout-container': '布局容器',
  }
  return Object.entries(order).map(([id, label]) => ({ id, label, components: map.get(id as any) || [] })).filter(c => c.components.length)
})

const currentFields = computed(() => {
  if (openEntityIdx.value === null) return []
  return module.entityTypes[openEntityIdx.value]?.fields || []
})

function toggleEntity(idx: number) { openEntityIdx.value = openEntityIdx.value === idx ? null : idx }
function addEntityType() {
  module.entityTypes.push({ name: `entity_${module.entityTypes.length + 1}`, label: `实体类型${module.entityTypes.length + 1}`, icon: 'manuscript', color: '#4a6cf7', fields: [{ key: 'description', label: '描述', type: 'textarea' }] })
  openEntityIdx.value = module.entityTypes.length - 1
}
function addRelationType() {
  module.relationTypes.push({ name: `relation_${module.relationTypes.length + 1}`, label: `关系${module.relationTypes.length + 1}`, sourceTypes: [], targetTypes: [], directed: true, properties: [] })
}
function addField() {
  const idx = openEntityIdx.value
  if (idx === null) return
  module.entityTypes[idx].fields.push({ key: `field_${module.entityTypes[idx].fields.length + 1}`, label: `字段${module.entityTypes[idx].fields.length + 1}`, type: 'text' })
}
function removeEntityType(idx: number) { module.entityTypes.splice(idx, 1); if (openEntityIdx.value === idx) openEntityIdx.value = null }
function removeRelationType(idx: number) { module.relationTypes.splice(idx, 1) }
function removeField(fi: number, e: Event) { e.stopPropagation(); const idx = openEntityIdx.value; if (idx !== null) module.entityTypes[idx].fields.splice(fi, 1) }

function onCompDrag(comp: ComponentTypeDefinition, e: DragEvent) {
  e.dataTransfer!.setData('application/worldsea-component-type', comp.typeId)
  e.dataTransfer!.effectAllowed = 'copy'
}
function onEntityDrag(et: ModuleEntityType, e: DragEvent) {
  e.dataTransfer!.setData('application/worldsea-entity-type', et.name)
  e.dataTransfer!.effectAllowed = 'copy'
}
</script>

<style scoped>
.toolbox { display: flex; flex-direction: column; gap: 16px; padding: 12px; overflow-y: auto; }
.tb-group { display: flex; flex-direction: column; }
.tb-title { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 8px; }
.tb-arrs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tb-arr { width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); border-radius: var(--radius-xs); background: var(--bg); color: var(--text-secondary); cursor: pointer; }
.tb-arr.active { border-color: var(--primary); color: var(--primary); background: var(--primary-soft, rgba(79,70,229,0.08)); }
.tb-action { padding: 5px 8px; border: 1px dashed var(--border-color); border-radius: var(--radius-xs); background: transparent; color: var(--primary); font-size: var(--font-size-xs); cursor: pointer; margin-bottom: 4px; text-align: left; }
.tb-action:hover { background: var(--hover-bg); }
.tb-target { font-size: var(--font-size-xs); color: var(--text-tertiary); margin: 0; }
.tb-sec-head { display: flex; align-items: center; justify-content: space-between; color: var(--text-tertiary); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.5px; margin: 4px 0; }
.tb-add { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border: 1px dashed var(--border-color); background: transparent; border-radius: var(--radius-2xs); color: var(--primary); cursor: pointer; }
.tb-data-item { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 4px 6px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); margin-bottom: 3px; cursor: pointer; }
.tb-data-item:hover { border-color: var(--primary); }
.tb-data-name { font-size: var(--font-size-xs); color: var(--text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-rm { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--danger); cursor: pointer; border-radius: var(--radius-2xs); flex-shrink: 0; }
.tb-fields { padding: 4px; }
.tb-field-row { display: flex; gap: 3px; margin-bottom: 3px; align-items: center; }
.tb-input { flex: 1; min-width: 0; padding: 2px 4px; border: 1px solid var(--border-color); border-radius: var(--radius-2xs); font-size: var(--font-size-xs); background: var(--bg); color: var(--text-color); }
.tb-select { max-width: 76px; padding: 2px; border: 1px solid var(--border-color); border-radius: var(--radius-2xs); font-size: var(--font-size-xs); background: var(--bg); color: var(--text-color); }
.tb-cat { margin-bottom: 8px; }
.tb-cat-label { font-size: var(--font-size-xs); color: var(--text-tertiary); margin: 0 0 4px; }
.tb-comp { display: flex; align-items: center; gap: 5px; padding: 4px 6px; border: 1px dashed var(--border-color); border-radius: var(--radius-xs); margin-bottom: 3px; cursor: grab; font-size: var(--font-size-xs); color: var(--primary); }
.tb-comp:hover { border-color: var(--primary); background: var(--hover-bg); }
</style>