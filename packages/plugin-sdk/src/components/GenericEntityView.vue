<template>
  <div class="gev-root">
    <!-- 工具栏按控件类型分发到 R3 统一工具条各落点（搜索→标题旁，筛选→收束条，动作→动作区，新建→新建区） -->
    <!-- 搜索框 → 标题右侧（#view-toolbar-search） -->
    <Teleport to="#view-toolbar-search">
      <input v-model="searchQuery" class="search-input" :placeholder="`搜索${entityLabel}...`" :aria-label="`搜索${entityLabel}`" />
    </Teleport>

    <!-- 筛选/排序 → 收束控件面板内（#view-toolbar-filter-body） -->
    <Teleport to="#view-toolbar-filter-body">
      <div class="toolbar-filters">
        <CustomDropdown v-if="filterOptions.length > 1" v-model="typeFilter" :options="filterOptions" />
        <CustomDropdown
          v-for="fd in filterDefs"
          :key="fd.key"
          v-model="filters[fd.key]"
          :options="fd.options || dynamicFilterOptions(fd.key, fd.label)"
        />
        <CustomDropdown v-if="sortOptions.length > 0" v-model="sortBy" :options="[{ value: '', label: '默认排序' }, ...sortOptions.map(o => ({ value: o.key, label: o.label }))]" />
        <slot name="toolbar-filter-extra" />
      </div>
    </Teleport>

    <!-- 动作类 → 新建左侧（#view-toolbar-actions） -->
    <Teleport to="#view-toolbar-actions">
      <div class="toolbar-actions">
        <slot name="toolbar-extra" />
        <template v-if="selectedIds.size > 0">
          <button class="btn-danger btn-sm" @click="onBatchDel" title="删除选中" data-ws-tip-keys="Del">删除 ({{ selectedIds.size }})</button>
          <button class="btn-ghost btn-sm" @click="clearSelection">取消选择</button>
        </template>
      </div>
    </Teleport>

    <!-- 新建类 → 更多菜单左侧（#view-toolbar-create） -->
    <Teleport to="#view-toolbar-create">
      <CreateButton v-if="!hideCreateButton" :label="`新建${entityLabel}`" @click="openNewForm" />
      <slot name="toolbar-create-extra" />
    </Teleport>

    <n-alert v-if="filteredList.length > 200" type="warning" :show-icon="true" class="large-list-warning">
      当前显示 {{ filteredList.length }} 项，建议使用筛选器缩小范围以获得最佳体验。
    </n-alert>

    <div class="entity-grid" :class="{ 'is-empty': !hasListSlot && filteredList.length === 0, 'has-custom-list': hasListSlot }">
      <slot name="list" :entities="filteredList" :selected-ids="selectedIds" :toggle-select="toggleSelect" :select="selectEntity">
        <div
          v-for="(e, idx) in filteredList"
          :key="e.id"
          class="entity-card-wrapper"
          :class="{
            'is-flipped': hasImageField && isFlipped(e.id),
            'batch-selected': selectedIds.has(e.id),
            'active': listHighlight.selectedId.value === e.id,
            'dimmed': listHighlight.applyToList(filteredList)[idx]?.dimmed,
            'search-highlight': listHighlight.applyToList(filteredList)[idx]?.searchHit,
          }"
        >
          <div v-if="hasImageField" class="entity-card-flipper">
            <div class="entity-card card-front" role="button" tabindex="0" :aria-label="`打开 ${e.name}`" @click="selectEntity(e)" @keydown.enter.prevent="selectEntity(e)" @keydown.space.prevent="selectEntity(e)">
              <input type="checkbox" class="batch-check" :checked="selectedIds.has(e.id)" @change="toggleSelect(e.id)" @click.stop />
              <EntityCardCover :entity="e" :cover-field-key="coverFieldKey" />
              <div class="card-header">
                <WsIcon class="card-icon" :name="resolvedIconFn(e)" size="sm" />
                <div class="card-body">
                  <h3>{{ e.name }}</h3>
                  <slot name="card-subtitle" :entity="e">
                    <p v-if="cardSubtitle">{{ e.properties[cardSubtitle] }}</p>
                    <p v-else>{{ e.properties[typeFieldKey] || '' }}</p>
                  </slot>
                </div>
                <div v-if="cardFooterFields?.length" class="card-footer">
                  <span
                    v-for="ff in cardFooterFields"
                    :key="ff.key"
                    class="card-tag"
                    :class="ff.classMap?.[String(e.properties[ff.key] || '')]"
                  >
                    {{ e.properties[ff.key] }}
                  </span>
                </div>
              </div>
              <button class="card-flip-btn" @click.stop="toggleFlip(e.id)" title="翻转查看图片">🔄</button>
            </div>
            <div class="entity-card card-back" role="button" tabindex="0" :aria-label="`翻转回 ${e.name} 正面`" @click="toggleFlip(e.id)" @keydown.enter.prevent="toggleFlip(e.id)" @keydown.space.prevent="toggleFlip(e.id)">
              <EntityCardBack :entity="e" :cover-field-key="coverFieldKey" />
              <div class="card-back-info">
                <h3>{{ e.name }}</h3>
                <p v-if="cardSubtitle">{{ e.properties[cardSubtitle] }}</p>
                <p v-else>{{ e.properties[typeFieldKey] || '' }}</p>
              </div>
              <button class="card-flip-btn" @click.stop="toggleFlip(e.id)" title="翻转回正面">🔄</button>
            </div>
          </div>
          <div v-else class="entity-card" role="button" tabindex="0" :aria-label="`打开 ${e.name}`" @click="selectEntity(e)" @keydown.enter.prevent="selectEntity(e)" @keydown.space.prevent="selectEntity(e)">
            <input type="checkbox" class="batch-check" :checked="selectedIds.has(e.id)" @change="toggleSelect(e.id)" @click.stop />
            <div class="card-header">
              <WsIcon class="card-icon" :name="resolvedIconFn(e)" size="sm" />
              <div class="card-body">
                <h3>{{ e.name }}</h3>
                <slot name="card-subtitle" :entity="e">
                  <p v-if="cardSubtitle">{{ e.properties[cardSubtitle] }}</p>
                  <p v-else>{{ e.properties[typeFieldKey] || '' }}</p>
                </slot>
              </div>
              <div v-if="cardFooterFields?.length" class="card-footer">
                <span
                  v-for="ff in cardFooterFields"
                  :key="ff.key"
                  class="card-tag"
                  :class="ff.classMap?.[String(e.properties[ff.key] || '')]"
                >
                  {{ e.properties[ff.key] }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <WsEmpty v-if="filteredList.length === 0" :title="`暂无${entityLabel}`" :description="`点击上方按钮创建第一个${entityLabel}`">
          <template #icon>
            <WsIcon :name="resolvedIconFn({ properties: {} } as any) || 'manuscript'" size="xl" />
          </template>
        </WsEmpty>
      </slot>
    </div>

    <EntityDetailPanel
      ref="detailPanelRef"
      :visible="!!selectedEntity"
      :entity="selectedEntity"
      :icon="selectedEntity ? resolvedIconFn(selectedEntity) : ''"
      :title="selectedEntity?.name || ''"
      :subtitle="String(selectedEntity?.properties[typeFieldKey] ?? entityLabel)"
      :tabs="resolvedTabs"
      :show-edit="true"
      :editing="isEditing"
      :panel-id="`detail-${entityType}`"
      @close="selectedEntity = null"
      @edit="isEditing ? cancelEdit() : startEdit()"
    >
      <template #header="{ entity, editing }">
        <slot name="detail-header" :entity="entity" :editing="editing">
          <WsIcon v-if="selectedEntity ? resolvedIconFn(selectedEntity) : ''" :name="selectedEntity ? resolvedIconFn(selectedEntity) : ''" size="sm" />
          <div class="dp-title-area">
            <h3>{{ selectedEntity?.name || '' }}</h3>
            <span v-if="selectedEntity?.properties[typeFieldKey] || entityLabel" class="dp-subtitle">{{ selectedEntity?.properties[typeFieldKey] || entityLabel }}</span>
          </div>
        </slot>
      </template>
      <template #info="{ entity, editing }">
        <slot name="detail-info" :entity="entity" :editing="editing" :edit-form="editForm">
          <AutoLinkSuggestions
            v-if="entity && !editing"
            :entity-id="entity.id"
            :entity-type="entityType"
            :properties="entity.properties"
          />

          <div class="detail-fields">
            <DetailField
              v-for="f in displayFields"
              :key="f.key"
              :label="f.label"
              :value="entity.properties[f.key]"
              :editing="editing"
              :type="(f.fieldType as any)"
              :options="f.options?.map(o => o.value)"
              :entity-id="entity.id"
              :cover-position="entity.coverPosition"
              :cover-zoom="entity.coverZoom"
              :auto-link="(f as any).autoLink"
              @update:value="editForm[f.key] = $event"
              @update:cover-position="(val) => { editForm._coverPosition = val; entityStore.update(entity.id, { coverPosition: val }) }"
              @update:cover-zoom="(val) => { editForm._coverZoom = val; entityStore.update(entity.id, { coverZoom: val }) }"
              @commit="saveEdit"
            />
          </div>

          <DetailField
            label="描述"
            :value="entity.description"
            :editing="editing"
            type="textarea"
            @update:value="editForm._description = $event"
            @commit="saveEdit"
          />

          <DynamicFieldsAdder
            :entity-type="entityType"
            v-model="editForm"
            :field-defs="customFieldDefs"
            @update:field-defs="customFieldDefs = $event"
          />

          <slot name="detail-extra" :entity="entity" :editing="editing" />

          <div class="detail-actions" v-if="editing">
            <button class="btn-danger btn-sm" @click="deleteEntity">删除</button>
          </div>
          <div class="detail-edit-bar" v-if="editing">
            <button class="btn-primary btn-sm" @click="saveEdit()">保存</button>
          </div>
        </slot>
      </template>

      <template v-for="ct in customTabs" :key="ct.id" #[ct.id]="{ entity }">
        <slot :name="`tab-${ct.id}`" :entity="entity" :editing="isEditing" />
      </template>

      <template v-for="rt in relationTabs" :key="rt.id" #[rt.id]="{ entity }">
        <slot :name="`detail-${rt.id}`" :entity="entity">
          <div v-for="r in getRelations(entity.id, rt.relationType)" :key="r.id" class="dp-rel-item">
            <span class="dp-rel-icon"><WsIcon :name="rt.targetIcon || 'link'" size="xs" /></span>
            <span class="dp-rel-name">{{ getEntityName(r) }}</span>
            <span v-if="rt.showProperty && r.properties[rt.showProperty]" class="dp-rel-meta">{{ r.properties[rt.showProperty] }}</span>
          </div>
          <WsEmpty v-if="getRelations(entity.id, rt.relationType).length === 0" preset="no-data" :title="`暂无${rt.label}`" />
          <EntityRelationSelector v-if="entity" :entity-id="entity.id" :entity-type="entityType" :relation-type="rt.relationType" :reverse-direction="rt.reverseDirection" />
        </slot>
      </template>

      <template #relations="{ entity }">
        <slot name="detail-relations" :entity="entity">
          <UniversalRelationPanel v-if="entity" :entity-id="entity.id" :entity-type="entityType" :storage-scope="entityType" />
        </slot>
      </template>
    </EntityDetailPanel>

    <EntityFormModal
      v-model="showForm"
      :title="editingEntity ? `编辑${entityLabel}` : `新建${entityLabel}`"
      :entity="editingEntity"
      :fields="formFields"
      :entity-type="entityType"
      @save="onFormSave"
    />
  </div>
</template>

<script setup lang="ts">
import { toastSuccess, toastWithUndo } from '@worldsea/ui-kit'
import { useEntityEdit, useBatchDelete, useDuplicateNameCheck, useShortcuts, useConfirm, useHighlight } from '../composables'
import { ref, computed, onMounted, onBeforeUnmount, reactive, useSlots } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { NAlert } from 'naive-ui'
import DetailField from './DetailField.vue'
import CustomDropdown from './CustomDropdown.vue'
import CreateButton from './CreateButton.vue'
import DynamicFieldsAdder from './DynamicFieldsAdder.vue'
import UniversalRelationPanel from './UniversalRelationPanel.vue'
import EntityFormModal from './EntityFormModal.vue'
import EntityDetailPanel from './EntityDetailPanel.vue'
import EntityRelationSelector from './EntityRelationSelector.vue'
import type { FormFieldDef, RelationTabDef, CardFieldDef, CustomTabDef, FilterDef } from './types'
import { WsIcon, WsEmpty } from '@worldsea/ui-kit'
import EntityCardCover from './EntityCardCover.vue'
import EntityCardBack from './EntityCardBack.vue'
import AutoLinkSuggestions from './AutoLinkSuggestions.vue'

const emit = defineEmits<{
  (e: 'select-entity', entity: Entity): void
}>()

const props = withDefaults(defineProps<{
  entityType: string
  formFields: FormFieldDef[]
  iconFn?: (entity: Entity) => string
  filterOptions?: { value: string; label: string }[]
  filterFieldKey?: string
  filterDefs?: FilterDef[]
  additionalFilter?: (entity: Entity) => boolean
  idPrefix?: string
  entityLabel?: string
  detailTabs?: RelationTabDef[]
  customTabs?: CustomTabDef[]
  cardFooterFields?: CardFieldDef[]
  cardSubtitle?: string
  sortOptions?: { key: string; label: string }[]
  hideCreateButton?: boolean
  facetOnCreate?: string
}>(), {
  filterOptions: () => [{ value: '', label: '全部' }],
  filterDefs: () => [],
  idPrefix: '',
  entityLabel: '',
  detailTabs: () => [],
  customTabs: () => [],
  cardFooterFields: () => [],
  cardSubtitle: '',
  sortOptions: () => [],
  hideCreateButton: false,
  facetOnCreate: '',
})

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const slots = useSlots()
const hasListSlot = computed(() => !!slots['list'])
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()
const { register, unregister } = useShortcuts()

const listHighlight = useHighlight({
  getRelations: () => relationStore.relations,
})

const flippedCardIds = ref<string[]>([])
const sortBy = ref('')
const filters = reactive<Record<string, string>>(
  Object.fromEntries((props.filterDefs || []).map(fd => [fd.key, '']))
)

function toggleFlip(entityId: string) {
  const idx = flippedCardIds.value.indexOf(entityId)
  if (idx !== -1) {
    flippedCardIds.value = flippedCardIds.value.filter(id => id !== entityId)
  } else {
    flippedCardIds.value = [...flippedCardIds.value, entityId]
  }
}

function isFlipped(entityId: string): boolean {
  return flippedCardIds.value.includes(entityId)
}

const searchQuery = ref('')
const typeFilter = ref('')
const selectedEntity = ref<Entity | null>(null)
const showForm = ref(false)
const editingEntity = ref<Entity | null>(null)
const detailPanelRef = ref<InstanceType<typeof EntityDetailPanel> | null>(null)

const { isEditing, editForm, customFieldDefs, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedEntity)
const { selectedIds, toggleSelect, clearSelection, batchDelete } = useBatchDelete()

const entityLabel = computed(() => props.entityLabel || props.entityType)
const idPrefix = computed(() => props.idPrefix || `${props.entityType.slice(0, 3)}-`)
const resolvedIconFn = computed(() => props.iconFn || (() => entitySchemaRegistry.getIconName(props.entityType)))

const typeFieldKey = computed(() => {
  const schema = entitySchemaRegistry.get(props.entityType)
  const fields = schema?.fields || []
  return props.filterFieldKey || fields[0]?.key || ''
})

const coverFieldKey = computed(() => {
  const schema = entitySchemaRegistry.get(props.entityType)
  const fields = schema?.fields || []
  const imageField = fields.find((f: any) => f.fieldType === 'image')
  return imageField?.key || 'coverImage'
})

const hasImageField = computed(() => {
  const schema = entitySchemaRegistry.get(props.entityType)
  const fields = schema?.fields || []
  return fields.some((f: any) => f.fieldType === 'image')
})

const displayFields = computed(() => {
  const schema = entitySchemaRegistry.get(props.entityType)
  return (schema?.fields || []).filter((f: any) => f.key !== typeFieldKey.value)
})

const relationTabs = computed(() => props.detailTabs || [])

const resolvedTabs = computed(() => {
  const tabs = [{ id: 'info', label: '信息', icon: 'outline' }]
  for (const ct of props.customTabs || []) {
    tabs.push({ id: ct.id, label: ct.label, icon: ct.icon || '' })
  }
  for (const rt of relationTabs.value) {
    tabs.push({ id: rt.id, label: rt.label, icon: rt.icon || '' })
  }
  tabs.push({ id: 'relations', label: '关联', icon: 'link' })
  return tabs
})

function dynamicFilterOptions(key: string, label: string): { value: string; label: string }[] {
  const values = new Set<string>()
  for (const item of list.value) {
    const v = item.properties[key] as string
    if (v) values.add(v)
  }
  return [
    { value: '', label: `全部${label}` },
    ...Array.from(values).sort().map(v => ({ value: v, label: v })),
  ]
}

function getRelations(entityId: string, relationType: string) {
  return relationStore.relations.filter(r =>
    (r.sourceId === entityId || r.targetId === entityId) && r.type === relationType
  )
}

function getEntityName(rel: any) {
  const otherId = rel.sourceId === selectedEntity.value?.id ? rel.targetId : rel.sourceId
  return entityStore.entityMap.get(otherId)?.name || otherId
}

const list = computed(() => (entityStore.entities ?? []).filter(e => e.type === props.entityType))

const filteredList = computed(() => {
  let l = list.value
  const s = searchQuery.value.toLowerCase()
  if (s) l = l.filter(e => e.name.toLowerCase().includes(s))
  if (typeFilter.value && props.filterFieldKey) {
    l = l.filter(e => e.properties[props.filterFieldKey!] === typeFilter.value)
  }
  for (const fd of props.filterDefs || []) {
    const val = filters[fd.key]
    if (val) {
      l = l.filter(e => e.properties[fd.key] === val)
    }
  }
  if (props.additionalFilter) {
    l = l.filter(props.additionalFilter)
  }
  if (sortBy.value) {
    l = [...l].sort((a, b) => {
      const va = String(a.properties[sortBy.value] || '')
      const vb = String(b.properties[sortBy.value] || '')
      return va.localeCompare(vb, 'zh')
    })
  }
  return l
})

onMounted(async () => {
  try {
    await entityStore.loadAll()
    await relationStore.loadAll()
  } catch (err) {
    console.warn(`[GenericEntityView:${props.entityType}]`, err)
  }

  register({
    id: `${props.entityType}.delete`,
    keys: ['delete'],
    scope: 'view',
    description: `删除选中${entityLabel.value}`,
    handler: () => { if (selectedIds.value.size) onBatchDel() },
  })
  register({
    id: `${props.entityType}.new`,
    keys: ['n'],
    scope: 'view',
    description: `新建${entityLabel.value}`,
    handler: openNewForm,
  })
  register({
    id: `${props.entityType}.close`,
    keys: ['escape'],
    scope: 'view',
    description: '关闭详情',
    handler: () => { selectedEntity.value = null },
  })
})

onBeforeUnmount(() => {
  unregister(`${props.entityType}.delete`)
  unregister(`${props.entityType}.new`)
  unregister(`${props.entityType}.close`)
})

function selectEntity(e: Entity) { selectedEntity.value = e; listHighlight.select(e.id); emit('select-entity', e) }
function openNewForm() { editingEntity.value = null; showForm.value = true }

async function onFormSave(data: { name: string; description: string; properties: Record<string, any>; tags: string[]; _autoLinkFields?: any[]; _coverPosition?: string; _coverZoom?: number }) {
  const now = new Date().toISOString()
  let savedEntityId: string | undefined
  if (editingEntity.value) {
    savedEntityId = editingEntity.value.id
    const updateData: Record<string, unknown> = {
      name: data.name, description: data.description,
      properties: data.properties, tags: data.tags,
    }
    if (data._coverPosition) updateData.coverPosition = data._coverPosition
    if (data._coverZoom) updateData.coverZoom = data._coverZoom
    await entityStore.update(editingEntity.value.id, updateData)
  } else {
    const checkedName = await checkAndConfirmName(data.name, undefined, props.entityType)
    if (!checkedName) return
    const id = `${idPrefix.value}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entityData: Record<string, unknown> = {
      id,
      type: props.entityType,
      name: checkedName,
      description: data.description,
      properties: data.properties,
      tags: data.tags,
      createdAt: now, updatedAt: now,
    }
    if (data._coverPosition) entityData.coverPosition = data._coverPosition
    if (data._coverZoom) entityData.coverZoom = data._coverZoom
    if (props.facetOnCreate) entityData.facets = { [props.facetOnCreate]: {} }
    await entityStore.add(entityData as unknown as Entity)
    savedEntityId = id
    toastSuccess('已创建')
  }

  if (savedEntityId && data._autoLinkFields?.length) {
    const { processAutoLinks } = await import('@worldsea/entity-core/composables').then(m => m.useSmartFieldLink())
    const result = await processAutoLinks(savedEntityId, data.properties, data._autoLinkFields)
    if (result.linked > 0 || result.created > 0) {
      const parts = []
      if (result.linked > 0) parts.push(`自动关联 ${result.linked} 条关系`)
      if (result.created > 0) parts.push(`自动创建 ${result.created} 个实体`)
      toastSuccess(parts.join('，'))
      for (const reminder of result.reminders) {
        setTimeout(() => toastSuccess(reminder), 500)
      }
    }
  }

  showForm.value = false
  editingEntity.value = null
  await entityStore.loadAll()

  // 触发 AutoLink 索引（新架构）
  if (savedEntityId) {
    try {
      const { indexPotentialLinks } = await import('@worldsea/entity-core')
      const savedEntity = entityStore.entities.find(e => e.id === savedEntityId)
      if (savedEntity) {
        await indexPotentialLinks(savedEntityId, savedEntity.type, savedEntity.properties ?? {})
      }
    } catch { /* AutoLink 索引失败不影响主流程 */ }
  }
}

async function onBatchDel() {
  const ok = await batchDelete(filteredList.value, entityLabel.value)
  if (ok) await entityStore.loadAll()
}

async function deleteEntity() {
  if (!selectedEntity.value) return
  const entity = entityStore.entityMap.get(selectedEntity.value.id)
  const relCount = relationStore.relations.filter(
    r => r.sourceId === selectedEntity.value!.id || r.targetId === selectedEntity.value!.id
  ).length
  const msg = relCount > 0
    ? `将删除「${entity?.name}」及其 ${relCount} 条关联关系，此操作不可完全撤销。`
    : `将删除「${entity?.name}」，此操作不可完全撤销。`
  if (!(await confirm({ type: 'danger', title: '确认删除', description: msg }))) return
  const entityData = { ...entity } as Entity
  await entityStore.remove(selectedEntity.value.id)
  selectedEntity.value = null
  await entityStore.loadAll()
  toastWithUndo(`已删除「${entityData.name}」`, async () => {
    await entityStore.add(entityData)
    await entityStore.loadAll()
    toastSuccess('已撤销删除')
  })
}

defineExpose({
  /** Select an entity by id (opens detail panel) */
  selectEntityById(id: string) {
    const entity = entityStore.entityMap.get(id)
    if (entity && entity.type === props.entityType) {
      selectedEntity.value = entity
      listHighlight.select(id)
    }
  },
  /** Open the create form with optional pre-filled defaults */
  openFormWithDefaults(defaults?: Record<string, any>) {
    if (defaults) {
      const now = new Date().toISOString()
      editingEntity.value = {
        id: '',
        type: props.entityType,
        name: '',
        description: '',
        tags: [],
        properties: { ...defaults },
        createdAt: now,
        updatedAt: now,
      } as Entity
    } else {
      editingEntity.value = null
    }
    showForm.value = true
  },
  /** Get the currently selected entity */
  getSelectedEntity() {
    return selectedEntity.value
  },
  /** Switch to a specific tab in the detail panel */
  switchTab(tabId: string) {
    detailPanelRef.value?.switchTab(tabId)
  },
})
</script>

<style scoped>
.gev-root { display: flex; flex-direction: column; height: 100%; padding: 20px; }
/* 筛选条内控件：横向排列（收束在向右伸展的筛选条内，超宽滚轮左右移动） */
.toolbar-filters {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
/* 动作区控件：横向排列（Teleport 到工具条动作落点） */
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 0;
}
.search-input {
  width: 180px;
  height: 28px;
  padding: 0 10px;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  background: var(--bg, var(--color-bg-surface));
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-sm);
  outline: none;
  flex-shrink: 1;
  min-width: 0;
}
.search-input:focus {
  border-color: var(--primary, var(--color-primary));
  box-shadow: 0 0 0 2px var(--color-primary-subtle, var(--accent-soft));
}
.search-input::placeholder { color: var(--text-tertiary, var(--color-text-tertiary)); }
.entity-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  overflow-y: auto;
  align-content: start;
  align-items: stretch;
  padding-top: 12px;
}
/* 空实体状态：整视图空提示垂直+水平居中（仅默认列表，自定义 #list 插槽插件不受影响） */
.entity-grid.is-empty { display: flex !important; align-items: center; justify-content: center; grid-template-columns: unset; }
/* 自定义 #list 插槽：改为 flex 列撑满视图，避免自定义列表内容被困在默认卡片 grid 单列（导致空提示停在左上角） */
.entity-grid.has-custom-list { display: flex; flex-direction: column; grid-template-columns: unset; }
.large-list-warning { margin-bottom: 12px; }

/* ── 实体卡片（双线分隔：每卡自带 1px 边框 + gap 缝隙透出 app 底色）── */
.entity-card-wrapper {
  position: relative;
  display: flex;
  border: 1px solid var(--border, #ececec);
  border-radius: var(--radius-mid, 8px);
  background: var(--bg-surface, #ffffff);
  overflow: hidden;
  transition: border-color var(--dur-fast, 0.15s) var(--ease, ease),
              box-shadow var(--dur-fast, 0.15s) var(--ease, ease);
}
.entity-card-wrapper:hover {
  border-color: var(--border-strong, #d9d9de);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(16, 24, 40, 0.05));
}
/* 打开详情：accent 描边高亮 */
.entity-card-wrapper.active {
  border-color: var(--accent, #4f46e5);
  box-shadow: 0 0 0 1px var(--accent, #4f46e5);
}
/* 批量选择态 */
.entity-card-wrapper.batch-selected {
  border-color: var(--accent, #4f46e5);
  background: var(--accent-soft, #eef2ff);
}
/* 搜索命中高亮 */
.entity-card-wrapper.search-highlight { border-color: var(--warning, #d97706); }
/* 关系高亮过滤时未命中项变暗 */
.entity-card-wrapper.dimmed { opacity: 0.45; }

/* 卡片本体：可点击填充区 */
.entity-card {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  cursor: pointer;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
}
.entity-card:focus-visible {
  box-shadow: 0 0 0 var(--ring-width, 3px) var(--ring-color, rgba(79, 70, 229, 0.35));
}

/* 封面：贴合卡片顶部（负边距抵消卡片内边距） */
.entity-card .card-cover-wrap {
  margin: -12px -12px 10px;
}
.entity-card .card-cover {
  width: 100%;
  height: 110px;
  object-fit: cover;
  display: block;
}

/* 卡片头部：图标 + 名称区 */
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.card-icon {
  color: var(--accent, #4f46e5);
  flex-shrink: 0;
}
.card-body {
  flex: 1;
  min-width: 0;
}
.card-body h3 {
  margin: 0;
  font-size: var(--fs-base, 14px);
  font-weight: 600;
  color: var(--text-primary, #1f2328);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-body p {
  margin: 2px 0 0;
  font-size: var(--fs-xs, 11px);
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 翻转按钮：hover 浮现 */
.card-flip-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs, 11px);
  background: var(--bg-muted, #f4f4f5);
  border: 1px solid var(--border, #ececec);
  border-radius: var(--radius-xs, 4px);
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-fast, 0.15s) var(--ease, ease);
}
.entity-card-wrapper:hover .card-flip-btn { opacity: 1; }

/* 批量选择复选框 */
.batch-check {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent, #4f46e5);
  cursor: pointer;
}

/* 翻转容器（3D 双面） */
.entity-card-flipper {
  position: relative;
  flex: 1;
  display: flex;
  perspective: 1000px;
}
.entity-card-flipper .entity-card {
  backface-visibility: hidden;
  transition: transform var(--dur-base, 0.22s) var(--ease, ease);
}
.entity-card-flipper .card-back {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
  background: var(--bg-surface, #ffffff);
}
.entity-card-wrapper.is-flipped .entity-card-flipper .card-front { transform: rotateY(180deg); }
.entity-card-wrapper.is-flipped .entity-card-flipper .card-back { transform: rotateY(0deg); }

/* 卡片背面信息区 */
.card-back-info { margin-top: auto; }
.card-back-info h3 {
  margin: 0;
  font-size: var(--fs-base, 14px);
  font-weight: 600;
  color: var(--text-primary, #1f2328);
}
.card-back-info p {
  margin: 2px 0 0;
  font-size: var(--fs-xs, 11px);
  color: var(--text-secondary, #6b7280);
}
.card-footer { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.card-tag { font-size: var(--font-size-xs); padding: 1px 6px; background: var(--hover-bg); border-radius: 4px; color: var(--text-secondary); }
.dp-rel-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: var(--font-size-sm); }
.dp-rel-icon { color: var(--text-tertiary); }
.dp-rel-name { color: var(--text); }
.dp-rel-meta { color: var(--text-tertiary); font-size: var(--font-size-xs); margin-left: auto; }
</style>
