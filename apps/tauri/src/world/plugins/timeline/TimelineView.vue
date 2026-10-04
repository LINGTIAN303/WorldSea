<template>
  <div class="timeline-view" :class="{ 'timeline-view--split': splitCarrierOpen, 'timeline-view--immersive': immersiveOpen }">
    <!-- 工具栏上移 R3 统一工具条（搜索→标题旁，筛选→收束条，动作→动作区，新建→新建区），套用 BuildingSectionView 模式 -->
    <Teleport to="#view-toolbar-search">
      <input v-model="searchQuery" placeholder="搜索事件..." class="search-input" />
    </Teleport>
    <Teleport to="#view-toolbar-filter-body">
      <CustomDropdown v-model="eraFilter" :options="eraFilterOptions" />
      <CustomDropdown v-model="importanceFilter" :options="importanceFilterOptions" />
      <CustomDropdown v-model="groupModeValue" :options="groupModeOptions" />
    </Teleport>
    <Teleport to="#view-toolbar-actions">
      <TuiButton variant="secondary" size="sm" :active="sortMode === 'tree'" :icon="sortMode === 'chrono' ? 'timeline' : 'plant'" @click="toggleSortMode" :title="sortMode === 'chrono' ? '切换为大纲视图' : '切换为时间排序'">{{ sortMode === 'chrono' ? '时间序' : '大纲序' }}</TuiButton>
      <TuiButton variant="secondary" size="sm" :active="layoutMode === 'horizontal'" :icon="layoutMode === 'vertical' ? 'timeline' : 'graph'" @click="toggleLayoutMode" :title="layoutMode === 'vertical' ? '切换为水平时间线' : '切换为垂直时间线'">{{ layoutMode === 'vertical' ? '垂直' : '水平' }}</TuiButton>
      <TuiButton v-if="sortMode === 'tree'" variant="secondary" size="sm" icon="expand" title="全部展开" @click="tree.expandAll()">展开</TuiButton>
      <TuiButton v-if="sortMode === 'tree'" variant="secondary" size="sm" icon="collapse" title="全部折叠" @click="tree.collapseAll()">折叠</TuiButton>
      <TuiButton v-if="layoutMode === 'vertical'" variant="secondary" size="sm" :active="compactMode" icon="list" title="紧凑模式" @click="compactMode = !compactMode">{{ compactMode ? '紧凑' : '展开' }}</TuiButton>
      <TuiButton variant="secondary" size="sm" icon="warning" :title="hasConflicts ? `${conflicts.length} 个冲突` : '检测时间冲突'" @click="showConflicts = true">冲突{{ hasConflicts ? ` (${conflicts.length})` : '' }}</TuiButton>
      <!-- 分页只在「竖向 + 时序表」出现：横向画布吃全量时间跨度、大纲树分页会丢页外子节点 -->
      <EntityPager v-if="pageable && totalPages > 1" :page="page" :total="totalPages" @prev="pagePrev" @next="pageNext" />
      <TuiButton variant="secondary" size="sm" :active="selecting" :title="selecting ? '退出批量选择（Esc）' : '进入批量选择'" @click="toggleSelectMode">批量选择</TuiButton>
      <TuiButton v-if="selectedIds.size > 0" variant="danger-ghost" size="sm" icon="delete" @click="batchDelete(filteredEvents, '事件')">删除 ({{ selectedIds.size }})</TuiButton>
      <TuiButton v-if="selectedIds.size > 0" variant="secondary" size="sm" @click="clearSelection">取消选择</TuiButton>
    </Teleport>
    <Teleport to="#view-toolbar-create">
      <CreateButton label="新建事件" @click="openNewForm" />
    </Teleport>

    <TimelineChart
      :events="filteredEvents"
      :paged-events="pagedEvents"
      :parsed-dates="parsedDates"
      :depth-map="depthMap"
      :selected-event-id="selectedEvent?.id ?? null"
      :selected-ids="selectedIds"
      :batch-mode="selecting"
      :loading="loading"
      :eras="detectedEras"
      :layout-mode="layoutMode"
      :compact-mode="compactMode"
      :sort-mode="sortMode"
      :tree="tree"
      :drag="dragState"
      :relations="{ value: computedRelations }"
      :entity-map="{ value: computedEntityMap }"
      :group-mode="groupModeValue"
      @select-event="selectEvent"
      @toggle-select="toggleSelect"
    />

    <!-- 事件详情：容器走载体注册表（此前直挂 EntityDetailPanel＝时间线拿不到别的载体），
         内容侧仍复用通用件——私有 EventDetailPanel 早在 2026-09-13 收敛过，令牌/结构与全局一致 -->
    <component
      :is="carrierDef.component"
      :visible="!!selectedEvent"
      :entity="selectedEvent"
      :icon="importanceIcon"
      :title="selectedEvent?.name || ''"
      :subtitle="eventSubtitle"
      :tabs="detailTabs"
      :show-edit="!!selectedEvent"
      :editing="isEditing"
      :panel-id="detailPanelId"
      entity-type="event"
      @close="selectedEvent = null"
      @edit="isEditing ? cancelEdit() : startEdit()"
      @tab-change="detailActiveTab = $event"
    >
      <template #info>
        <EventDetailFields
          :event="selectedEvent"
          :schema-fields="eventSchema?.fields ?? []"
          :editing="isEditing"
          :draft="editForm"
          @update:field="(k, v) => editForm[k] = v"
        />
        <div v-if="involved.length > 0" class="detail-section">
          <h4>涉及实体</h4>
          <div v-for="e in involved" :key="e.id" class="involved-item">{{ e.name }}</div>
        </div>
        <div class="detail-actions" style="margin-top:16px">
          <TuiButton v-if="isEditing && selectedEvent" variant="danger-ghost" size="sm" @click="deleteEvent(selectedEvent.id)">删除</TuiButton>
        </div>
        <DynamicFieldsAdder entity-type="event" v-model="editForm" :field-defs="customFieldDefs" @update:field-defs="customFieldDefs = $event" />
        <div class="detail-edit-bar" v-if="isEditing">
          <TuiButton variant="primary" size="sm" @click="saveEdit()">保存</TuiButton>
        </div>
      </template>
      <template #causal>
        <CausalGraph
          :event="selectedEvent"
          :events="eventList"
          :relations="relationStore.relations"
          @navigate-to-event="navigateToEvent"
        />
        <EntityRelationSelector v-if="selectedEvent" :entity-id="selectedEvent.id" entity-type="event" relation-type="causes" />
      </template>
      <template #default>
        <UniversalRelationPanel v-if="selectedEvent?.id" :entity-id="selectedEvent.id" entity-type="event" :inline-visible="detailActiveTab === 'info'" storage-scope="event" />
      </template>
    </component>

    <ConflictDetector
      :show="showConflicts"
      :conflicts="conflicts"
      @close="showConflicts = false"
    />

    <EntityFormModal
      ref="formModalRef"
      v-model="showForm"
      :title="editingEvent ? '编辑事件' : '新建事件'"
      :entity="editingEvent"
      :fields="eventFields"
      :entity-type="'event'"
      @save="onFormSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { CustomDropdown, EntityFormModal, CreateButton, DynamicFieldsAdder, UniversalRelationPanel, EntityRelationSelector, EntityPager, useDuplicateNameCheck, useShortcuts, useBatchDelete, useConfirm, useEntityEdit, useEntityPaging, useDetailCarrier, type FormFieldDef } from '@worldsea/plugin-sdk'
import { toastSuccess, toastWithUndo, useUndoRedo } from '@worldsea/ui-kit'
import { useSettingsStore } from '@/stores/settingsStore'
import { TuiButton } from '@worldsea/ui-kit'

import TimelineChart from './components/TimelineChart.vue'
import ConflictDetector from './components/ConflictDetector.vue'
import CausalGraph from './components/CausalGraph.vue'
import EventDetailFields from './components/EventDetailFields.vue'
import { useEventTree } from './composables/useEventTree'
import { useTimelineSort } from './composables/useTimelineSort'
import { useConflictDetection } from './composables/useConflictDetection'
import { detectEras, parseDateRange } from './composables/useDateParser'
import { useTimelineDrag } from './composables/useTimelineDrag'
import { entitySchemaRegistry } from '@worldsea/entity-core'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()
const { register, unregister } = useShortcuts()
const { undo, redo } = useUndoRedo()
const settingsStore = useSettingsStore()
const { selectedIds, selecting, toggleSelect, clearSelection, toggleSelectMode, batchDelete } = useBatchDelete()

const searchQuery = ref('')
const eraFilter = ref('')
const importanceFilter = ref('')
const loading = ref(false)
const showForm = ref(false)
const showConflicts = ref(false)
const selectedEvent = ref<Entity | null>(null)
// 载体走与 GEV 同一套解析（用户按类型覆写 > 缺省抽屉）；时间线没有芽声明这一层
const { carrierDef, detailPanelId, isSplit, isImmersive } = useDetailCarrier(() => 'event')
const splitCarrierOpen = computed(() => isSplit.value && !!selectedEvent.value)
const immersiveOpen = computed(() => isImmersive.value && !!selectedEvent.value)
const editingEvent = ref<Entity | null>(null)
const formModalRef = ref<InstanceType<typeof EntityFormModal> | null>(null)

const layoutMode = ref<'horizontal' | 'vertical'>(
  (settingsStore as any).timelineDefaultMode === 'horizontal' ? 'horizontal' : 'vertical'
)
const compactMode = ref((settingsStore as any).timelineCompactMode === true)
const groupModeValue = ref((settingsStore as any).timelineDefaultGroup ?? 'none')

const eventFields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '事件名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '事件描述' },
  { key: 'date', label: '日期/纪年', type: 'text', placeholder: '如: 第三纪元147年' },
  { key: 'dateEnd', label: '结束日期', type: 'text' },
  { key: 'era', label: '纪元', type: 'text', placeholder: '如: 第三纪元' },
  { key: 'importance', label: '重要程度', type: 'select', options: [
    { value: '关键', label: '关键' }, { value: '重要', label: '重要' },
    { value: '普通', label: '普通' }, { value: '细微', label: '细微' },
  ] },
  { key: 'status', label: '状态', type: 'select', options: [
    { value: '正史', label: '正史' }, { value: '废案', label: '废案' },
    { value: '备选', label: '备选' },
  ] },
  { key: 'location', label: '发生地点', type: 'text' },
  { key: 'tags', label: '标签', type: 'tags' },
  { key: 'parentId', label: '父级事件', type: 'entityRef', refType: 'event', placeholder: '搜索事件...' },
]

const eventList = computed(() => entityStore.entities.filter(e => e.type === 'event'))

const tree = useEventTree(eventList)
const { depthMap, flatOrder, expandTo } = tree
const { sortMode, sortedEvents, parsedDates, toggleSortMode } = useTimelineSort(eventList, flatOrder)
const { conflicts, hasConflicts } = useConflictDetection(
  eventList,
  computed(() => relationStore.relations),
  computed(() => entityStore.entityMap)
)

const drag = useTimelineDrag({
  enabled: computed(() => (settingsStore as any).timelineDragEnabled ?? false),
  entityStore,
  confirm: confirm as any,
  pixelsPerYear: computed(() => 30),
  timeToTimeValue: (pd) => pd.era * 10000 + pd.year,
})

const dragState = { isDragging: drag.isDragging, dragTarget: drag.dragTarget }

const computedRelations = computed(() => relationStore.relations)
const computedEntityMap = computed(() => entityStore.entityMap)

const detectedEras = computed(() => {
  const dates = eventList.value.map(e => {
    const dateText = (e.properties.date as string) || ''
    const dateEndText = (e.properties.dateEnd as string) || ''
    return parseDateRange(dateText, dateEndText)
  })
  return detectEras(dates)
})

const eras = computed(() => {
  const set = new Set<string>()
  for (const e of eventList.value) {
    const era = e.properties.era as string
    if (era) set.add(era)
  }
  return Array.from(set).sort()
})

const eraFilterOptions = computed(() => [
  { value: '', label: '全部纪元' },
  ...eras.value.map(era => ({ value: era, label: era }))
])

const importanceFilterOptions = [
  { value: '', label: '全部重要度' },
  { value: '关键', label: '★ 关键' },
  { value: '重要', label: '★★ 重要' },
  { value: '普通', label: '★★★ 普通' },
  { value: '细微', label: '★★★★ 细微' },
]

const groupModeOptions = [
  { value: 'none', label: '无分组' },
  { value: 'character', label: '按角色' },
  { value: 'location', label: '按地点' },
  { value: 'era', label: '按纪元' },
  { value: 'tag', label: '按标签' },
]

const filteredEvents = computed(() => {
  let list = sortedEvents.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      (e.properties.date as string)?.toLowerCase().includes(q)
    )
  }
  if (eraFilter.value) {
    list = list.filter(e => (e.properties.era as string) === eraFilter.value)
  }
  if (importanceFilter.value) {
    list = list.filter(e => (e.properties.importance as string) === importanceFilter.value)
  }
  return list
})

/* ── 分页（2026-10-01，与 GEV 同一口径：只切「渲染哪一段」，filteredEvents 仍全量——
 * 冲突检测、批量删除取名、跨页选中都吃全量，不随翻页变化）── */
const { page, totalPages, pagedList: pagedEvents, pagePrev, pageNext, resetPage } = useEntityPaging(filteredEvents, 100)
/** 可分页形态 = 竖向 + 时序表（横向画布吃全量时间跨度；大纲树分页会丢页外子节点） */
const pageable = computed(() => layoutMode.value === 'vertical' && sortMode.value === 'chrono')
// 离开可分页形态即回第 1 页：否则切回来时停在上次那页，像是「事件少了」
watch(pageable, on => { if (!on) resetPage() })
watch([searchQuery, eraFilter, importanceFilter], resetPage)

function involvedEntities(eventId: string): Entity[] {
  const rels = relationStore.relations.filter(r => r.type === 'involves' && r.sourceId === eventId)
  return rels.map(r => entityStore.entityMap.get(r.targetId)).filter(Boolean) as Entity[]
}

function openNewForm() { editingEvent.value = null; showForm.value = true }

function toggleLayoutMode() {
  layoutMode.value = layoutMode.value === 'horizontal' ? 'vertical' : 'horizontal'
}

async function onFormSave(data: { name: string; description: string; properties: Record<string, any>; tags: string[]; _coverPosition?: string; _coverZoom?: number }) {
  const now = new Date().toISOString()
  if (editingEvent.value) {
    const updateData: Record<string, unknown> = {
      name: data.name,
      description: data.description,
      properties: data.properties,
      tags: data.tags,
    }
    if (data._coverPosition) updateData.coverPosition = data._coverPosition
    if (data._coverZoom) updateData.coverZoom = data._coverZoom
    await entityStore.update(editingEvent.value.id, updateData)
  } else {
    const checkedName = await checkAndConfirmName(data.name, undefined, 'event')
    if (!checkedName) return
    const entity: Entity = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'event',
      name: checkedName,
      description: data.description,
      properties: data.properties,
      tags: data.tags,
      createdAt: now,
      updatedAt: now,
    }
    await entityStore.add(entity)
    toastSuccess('已创建')
    await formModalRef.value?.syncEntityRefAfterCreate(entity.id)
  }
  showForm.value = false
  editingEvent.value = null
  await entityStore.loadAll()
}

function selectEvent(event: Entity) { selectedEvent.value = event }

// ── 事件详情面板（原私有 EventDetailPanel 逻辑收敛到通用 EntityDetailPanel）──
const detailActiveTab = ref('info')
const customFieldDefs = ref<any[]>([])

const detailTabs = [
  { id: 'info', icon: 'outline', label: '详情' },
  { id: 'causal', icon: 'link', label: '因果链' },
]

const { isEditing, editForm, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedEvent)

const eventSchema = computed(() => entitySchemaRegistry.get('event'))

const involved = computed(() => (selectedEvent.value ? involvedEntities(selectedEvent.value.id) : []))

/** header 图标按重要度：关键=旗标、重要=星标、其余=书签 */
const importanceIcon = computed(() => {
  if (!selectedEvent.value) return 'timeline'
  const imp = selectedEvent.value.properties.importance as string
  return imp === '关键' ? 'flag' : imp === '重要' ? 'star' : 'bookmark'
})

const eventSubtitle = computed(() => {
  if (!selectedEvent.value) return ''
  const d = String(selectedEvent.value.properties.date || '?')
  const end = selectedEvent.value.properties.dateEnd as string | undefined
  return end ? `${d} ~ ${end}` : d
})

function navigateToEvent(id: string) {
  const found = entityStore.entityMap.get(id)
  if (found) {
    selectedEvent.value = found
    expandTo(id)
  }
}

async function deleteEvent(id: string) {
  const entity = entityStore.entityMap.get(id)
  const relCount = relationStore.relations.filter(r => r.sourceId === id || r.targetId === id).length
  const msg = relCount > 0
    ? `将删除「${entity?.name}」及其 ${relCount} 条关联关系，此操作不可完全撤销。`
    : `将删除「${entity?.name}」，此操作不可完全撤销。`
  if (!(await confirm({ type: 'danger', title: '确认删除', description: msg }))) return
  const entityData = { ...entity } as Entity
  await entityStore.remove(id)
  selectedEvent.value = null
  await entityStore.loadAll()
  toastWithUndo(`已删除「${entityData.name}」`, async () => {
    await entityStore.add(entityData)
    await entityStore.loadAll()
    toastSuccess('已撤销删除')
  })
}

onMounted(async () => {
  try {
    loading.value = true
    await entityStore.loadAll()
    await relationStore.loadAll()
    loading.value = false
  } catch (err) {
    console.warn('[TimelineView]', err)
  }

  // 原 id=global.undo/redo 会按 id 覆盖 Shell 的同名全局注册（registry 按 id 去重），
  // 导致 Agent 空间下全局撤销失效；改用视图自有 id，与全局键在 scope 优先级下自然共存
  register({ id: 'timeline.undo', keys: ['ctrl', 'z'], scope: 'view', description: '时间轴：撤销', handler: () => undo(entityStore, relationStore) })
  register({ id: 'timeline.redo', keys: ['ctrl', 'y'], scope: 'view', description: '时间轴：重做', handler: () => redo(entityStore, relationStore) })
  register({
    id: 'timeline.close',
    keys: ['escape'],
    scope: 'view',
    description: '关闭详情 / 退出批量选择',
    // 详情优先：有详情先关详情，否则退批量态（与 GEV 同规则）
    handler: () => {
      if (selectedEvent.value) selectedEvent.value = null
      else if (selecting.value) toggleSelectMode()
    },
  })
  // 分页（Ctrl+←/→，与 GEV 的 `${entityType}.page-*` 同键位、不同 id）
  register({ id: 'timeline.page-prev', keys: ['ctrl', 'left'], scope: 'view', description: '时间轴：上一页', preventDefault: true, handler: pagePrev })
  register({ id: 'timeline.page-next', keys: ['ctrl', 'right'], scope: 'view', description: '时间轴：下一页', preventDefault: true, handler: pageNext })
})

/** 本视图注册的快捷键 id：注册表不随组件销毁清理，不注销会叠下指向陈旧闭包的记录 */
const TIMELINE_SHORTCUT_IDS = ['timeline.undo', 'timeline.redo', 'timeline.close', 'timeline.page-prev', 'timeline.page-next']
onBeforeUnmount(() => { for (const id of TIMELINE_SHORTCUT_IDS) unregister(id) })

</script>

<style scoped>
.timeline-view { position: relative; padding: 20px; height: 100%; display: flex; flex-direction: column; }
/* 沉浸页：详情盖住整块时间线区域（定位父级就是本件根容器） */
.timeline-view--immersive { padding: 0; }
/* 栏式载体：详情与时间线同排分栏。分栏柱靠负 margin 出血到窗口边（本件根容器自带 20px padding） */
.timeline-view--split { flex-direction: row; padding-right: 0; }
.timeline-view--split .timeline-chart { min-width: 0; }
.timeline-view--split :deep(.detail-column) { margin-top: -20px; margin-bottom: -20px; height: auto; }
/* R3 单行适配：上移后控件基线样式（scoped，仅作用于本视图 teleport 内容） */
.search-input {
  padding: 4px 10px; font-size: var(--font-size-sm);
  border: 1px solid var(--border-color, var(--color-border));
  border-radius: var(--radius-sm); background: var(--color-bg-elevated);
  color: var(--text-color, var(--color-text-primary)); outline: none; min-width: 160px;
}
.search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--color-primary-subtle); }
/* ── 事件详情面板内容（自私有 EventDetailPanel 收敛而来）── */
.detail-section { margin: 12px 0; }
.detail-section h4 { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: 6px; border-bottom: 1px solid var(--color-border); padding-bottom: 4px; }
.involved-item { padding: 4px 8px; font-size: var(--font-size-sm); border-radius: var(--radius-sm); }
.involved-item:hover { background: var(--color-bg-hover); }
</style>
