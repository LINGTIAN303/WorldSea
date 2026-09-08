<template>
  <div class="dynamic-view">
    <!-- Toolbar -->
    <div class="dv-toolbar">
      <input v-model="searchQuery" class="dv-search" :aria-label="`搜索${entityTypeDef?.label || '条目'}`" :placeholder="`搜索${entityTypeDef?.label || '条目'}...`" />
      <button class="btn-primary" @click="openNewForm">＋ 新建</button>
    </div>

    <!-- Entity List -->
    <div class="dv-list">
      <div v-for="e in filteredEntities" :key="e.id" class="dv-card" role="button" tabindex="0" :aria-label="`打开 ${e.name}`" @click="selectEntity(e)" @keydown.enter.prevent="selectEntity(e)" @keydown.space.prevent="selectEntity(e)">
        <div class="dv-card-header">
          <WsIcon :name="entitySchemaRegistry.getIconName(entityTypeKey)" size="sm" />
          <strong>{{ e.name }}</strong>
        </div>
        <div class="dv-card-fields">
          <div v-for="f in displayFields" :key="f.key" class="dv-card-field">
            <span class="dv-card-label">{{ f.label }}:</span>
            <span class="dv-card-value">{{ formatValue(e.properties[f.key], f) }}</span>
          </div>
        </div>
      </div>
      <p v-if="filteredEntities.length === 0" class="empty">还没有实体</p>
    </div>

    <!-- Detail / Edit Panel -->
    <div v-if="selectedEntity" class="dv-detail">
      <button class="detail-close" @click="selectedEntity = null">✕</button>
      <h2>{{ selectedEntity.name }}</h2>
      <div class="dv-detail-fields">
        <div v-for="f in allFields" :key="f.key" class="dv-detail-row">
          <span class="dv-detail-label">{{ f.label }}</span>
          <span v-if="!editing" class="dv-detail-value">{{ formatValue(selectedEntity.properties[f.key], f) }}</span>
          <div v-else class="dv-detail-edit">
            <input v-if="f.type==='text'||f.type==='url'||f.type==='email'||f.type==='color'" v-model="editForm[f.key]" :aria-label="f.label" />
            <textarea v-else-if="f.type==='textarea'||f.type==='rich-text'||f.type==='markdown'" v-model="editForm[f.key]" rows="3" :aria-label="f.label"></textarea>
            <input v-else-if="f.type==='number'" v-model.number="editForm[f.key]" type="number" :aria-label="f.label" />
            <label v-else-if="f.type==='boolean'"><input type="checkbox" v-model="editForm[f.key]" /> {{ f.label }}</label>
            <input v-else-if="f.type==='date'" v-model="editForm[f.key]" type="date" :aria-label="f.label" />
            <select v-else-if="f.type==='select'" v-model="editForm[f.key]" :aria-label="f.label">
              <option value="">--</option>
              <option v-for="o in f.options" :key="o">{{ o }}</option>
            </select>
            <input v-else v-model="editForm[f.key]" :aria-label="f.label" />
          </div>
        </div>
      </div>
      <div class="dv-detail-actions">
        <button v-if="!editing" class="btn-secondary" @click="startEdit">编辑</button>
        <button v-if="editing" class="btn-primary" @click="saveEdit">保存</button>
        <button v-if="editing" class="btn-secondary" @click="editing = false">取消</button>
        <button class="btn-danger" @click="deleteEntity">删除</button>
      </div>
    </div>

    <!-- New Entity Form -->
    <div v-if="showNewForm" class="modal-overlay" @click.self="showNewForm = false">
      <div class="modal">
        <h2>新建{{ entityTypeDef?.label || '条目' }}</h2>
        <div class="form">
          <div v-for="f in allFields" :key="f.key" class="form-field">
            <label>{{ f.label }}<span v-if="f.required">*</span></label>
            <input v-if="f.type==='text'||f.type==='url'||f.type==='email'||f.type==='color'" v-model="newForm[f.key]" :aria-label="f.label" />
            <textarea v-else-if="f.type==='textarea'||f.type==='rich-text'||f.type==='markdown'" v-model="newForm[f.key]" rows="3" :aria-label="f.label"></textarea>
            <input v-else-if="f.type==='number'" v-model.number="newForm[f.key]" type="number" :aria-label="f.label" />
            <label v-else-if="f.type==='boolean'" class="inline-label">
              <input type="checkbox" v-model="newForm[f.key]" /> {{ f.label }}
            </label>
            <input v-else-if="f.type==='date'" v-model="newForm[f.key]" type="date" :aria-label="f.label" />
            <select v-else-if="f.type==='select'" v-model="newForm[f.key]" :aria-label="f.label">
              <option value="">--</option>
              <option v-for="o in f.options" :key="o">{{ o }}</option>
            </select>
            <div v-else-if="f.type==='multi-select'" class="multi-select">
              <label v-for="o in f.options" :key="o" class="ms-item">
                <input type="checkbox" :value="o" v-model="newForm[f.key]" /> {{ o }}
              </label>
            </div>
            <p v-if="f.helpText" class="field-hint">{{ f.helpText }}</p>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showNewForm = false">取消</button>
          <button class="btn-primary" @click="saveNew">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useEntityStore, entitySchemaRegistry } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'
import type { Entity, CustomModule, ModuleField, ModuleViewConfig } from '@worldsea/entity-core'

const props = defineProps<{
  module: CustomModule
  viewConfig: ModuleViewConfig
}>()

const entityStore = useEntityStore()
const searchQuery = ref('')
const selectedEntity = ref<Entity | null>(null)
const editing = ref(false)
const showNewForm = ref(false)

const entityTypeDef = computed(() =>
  props.module.entityTypes.find(et => et.name === props.viewConfig.entityType)
)

const allFields = computed(() => entityTypeDef.value?.fields || [])

const displayFields = computed(() => {
  const fields = allFields.value
  const show = props.viewConfig.showFields
  if (show.length === 0) return fields.slice(0, 3)
  return fields.filter(f => show.includes(f.key))
})

const entityTypeKey = computed(() => `custom.${props.module.id}.${props.viewConfig.entityType}`)

const entities = computed(() =>
  entityStore.entities.filter(e => e.type === entityTypeKey.value)
)

const filteredEntities = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return entities.value
  return entities.value.filter(e => e.name.toLowerCase().includes(q))
})

const editForm = ref<Record<string, any>>({})
const newForm = ref<Record<string, any>>({})

onMounted(() => loadData())

async function loadData() {
  await entityStore.loadAll()
}

function selectEntity(e: Entity) {
  selectedEntity.value = e
  editing.value = false
}

function startEdit() {
  if (!selectedEntity.value) return
  editing.value = true
  editForm.value = { ...selectedEntity.value.properties }
  editForm.value._name = selectedEntity.value.name
  editForm.value._description = selectedEntity.value.description
}

async function saveEdit() {
  if (!selectedEntity.value) return
  const { _name, _description, ...props } = editForm.value
  await entityStore.update(selectedEntity.value.id, {
    name: _name || selectedEntity.value.name,
    description: _description || '',
    properties: props,
  })
  editing.value = false
  await loadData()
}

function openNewForm() {
  newForm.value = { _name: '', _description: '' }
  for (const f of allFields.value) {
    if (f.type === 'boolean') newForm.value[f.key] = false
    else if (f.type === 'multi-select') newForm.value[f.key] = []
    else newForm.value[f.key] = f.defaultValue ?? ''
  }
  showNewForm.value = true
}

async function saveNew() {
  const { _name, _description, ...props } = newForm.value
  const entity: Entity = {
    id: `${props.module?.id || 'entity'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: entityTypeKey.value,
    name: _name || '未命名',
    description: _description || '',
    properties: props,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await entityStore.add(entity)
  showNewForm.value = false
  await loadData()
}

async function deleteEntity() {
  if (!selectedEntity.value) return
  await entityStore.remove(selectedEntity.value.id)
  selectedEntity.value = null
  await loadData()
}

function formatValue(val: unknown, field: ModuleField): string {
  if (val === undefined || val === null) return '—'
  if (field.type === 'boolean') return val ? 'Yes' : 'No'
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}
</script>

<style scoped>
.dynamic-view { display: flex; flex-direction: column; height: 100%; padding: 20px; }
.dv-toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-shrink: 0; }
.dv-search { flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 6px; font-size: var(--font-size-base); }

.dv-list { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.dv-card { padding: 12px; background: #f9f9f9; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-color); }
.dv-card:hover { background: #f0f0ff; }
.dv-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.dv-card-icon { font-size: var(--font-size-xl); }
.dv-card-fields { display: flex; flex-direction: column; gap: 2px; }
.dv-card-field { font-size: var(--font-size-sm); color: var(--text-secondary); display: flex; gap: 4px; }
.dv-card-label { color: var(--text-tertiary); }
.dv-card-value { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Detail Panel */
.dv-detail { position: fixed; right: 0; top: var(--layout-menubar-height); bottom: 0; width: 400px; background: var(--bg); border-left: 1px solid var(--border-color); padding: 20px; overflow-y: auto; z-index: var(--z-sticky); }
.detail-close { position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; color: var(--text-tertiary); }
.dv-detail-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px 12px; margin: 12px 0; }
.dv-detail-row { display: flex; flex-direction: column; gap: 2px; grid-column: span 1; }
.dv-detail-label { font-size: var(--font-size-sm); color: #888; font-weight: var(--font-weight-medium); }
.dv-detail-value { font-size: var(--font-size-base); }
.dv-detail-edit input, .dv-detail-edit textarea, .dv-detail-edit select { width: 100%; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); font-family: inherit; }
.dv-detail-actions { display: flex; gap: 8px; margin-top: 16px; }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: var(--z-sticky); }
.modal { background: var(--bg); border-radius: 12px; padding: 24px; max-width: 540px; width: 90%; max-height: 80vh; overflow-y: auto; }
.modal h2 { margin: 0 0 16px; font-size: var(--font-size-xl); }
.form { display: flex; flex-direction: column; gap: 10px; }
.form-field { display: flex; flex-direction: column; gap: 3px; }
.form-field label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.form-field input, .form-field textarea, .form-field select { padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-base); font-family: inherit; }
.form-field input[type="checkbox"] { width: auto; }
.inline-label { display: flex; flex-direction: row !important; align-items: center; gap: 6px; cursor: pointer; }
.multi-select { display: flex; flex-direction: column; gap: 4px; }
.ms-item { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); cursor: pointer; }
.ms-item input { width: auto; }
.field-hint { font-size: var(--font-size-xs); color: #aaa; margin: 2px 0 0; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.btn-primary { padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
.btn-secondary { padding: 8px 16px; background: var(--border-color); color: var(--text); border: none; border-radius: 6px; cursor: pointer; }
.btn-danger { padding: 8px 16px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; }
.empty { text-align: center; color: var(--text-tertiary); margin-top: 60px; }
</style>
