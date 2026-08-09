<template>
  <div class="simple-entity-view">
    <div class="toolbar">
      <input v-model="searchQuery" :placeholder="`搜索${label}...`" class="search-input" :aria-label="`搜索${label}`" />
      <CustomDropdown
        v-for="fd in filterDefs"
        :key="fd.key"
        v-model="filters[fd.key]"
        :options="fd.options || dynamicFilterOptions(fd.key, fd.label)"
      />
      <CreateButton :label="`新建${label}`" @click="openNewForm" />
      <button v-if="selectedIds.size > 0" class="btn-danger btn-sm" @click="onBatchDel">
        <WsIcon name="delete" size="xs" /> 删除 ({{ selectedIds.size }})
      </button>
      <button v-if="selectedIds.size > 0" class="btn-ghost btn-sm" @click="clearSelection">取消选择</button>
    </div>

    <n-alert v-if="filteredItems.length > 200" type="warning" :show-icon="true" class="large-list-warning">
      当前显示 {{ filteredItems.length }} 项，建议使用筛选器缩小范围以获得最佳体验。
    </n-alert>
    <div class="entity-grid">
      <div
        v-for="item in filteredItems"
        :key="item.id"
        class="entity-card-wrapper"
        :class="{
          'is-flipped': hasImageField && flippedIds.has(item.id),
          'batch-selected': selectedIds.has(item.id),
          'active': selectedItem?.id === item.id,
        }"
      >
        <div v-if="hasImageField" class="entity-card-flipper">
          <div class="entity-card card-front" @click="selectItem(item)" @keydown.enter="selectItem(item)" role="button" tabindex="0">
            <input type="checkbox" class="batch-check" :checked="selectedIds.has(item.id)" @change="toggleSelect(item.id)" @click.stop />
            <EntityCardCover :entity="item" :cover-field-key="coverFieldKey" />
            <div class="card-header">
              <WsIcon class="card-icon" :name="cardIcon(item)" size="sm" />
              <div class="card-body">
                <h3>{{ item.name }}</h3>
                <p v-if="cardSubtitle">{{ item.properties[cardSubtitle] }}</p>
              </div>
              <div v-if="cardFooterFields?.length" class="card-footer">
                <span
                  v-for="ff in cardFooterFields"
                  :key="ff.key"
                  class="card-tag"
                  :class="ff.classMap?.[String(item.properties[ff.key] || '')]"
                >
                  {{ item.properties[ff.key] }}
                </span>
              </div>
            </div>
            <button class="card-flip-btn" @click.stop="toggleFlip(item.id)" title="翻转查看图片">🔄</button>
          </div>
          <div class="entity-card card-back" role="button" tabindex="0" :aria-label="`翻转回 ${item.name} 正面`" @click="toggleFlip(item.id)" @keydown.enter.prevent="toggleFlip(item.id)" @keydown.space.prevent="toggleFlip(item.id)">
            <EntityCardBack :entity="item" :cover-field-key="coverFieldKey" />
            <div class="card-back-info">
              <h3>{{ item.name }}</h3>
              <p v-if="cardSubtitle">{{ item.properties[cardSubtitle] }}</p>
            </div>
            <button class="card-flip-btn" @click.stop="toggleFlip(item.id)" title="翻转回正面">🔄</button>
          </div>
        </div>
        <div v-else class="entity-card" @click="selectItem(item)" @keydown.enter="selectItem(item)" role="button" tabindex="0">
          <input type="checkbox" class="batch-check" :checked="selectedIds.has(item.id)" @change="toggleSelect(item.id)" @click.stop />
          <div class="card-header">
            <WsIcon class="card-icon" :name="cardIcon(item)" size="sm" />
            <div class="card-body">
              <h3>{{ item.name }}</h3>
              <p v-if="cardSubtitle">{{ item.properties[cardSubtitle] }}</p>
            </div>
            <div v-if="cardFooterFields?.length" class="card-footer">
              <span
                v-for="ff in cardFooterFields"
                :key="ff.key"
                class="card-tag"
                :class="ff.classMap?.[String(item.properties[ff.key] || '')]"
              >
                {{ item.properties[ff.key] }}
              </span>
            </div>
          </div>
        </div>
      </div>
      <WsEmpty
        v-if="filteredItems.length === 0 && !loading"
        preset="no-data"
        :title="`暂无${label}`"
        :description="`点击上方按钮创建第一个${label}`"
      />
    </div>

    <EntityDetailPanel
      :visible="!!selectedItem"
      :entity="selectedItem"
      :icon="detailIcon"
      :title="selectedItem?.name"
      :subtitle="detailSubtitle"
      :tabs="resolvedTabs"
      :show-edit="true"
      :editing="isEditing"
      :panel-id="`detail-${entityType}`"
      @close="selectedItem = null"
      @edit="isEditing ? cancelEdit() : startEdit()"
    >
      <template #info="{ entity, editing }">
        <AutoLinkSuggestions
          v-if="entity && !editing"
          :entity-id="entity.id"
          :entity-type="entityType"
          :properties="entity.properties"
        />

        <slot name="detail-info" :entity="entity" :editing="editing" :edit-form="editForm">
          <div class="detail-fields">
            <DetailField
              v-for="f in displayFields"
              :key="f.key"
              :label="f.label"
              :value="entity.properties[f.key]"
              :editing="editing"
              :type="((f as any).fieldType ?? (f as any).type)"
              :options="(f as any).options"
              :entity-id="entity.id"
              :cover-position="entity.coverPosition"
              :cover-zoom="entity.coverZoom"
              :auto-link="(f as any).autoLink"
              @update:value="editForm[f.key] = $event"
              @update:cover-position="(val) => { editForm._coverPosition = val; entityStore.update(entity.id, { coverPosition: val }) }"
              @update:cover-zoom="(val) => { editForm._coverZoom = val; entityStore.update(entity.id, { coverZoom: val }) }"
              @commit="onSaveEdit"
            />
          </div>
          <DetailField
            label="描述"
            :value="entity.description"
            :editing="editing"
            type="textarea"
            @update:value="editForm._description = $event"
            @commit="onSaveEdit"
          />
          <DynamicFieldsAdder
            :entity-type="entityType"
            v-model="editForm"
            :field-defs="customFieldDefs"
            @update:field-defs="customFieldDefs = $event"
          />
          <div class="detail-actions" v-if="editing">
            <button class="btn-danger btn-sm" @click="deleteEntity">删除</button>
          </div>
          <div class="detail-edit-bar" v-if="editing">
            <button class="btn-primary btn-sm" @click="onSaveEdit">保存</button>
          </div>
        </slot>
      </template>

      <template v-for="rt in relationTabs" :key="rt.id" #[rt.id]="{ entity }">
        <slot :name="`detail-${rt.id}`" :entity="entity">
          <div v-for="r in getRelations(entity.id, rt.relationType)" :key="r.id" class="dp-rel-item">
            <span class="dp-rel-icon"><WsIcon :name="rt.targetIcon || 'link'" size="xs" /></span>
            <span class="dp-rel-name">{{ getEntityName(r.targetId) }}</span>
            <span v-if="rt.showProperty && r.properties[rt.showProperty]" class="dp-rel-meta">{{ r.properties[rt.showProperty] }}</span>
          </div>
          <WsEmpty v-if="getRelations(entity.id, rt.relationType).length === 0" preset="no-data" :title="`暂无${rt.label}`" />
          <EntityRelationSelector v-if="entity" :entity-id="entity.id" :relation-type="rt.relationType" />
        </slot>
      </template>

      <template #relations="{ entity }">
        <slot name="detail-relations" :entity="entity">
          <UniversalRelationPanel
            v-if="entity"
            :entity-id="entity.id"
            :entity-type="entityType"
            :storage-scope="entityType"
          />
        </slot>
      </template>
    </EntityDetailPanel>

    <EntityFormModal
      v-model="showForm"
      :title="editingEntity ? `编辑${label}` : `新建${label}`"
      :entity="editingEntity"
      :fields="fields"
      :entity-type="entityType"
      @save="onFormSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue'
import { NAlert } from 'naive-ui'
import { WsIcon, WsEmpty } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import {
  useEntityEdit,
  useBatchDelete,
  useDuplicateNameCheck,
  useShortcuts,
  useConfirm,
} from '../composables'
import { toastSuccess, toastWithUndo } from '@worldsmith/ui-kit'
import type { FormFieldDef } from './types'
import EntityDetailPanel from './EntityDetailPanel.vue'
import type { DetailTab } from './EntityDetailPanel.vue'
import DetailField from './DetailField.vue'
import CustomDropdown from './CustomDropdown.vue'
import DynamicFieldsAdder from './DynamicFieldsAdder.vue'
import UniversalRelationPanel from './UniversalRelationPanel.vue'
import EntityRelationSelector from './EntityRelationSelector.vue'
import EntityFormModal from './EntityFormModal.vue'
import CreateButton from './CreateButton.vue'
import EntityCardCover from './EntityCardCover.vue'
import EntityCardBack from './EntityCardBack.vue'
import AutoLinkSuggestions from './AutoLinkSuggestions.vue'

export interface FilterDef {
  key: string
  label: string
  options?: { value: string; label: string }[]
  dynamic?: boolean
}

export interface RelationTabDef {
  id: string
  label: string
  icon?: string
  relationType: string
  targetLabel: string
  targetIcon?: string
  showProperty?: string
}

export interface CardFieldDef {
  key: string
  label?: string
  type?: 'text' | 'tag' | 'icon' | 'badge'
  classMap?: Record<string, string>
}

interface DetailTabDef {
  id: string
  label: string
  icon?: string
}

const props = withDefaults(defineProps<{
  entityType: string
  label: string
  idPrefix: string
  icon?: string
  fields: FormFieldDef[]
  filterDefs?: FilterDef[]
  cardSubtitle?: string
  cardFooterFields?: CardFieldDef[]
  detailTabs?: (DetailTabDef | RelationTabDef)[]
  customDetailSlots?: boolean
  additionalFilter?: (entity: any) => boolean
}>(), {
  icon: '',
  filterDefs: () => [],
  cardSubtitle: '',
  cardFooterFields: () => [],
  detailTabs: () => [],
  customDetailSlots: false,
})

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()
const { register, unregister } = useShortcuts()

const searchQuery = ref('')
const loading = ref(false)
const selectedItem = ref<Entity | null>(null)
const showForm = ref(false)
const editingEntity = ref<Entity | null>(null)
const flippedIds = ref(new Set<string>())

function toggleFlip(id: string) {
  if (flippedIds.value.has(id)) {
    flippedIds.value.delete(id)
  } else {
    flippedIds.value.add(id)
  }
}

const filters = reactive<Record<string, string>>(
  Object.fromEntries((props.filterDefs || []).map(fd => [fd.key, '']))
)

const { isEditing, editForm, customFieldDefs, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedItem)

const { selectedIds, toggleSelect, clearSelection, batchDelete } = useBatchDelete()

const schema = computed(() => entitySchemaRegistry.get(props.entityType))

const hasImageField = computed(() => {
  const allFields = schema.value?.fields || props.fields
  return allFields.some((f: any) => f.type === 'image')
})

const coverFieldKey = computed(() => {
  const allFields = schema.value?.fields || props.fields
  const imgField = allFields.find((f: any) => f.type === 'image')
  return imgField?.key || 'coverImage'
})

const displayFields = computed(() => {
  const schemaFields = schema.value?.fields || []
  if (schemaFields.length > 0) return schemaFields
  return props.fields.filter(f => f.key !== 'name' && f.key !== 'description' && f.key !== 'tags')
})

const allItems = computed(() =>
  (entityStore.entities ?? [])
    .filter(e => e.type === props.entityType)
    .filter(e => props.additionalFilter ? props.additionalFilter(e) : true)
)

const filteredItems = computed(() => {
  let list = allItems.value
  const q = searchQuery.value.toLowerCase()
  if (q) {
    list = list.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q)
    )
  }
  for (const fd of props.filterDefs || []) {
    const val = filters[fd.key]
    if (val) {
      list = list.filter(item => item.properties[fd.key] === val)
    }
  }
  return list
})

function dynamicFilterOptions(key: string, label: string): { value: string; label: string }[] {
  const values = new Set<string>()
  for (const item of allItems.value) {
    const v = item.properties[key] as string
    if (v) values.add(v)
  }
  return [
    { value: '', label: `全部${label}` },
    ...Array.from(values).sort().map(v => ({ value: v, label: v })),
  ]
}

const relationTabs = computed<RelationTabDef[]>(() =>
  (props.detailTabs || []).filter((t): t is RelationTabDef => 'relationType' in t)
)

const resolvedTabs = computed<DetailTab[]>(() => {
  const tabs: DetailTab[] = [
    { id: 'info', icon: 'outline', label: '信息' },
  ]
  for (const t of props.detailTabs || []) {
    tabs.push({ id: t.id, icon: t.icon, label: t.label })
  }
  tabs.push({ id: 'relations', icon: 'link', label: '关联' })
  return tabs
})

const detailIcon = computed(() => props.icon || entitySchemaRegistry.getIconName(props.entityType))

const detailSubtitle = computed(() => {
  if (!selectedItem.value) return ''
  if (props.cardSubtitle && selectedItem.value.properties[props.cardSubtitle]) {
    return String(selectedItem.value.properties[props.cardSubtitle])
  }
  return ''
})

function cardIcon(item: Entity): string {
  return props.icon || entitySchemaRegistry.getIconName(item.type)
}

function selectItem(item: Entity) {
  selectedItem.value = item
}

function openNewForm() {
  editingEntity.value = null
  showForm.value = true
}

async function onFormSave(data: { name: string; description: string; properties: Record<string, any>; tags: string[]; _autoLinkFields?: any[]; _coverPosition?: string; _coverZoom?: number }) {
  const now = new Date().toISOString()
  let savedEntityId: string | undefined

  if (editingEntity.value?.id) {
    savedEntityId = editingEntity.value.id
    const updateData: Record<string, unknown> = {
      name: data.name,
      description: data.description,
      properties: data.properties,
      tags: data.tags,
    }
    if (data._coverPosition) updateData.coverPosition = data._coverPosition
    if (data._coverZoom) updateData.coverZoom = data._coverZoom
    await entityStore.update(editingEntity.value.id, updateData)
  } else {
    const checkedName = await checkAndConfirmName(data.name, undefined, props.entityType)
    if (!checkedName) return
    const id = `${props.idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await entityStore.add({
      id,
      type: props.entityType,
      name: checkedName,
      description: data.description,
      properties: data.properties,
      tags: data.tags,
      createdAt: now,
      updatedAt: now,
    } as Entity)
    savedEntityId = id
    toastSuccess('已创建')
  }

  if (savedEntityId && data._autoLinkFields?.length) {
    try {
      const { useSmartFieldLink } = await import('@worldsmith/entity-core/composables')
      const { processAutoLinks } = useSmartFieldLink()
      const result = await processAutoLinks(savedEntityId, data.properties, data._autoLinkFields)
      if (result.linked > 0 || result.created > 0) {
        const parts: string[] = []
        if (result.linked > 0) parts.push(`自动关联 ${result.linked} 条关系`)
        if (result.created > 0) parts.push(`自动创建 ${result.created} 个实体`)
        toastSuccess(parts.join('，'))
        for (const reminder of result.reminders) {
          setTimeout(() => toastSuccess(reminder), 500)
        }
      }
    } catch (err) {
      console.warn('[SimpleEntityView] autoLink failed:', err)
    }
  }

  showForm.value = false
  editingEntity.value = null
  await entityStore.loadAll()

  // 触发 AutoLink 索引（新架构）
  if (savedEntityId) {
    try {
      const { indexPotentialLinks } = await import('@worldsmith/entity-core')
      const savedEntity = entityStore.entities.find(e => e.id === savedEntityId)
      if (savedEntity) {
        await indexPotentialLinks(savedEntityId, savedEntity.type, savedEntity.properties ?? {})
      }
    } catch { /* AutoLink 索引失败不影响主流程 */ }
  }
}

async function onSaveEdit() {
  await saveEdit(undefined, async () => {
    await entityStore.loadByType(props.entityType)
  })
}

async function onBatchDel() {
  const ok = await batchDelete(filteredItems.value, props.label)
  if (ok) await entityStore.loadAll()
}

async function deleteEntity() {
  if (!selectedItem.value) return
  const entity = entityStore.entityMap.get(selectedItem.value.id)
  const relCount = relationStore.relations.filter(
    r => r.sourceId === selectedItem.value!.id || r.targetId === selectedItem.value!.id
  ).length
  const msg = relCount > 0
    ? `将删除「${entity?.name}」及其 ${relCount} 条关联关系，此操作不可完全撤销。`
    : `将删除「${entity?.name}」，此操作不可完全撤销。`
  if (!(await confirm({ type: 'danger', title: '确认删除', description: msg }))) return
  const entityData = { ...entity } as Entity
  await entityStore.remove(selectedItem.value.id)
  selectedItem.value = null
  await entityStore.loadByType(props.entityType)
  toastWithUndo(`已删除「${entityData.name}」`, async () => {
    await entityStore.add(entityData)
    await entityStore.loadByType(props.entityType)
    toastSuccess('已撤销删除')
  })
}

function getRelations(entityId: string, relationType: string) {
  if (!selectedItem.value) return []
  return relationStore.relations.filter(
    r => r.type === relationType && (r.sourceId === entityId || r.targetId === entityId)
  )
}

function getEntityName(entityId: string): string {
  return entityStore.entityMap.get(entityId)?.name || entityId
}

onMounted(async () => {
  try {
    loading.value = true
    await entityStore.loadByType(props.entityType)
    await relationStore.loadAll()
    loading.value = false
  } catch (err) {
    console.warn(`[SimpleEntityView:${props.entityType}]`, err)
  }

  register({
    id: `${props.entityType}.delete`,
    keys: ['delete'],
    scope: 'view',
    description: `删除选中${props.label}`,
    handler: () => { if (selectedIds.value.size) onBatchDel() },
  })
  register({
    id: `${props.entityType}.new`,
    keys: ['n'],
    scope: 'view',
    description: `新建${props.label}`,
    handler: openNewForm,
  })
  register({
    id: `${props.entityType}.close`,
    keys: ['escape'],
    scope: 'view',
    description: '关闭详情',
    handler: () => { selectedItem.value = null },
  })
})

onBeforeUnmount(() => {
  unregister(`${props.entityType}.delete`)
  unregister(`${props.entityType}.new`)
  unregister(`${props.entityType}.close`)
})
</script>

<style scoped>
.simple-entity-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.search-input {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--input-bg);
  color: var(--text-color);
  min-width: 180px;
  outline: none;
  transition: border-color 0.15s;
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.large-list-warning {
  margin-bottom: 12px;
}

.entity-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  overflow-y: auto;
  align-content: start;
  place-items: center;
  padding-top: 12px;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: auto;
}

.card-tag {
  font-size: var(--font-size-xs);
  padding: 1px 6px;
  background: var(--hover-bg);
  border-radius: 4px;
  color: var(--text-secondary);
}

.detail-fields {
  margin-bottom: 8px;
}

.detail-actions {
  margin-top: 8px;
}

.detail-edit-bar {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.dp-rel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--border-color);
}

.dp-rel-icon {
  font-size: var(--font-size-lg);
}

.dp-rel-name {
  color: var(--text-secondary);
}

.dp-rel-meta {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  margin-left: auto;
}
</style>
