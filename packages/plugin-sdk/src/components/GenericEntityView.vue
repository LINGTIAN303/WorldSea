<template>
  <div class="gev-root" :class="{ 'gev-root--split': splitCarrierOpen }">
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
        <!-- 分页只管 GEV 默认卡片网格；插槽消费方经 paginate-slot 显式开启（其自绘列表里树等形态不能分页） -->
        <EntityPager v-if="totalPages > 1 && (!hasListSlot() || paginateSlot)" :page="page" :total="totalPages" @prev="pagePrev" @next="pageNext" />
        <TuiButton variant="secondary" size="sm" :active="selecting" :title="selecting ? '退出批量选择（Esc）' : '进入批量选择'" @click="toggleSelectMode">批量选择</TuiButton>
        <template v-if="selectedIds.size > 0">
          <TuiButton variant="danger-ghost" size="sm" title="删除选中" data-ws-tip-keys="Del" @click="onBatchDel">删除 ({{ selectedIds.size }})</TuiButton>
          <TuiButton variant="secondary" size="sm" @click="clearSelection">取消选择</TuiButton>
        </template>
      </div>
    </Teleport>

    <!-- 新建类 → 更多菜单左侧（#view-toolbar-create） -->
    <Teleport to="#view-toolbar-create">
      <CreateButton v-if="!hideCreateButton" :label="`新建${entityLabel}`" @click="openNewForm" />
      <slot name="toolbar-create-extra" />
    </Teleport>

    <div class="entity-grid" :class="{ 'is-empty': !hasListSlot() && filteredList.length === 0, 'has-custom-list': hasListSlot() }">
      <slot
        name="list"
        :entities="filteredList"
        :paged-entities="pagedList"
        :selected-ids="selectedIds"
        :toggle-select="toggleSelect"
        :select="selectEntity"
        :batch-mode="selecting"
      >
        <EntityCard
          v-for="(e, idx) in pagedList"
          :key="e.id"
          :entity="e"
          :icon="resolvedIconFn(e)"
          :cover-field-key="coverFieldKey"
          :has-image-field="hasImageField"
          :card-subtitle="cardSubtitle"
          :type-field-key="typeFieldKey"
          :card-footer-fields="cardFooterFields"
          :batch-mode="selecting"
          :batch-selected="selectedIds.has(e.id)"
          :active="listHighlight.selectedId.value === e.id"
          :dimmed="pagedHighlight[idx]?.dimmed"
          :search-highlighted="pagedHighlight[idx]?.searchHit"
          @activate="onCardActivate(e)"
        >
          <template v-if="$slots['card-subtitle']" #subtitle="{ entity: subEntity }">
            <slot name="card-subtitle" :entity="subEntity" />
          </template>
        </EntityCard>
        <WsEmpty v-if="filteredList.length === 0" :title="`暂无${entityLabel}`" :description="`点击上方按钮创建第一个${entityLabel}`">
          <template #icon>
            <WsIcon :name="resolvedIconFn({ properties: {} } as any) || 'manuscript'" size="xl" />
          </template>
        </WsEmpty>
      </slot>
    </div>

    <!-- L1 载体：抽屉/栏式整页…同一套属性与槽，靠注册表换容器（契约见 detail/useDetailChrome） -->
    <component
      :is="carrierDef.component"
      ref="detailPanelRef"
      :visible="!!selectedEntity"
      :entity="selectedEntity"
      :icon="selectedEntity ? resolvedIconFn(selectedEntity) : ''"
      :title="selectedEntity?.name || ''"
      :subtitle="String(selectedEntity?.properties[typeFieldKey] ?? entityLabel)"
      :tabs="resolvedTabs"
      :show-edit="true"
      :editing="isEditing"
      :panel-id="detailPanelId"
      :entity-type="entityType"
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

          <EntityDetailForm
            :entity="entity"
            :fields="detailFieldMetas"
            :layout="detailLayout"
            :editing="editing"
            :draft="editForm"
            :entity-label="entityLabel"
            @update:field="onDraftField"
            @add-field="onAddField"
            @remove-field="onRemoveField"
            @promote-field="onPromoteField"
            @demote-field="onDemoteField"
            @change-form="setContentForm"
            @enter-edit="startEdit"
            @save="saveEdit()"
            @cancel="cancelEdit"
            @delete="deleteEntity"
          >
            <template #extra="{ entity: extraEntity, editing: extraEditing }">
              <slot name="detail-extra" :entity="extraEntity" :editing="extraEditing" />
            </template>
          </EntityDetailForm>
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
    </component>

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
import { toastSuccess, toastWarn, toastWithUndo } from '@worldsea/ui-kit'
import { useEntityEdit, useBatchDelete, useDuplicateNameCheck, useShortcuts, useConfirm, useHighlight, useEntityPaging } from '../composables'
import { ref, computed, onMounted, onBeforeUnmount, reactive, useSlots, watch } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry, fieldRegistry, useDetailLayoutStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import CustomDropdown from './CustomDropdown.vue'
import CreateButton from './CreateButton.vue'
import UniversalRelationPanel from './UniversalRelationPanel.vue'
import EntityFormModal from './EntityFormModal.vue'
import EntityRelationSelector from './EntityRelationSelector.vue'
import type { FormFieldDef, RelationTabDef, CardFieldDef, CustomTabDef, FilterDef } from './types'
import { TuiButton, WsIcon, WsEmpty } from '@worldsea/ui-kit'
import EntityPager from './EntityPager.vue'
import EntityCard from './EntityCard.vue'
import AutoLinkSuggestions from './AutoLinkSuggestions.vue'
import EntityDetailForm from '../detail/EntityDetailForm.vue'
import { activeCarrier, carrierPanelId, resolveCarrier } from '../detail/carriers'
import type { DetailFieldMeta } from '../detail/fieldMeta'
import type { LayoutSource } from '../detail/detailLayout'
import { useDetailLayout } from '../detail/useDetailLayout'
import { draftKeyOf } from '../detail/draftKeys'
import { emptyValueFor } from '../detail/fieldValue'
import { normalizeFieldType } from '../detail/fieldType'
import {
  buildFieldDefsPatch,
  defsAfterDemote,
  defsAfterPromote,
  ENTITY_FIELD_DEFS_KEY,
  isFieldKeyTaken,
  mergeScopedFields,
  readEntityFieldDefs,
  type EntityFieldDef,
  type FieldScope,
} from '../detail/fieldScope'

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
  /** 每页条数（分页；超 1 页时工具条出现翻页控件） */
  pageSize?: number
  /** 插槽消费方也启用分页（工具条分页器 + 槽属性 paged-entities）；默认关，因自绘树等形态不能分页 */
  paginateSlot?: boolean
  /** 芽声明的详情默认（顺序/分组/可见性/内容形态）；用户按类型的覆写与抽屉即时态都在它之上 */
  detailLayout?: LayoutSource
  /** 芽声明的 L1 载体 id（缺省＝右栏抽屉）；用户在设置里设过该类型则以覆写为准 */
  detailCarrier?: string
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
  pageSize: 100,
  paginateSlot: false,
})

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const slots = useSlots()
// hasListSlot 只在渲染期消费（class 绑定 / pager v-if）：context.slots 是非响应式对象
// （父组件重渲染时原地改写），computed 读取它会缓存过期值——条件槽（v-if 模板槽）增删后
// 布局类与分页判定全部失真。改为渲染期求值，随父组件触发的重渲染保持新鲜（2026-10-02）。
const hasListSlot = () => !!slots['list']
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()
const { register, unregister } = useShortcuts()

const listHighlight = useHighlight({
  getRelations: () => relationStore.relations,
})

const sortBy = ref('')
const filters = reactive<Record<string, string>>(
  Object.fromEntries((props.filterDefs || []).map(fd => [fd.key, '']))
)

const searchQuery = ref('')
const typeFilter = ref('')
const selectedEntity = ref<Entity | null>(null)
const showForm = ref(false)
const editingEntity = ref<Entity | null>(null)
const detailPanelRef = ref<{ switchTab: (tabId: string) => void } | null>(null)

const { isEditing, editForm, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedEntity)
const { selectedIds, selecting, toggleSelect, clearSelection, toggleSelectMode, batchDelete } = useBatchDelete()

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

/* ── 详情字段与布局：详情段外移至 EntityDetailForm，字段两级合并（类型级注册表 ⊕ 实体级自带定义）── */
const typeLevelFields = computed<DetailFieldMeta[]>(() => {
  void fieldRegistry.version.value
  return fieldRegistry.getFields(props.entityType).map(f => ({
    key: f.key,
    label: f.label,
    fieldType: f.fieldType,
    options: f.options,
    refType: f.refType,
    source: f.source,
    scope: 'type' as const,
  }))
})

const entityLevelFields = computed<DetailFieldMeta[]>(() =>
  readEntityFieldDefs(selectedEntity.value).map(d => ({
    key: d.key,
    label: d.label,
    fieldType: d.fieldType,
    options: d.options,
    refType: d.refType,
    source: 'user' as const,
    scope: 'entity' as const,
  })),
)

const detailFieldMetas = computed(() => mergeScopedFields(typeLevelFields.value, entityLevelFields.value))

const detailPrefs = useDetailLayoutStore()
/** 载体优先序：用户按类型的覆写 > 芽声明 > 缺省抽屉（解析单点在 `resolveCarrier`，时间线共用） */
const carrierId = computed(() => resolveCarrier(detailPrefs.carriers[props.entityType], props.detailCarrier))
const carrierDef = computed(() => activeCarrier(carrierId.value))
/** 宽度按「载体 + 类型」分别记：同一类型下抽屉与分栏各拖各的，互不覆盖（键规则在 `carrierPanelId`） */
const detailPanelId = computed(() => carrierPanelId(carrierDef.value.carrier, props.entityType))
/** 只有 split 型载体（栏式整页）要把根容器改成分栏；抽屉仍是浮层，布局一点不动 */
const splitCarrierOpen = computed(() => carrierDef.value.mode === 'split' && !!selectedEntity.value)

const { layout: detailLayout, setContentForm } = useDetailLayout(
  () => props.entityType,
  () => detailFieldMetas.value.map(f => f.key),
  () => props.detailLayout,
)

function onDraftField(key: string, value: unknown) {
  editForm.value[draftKeyOf(key)] = value
}

/** 实体级定义随实体走（导出保真、删实体一起消失）；定义即时落库，值仍走草稿 */
function persistEntityDefs(entity: Entity, defs: EntityFieldDef[]) {
  entityStore.update(entity.id, buildFieldDefsPatch(entity, defs))
}

function onAddField(field: { key: string; label: string; fieldType: string; scope: FieldScope }) {
  const entity = selectedEntity.value
  const entityDefs = readEntityFieldDefs(entity)
  if (isFieldKeyTaken(field.key, typeLevelFields.value, entityDefs)) {
    toastWarn(`字段「${field.label}」已存在`)
    return
  }
  if (field.scope === 'type') {
    fieldRegistry.addUserField(props.entityType, { key: field.key, label: field.label, fieldType: field.fieldType })
  } else if (entity) {
    persistEntityDefs(entity, [...entityDefs, { key: field.key, label: field.label, fieldType: field.fieldType }])
  }
  editForm.value[field.key] = emptyValueFor(normalizeFieldType(field.fieldType))
  toastSuccess(field.scope === 'type'
    ? `已为「${entityLabel.value}」全部实体添加字段「${field.label}」`
    : `已为本条${entityLabel.value}添加字段「${field.label}」`)
}

/** 实体级 → 类型级：定义进注册表并从实体摘出，值不动 */
function onPromoteField(key: string) {
  const entity = selectedEntity.value
  const defs = readEntityFieldDefs(entity)
  const def = defs.find(d => d.key === key)
  if (!entity || !def) return
  if (!fieldRegistry.addUserField(entity.type, { key: def.key, label: def.label, fieldType: def.fieldType, options: def.options, refType: def.refType })) {
    toastWarn('该字段已是类型级')
    return
  }
  persistEntityDefs(entity, defsAfterPromote(defs, key))
  toastSuccess(`「${def.label}」已共享给该类型的所有实体`)
}

/** 类型级 → 实体级：从注册表摘出并写进本实体定义，值不动 */
function onDemoteField(key: string) {
  const entity = selectedEntity.value
  const field = typeLevelFields.value.find(f => f.key === key)
  if (!entity || !field) return
  fieldRegistry.removeField(entity.type, key)
  persistEntityDefs(entity, defsAfterDemote(readEntityFieldDefs(entity), {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    options: field.options as { value: string; label: string }[] | undefined,
    refType: field.refType,
  }))
  toastSuccess(`「${field.label}」已改为仅本实体可见`)
}

function onRemoveField(key: string) {
  const entity = selectedEntity.value
  if (!entity) return
  const properties = { ...(entity.properties ?? {}) }
  delete properties[key]
  const defs = readEntityFieldDefs(entity)
  if (defs.some(d => d.key === key)) {
    const next = defsAfterPromote(defs, key)
    if (next.length) properties[ENTITY_FIELD_DEFS_KEY] = next
    else delete properties[ENTITY_FIELD_DEFS_KEY]
  } else {
    fieldRegistry.removeField(entity.type, key)
  }
  entityStore.update(entity.id, { properties })
  delete editForm.value[key]
  toastSuccess(`已移除字段「${key}」`)
}

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

/* ── 分页（2026-10-01，口径见 useEntityPaging：只切渲染段，filteredList 仍全量）── */
const { page, totalPages, pagedList, pagePrev, pageNext, resetPage } = useEntityPaging(filteredList, () => props.pageSize)
/** 高亮/变暗按当前页算（与 v-for 下标一一对应） */
const pagedHighlight = computed(() => listHighlight.applyToList(pagedList.value))

watch(searchQuery, resetPage)

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
    description: '关闭详情 / 退出批量选择',
    // 详情优先：有详情先关详情，否则退批量态（批量态也可空选中，故用 selecting 而非 size 判定）
    handler: () => {
      if (selectedEntity.value) selectedEntity.value = null
      else if (selecting.value) toggleSelectMode()
    },
  })
  // 分页（Ctrl+←/→；view 层，per-entityType id 避免多视图共存时互相覆盖）
  register({
    id: `${props.entityType}.page-prev`,
    keys: ['ctrl', 'left'],
    scope: 'view',
    description: '上一页',
    preventDefault: true,
    handler: pagePrev,
  })
  register({
    id: `${props.entityType}.page-next`,
    keys: ['ctrl', 'right'],
    scope: 'view',
    description: '下一页',
    preventDefault: true,
    handler: pageNext,
  })
})

onBeforeUnmount(() => {
  unregister(`${props.entityType}.delete`)
  unregister(`${props.entityType}.new`)
  unregister(`${props.entityType}.close`)
  unregister(`${props.entityType}.page-prev`)
  unregister(`${props.entityType}.page-next`)
})

function selectEntity(e: Entity) { selectedEntity.value = e; listHighlight.select(e.id); emit('select-entity', e) }
/** 卡片激活：批量态=选中切换；浏览态=打开详情（批量态下不弹详情，见批计划裁定） */
function onCardActivate(e: Entity) { selecting.value ? toggleSelect(e.id) : selectEntity(e) }
function openNewForm() { editingEntity.value = null; showForm.value = true }

async function onFormSave(data: { name: string; description: string; properties: Record<string, any>; tags: string[]; _autoLinkFields?: any[]; _coverPosition?: string; _coverZoom?: number }) {
  const now = new Date().toISOString()
  let savedEntityId: string | undefined
  // 判据是 id 而非「editingEntity 是否非空」：模板预填造的假实体 id 为空串，
  // 早先按非空判定会把它送进更新分支去 update('') —— 表单关掉但实体根本不落地
  const editingId = editingEntity.value?.id
  if (editingId) {
    savedEntityId = editingId
    const updateData: Record<string, unknown> = {
      name: data.name, description: data.description,
      properties: data.properties, tags: data.tags,
    }
    if (data._coverPosition) updateData.coverPosition = data._coverPosition
    if (data._coverZoom) updateData.coverZoom = data._coverZoom
    await entityStore.update(editingId, updateData)
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
/* 栏式整页：详情与列表同排分栏。子件根元素带本组件的 scope 属性，所以 :deep 只是保险 */
.gev-root--split { flex-direction: row; padding-right: 0; }
.gev-root--split .entity-grid { min-width: 0; }
.gev-root--split :deep(.detail-column) { margin-top: -20px; margin-bottom: -20px; height: auto; }
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
  /* 定高容器下 auto 隐式行的自动最小尺寸因卡片 overflow:hidden 归零 → 行被压扁且永不滚动；min-content 让行高回到内容高（详见 docs/details/注释/packages/plugin-sdk/实体视图滚动链.md） */
  grid-auto-rows: min-content;
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
/* 列向 flex 下同因：子项（卡片 overflow:hidden）自动最小尺寸归零会被 flex-shrink 压扁且不滚动；自带 flex:1+overflow 的树/图视图不受影响（基尺寸 0、靠 grow 撑满） */
.entity-grid.has-custom-list > * { flex-shrink: 0; }

.dp-rel-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: var(--font-size-sm); }
.dp-rel-icon { color: var(--text-tertiary); }
.dp-rel-name { color: var(--text); }
.dp-rel-meta { color: var(--text-tertiary); font-size: var(--font-size-xs); margin-left: auto; }
</style>

