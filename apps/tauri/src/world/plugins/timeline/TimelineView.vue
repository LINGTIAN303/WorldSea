<template>
  <div ref="viewRoot" class="timeline-view" :class="{ 'timeline-view--split': splitCarrierOpen, 'timeline-view--immersive': immersiveOpen }">
    <!-- 工具栏上移 R3 统一工具条（搜索→标题旁，筛选→收束条，动作→动作区，新建→新建区），套用 BuildingSectionView 模式 -->
    <Teleport to="#view-toolbar-search">
      <input v-model="searchQuery" placeholder="搜索事件..." class="search-input" />
    </Teleport>
    <Teleport to="#view-toolbar-filter-body">
      <CustomDropdown v-model="unitFilter" :options="unitFilterOptions" />
      <CustomDropdown v-if="periods.length > 0" v-model="periodFilter" :options="periodFilterOptions" />
      <CustomDropdown v-model="importanceFilter" :options="importanceFilterOptions" />
      <CustomDropdown v-model="groupMode" :options="groupModeOptions" />
      <TimelineFilterFeedback :shown="filteredEvents.length" :hidden="hiddenCount" :active="!!(searchQuery || unitFilter || periodFilter || importanceFilter)" @clear="clearFilters" />
    </Teleport>
    <Teleport to="#view-toolbar-actions">
      <TuiButton v-if="layoutMode === 'vertical'" variant="secondary" size="sm" :active="sortMode === 'tree'" :icon="sortMode === 'chrono' ? 'timeline' : 'plant'" @click="toggleSortMode" :title="sortMode === 'chrono' ? '切换为大纲视图' : '切换为时间排序'">{{ sortMode === 'chrono' ? '时间序' : '大纲序' }}</TuiButton>
      <TuiButton variant="secondary" size="sm" :active="layoutMode === 'horizontal'" :icon="layoutMode === 'vertical' ? 'timeline' : 'graph'" @click="toggleLayoutMode" :title="layoutMode === 'vertical' ? '切换为水平时间线' : '切换为垂直时间线'">{{ layoutMode === 'vertical' ? '垂直' : '水平' }}</TuiButton>
      <TuiButton v-if="layoutMode === 'horizontal'" variant="secondary" size="sm" title="放大（Ctrl + 滚轮）" @click="chartRef?.zoomIn()">+</TuiButton>
      <TuiButton v-if="layoutMode === 'horizontal'" variant="secondary" size="sm" title="缩小（Ctrl + 滚轮）" @click="chartRef?.zoomOut()">−</TuiButton>
      <TuiButton v-if="layoutMode === 'horizontal'" variant="secondary" size="sm" icon="expand" title="适配全部事件" @click="chartRef?.fitAll()">适配</TuiButton>
      <TuiButton v-if="sortMode === 'tree'" variant="secondary" size="sm" icon="expand" title="全部展开" @click="tree.expandAll()">展开</TuiButton>
      <TuiButton v-if="sortMode === 'tree'" variant="secondary" size="sm" icon="collapse" title="全部折叠" @click="tree.collapseAll()">折叠</TuiButton>
      <TuiButton v-if="layoutMode === 'vertical'" variant="secondary" size="sm" :active="compactMode" icon="list" title="紧凑模式" @click="compactMode = !compactMode">{{ compactMode ? '紧凑' : '展开' }}</TuiButton>
      <TuiButton variant="secondary" size="sm" icon="calendar" :title="`当前历法：${activeCalendar.name}`" @click="showCalendarPanel = true">{{ activeCalendar.name }}</TuiButton>
      <TuiButton variant="secondary" size="sm" icon="warning" :title="hasConflicts ? `${conflicts.length} 个冲突` : '检测时间冲突'" @click="showConflicts = true">冲突{{ hasConflicts ? ` (${conflicts.length})` : '' }}</TuiButton>
      <!-- 分页只在「竖向 + 时序表」出现：横向画布吃全量时间跨度、大纲树分页会丢页外子节点 -->
      <EntityPager v-if="pageable && totalPages > 1" :page="page" :total="totalPages" @prev="pagePrev" @next="pageNext" />
      <TuiButton variant="secondary" size="sm" :active="selecting" :title="selecting ? '退出批量选择（Esc）' : '进入批量选择'" @click="toggleSelectMode">批量选择</TuiButton>
      <TuiButton v-if="selectedIds.size > 0" variant="danger-ghost" size="sm" icon="delete" @click="batchDelete(filteredEvents, '事件')">删除 ({{ selectedIds.size }})</TuiButton>
      <TuiButton v-if="selectedIds.size > 0" variant="secondary" size="sm" @click="clearSelection">取消选择</TuiButton>
    </Teleport>
    <Teleport to="#view-toolbar-create">
      <CreateButton label="新建事件" @click="openNewForm()" />
    </Teleport>
    <div v-if="timelineError" class="timeline-error" role="alert">
      <WsEmpty title="时间线载入失败" :description="timelineError">
        <template #action><TuiButton variant="primary" size="sm" @click="retryTimeline">重试</TuiButton></template>
      </WsEmpty>
    </div>

    <TimelineChart
      v-else
      ref="chartRef"
      :events="filteredEvents"
      :canvas-events="canvasEvents"
      :points="points"
      :runtime="runtime"
      :calendar="activeCalendar"
      :calendars="calendars"
      :canvas-groups="canvasGroups"
      :chronicle-groups="chronicleGroups"
      :bands="axisBands"
      :selected-event-id="selectedEvent?.id ?? null"
      :selected-ids="selectedIds"
      :batch-mode="selecting"
      :loading="chartLoading"
      :loaded="eventsLoaded"
      :layout-mode="layoutMode"
      :compact-mode="compactMode"
      :sort-mode="sortMode"
      :tree="tree"
      :drag-enabled="dragEnabled"
      @select-event="selectEvent"
      @toggle-select="toggleSelect"
      @select-events="onSelectEvents"
      @create-event="openNewFormFromCanvas"
    />
    <!-- 事件详情：容器走载体注册表（此前直挂 EntityDetailPanel＝时间线拿不到别的载体），
         内容侧仍复用通用件——私有 EventDetailPanel 早在 2026-09-13 收敛过，令牌/结构与全局一致 -->
    <component
      :is="carrierDef.component"
      ref="carrierRef"
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
        <EventDetailNav v-if="selectedEvent" :index="nav.index" :total="nav.total" :has-prev="nav.hasPrev" :has-next="nav.hasNext" @prev="step(-1)" @next="step(1)" @focus="focusInCanvas(selectedEvent.id)" />
        <AutoLinkSuggestions
          v-if="selectedEvent && !isEditing"
          :entity-id="selectedEvent.id"
          :entity-type="'event'"
          :properties="selectedEvent.properties"
        />
        <EventDetailFields
          :event="selectedEvent"
          :schema-fields="eventSchema?.fields ?? []"
          :editing="isEditing"
          :draft="editForm"
          :calendar="eventCalendar"
          :calendars="calendars"
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
      <template #cover><EntityCoverPanel v-if="selectedEvent" :entity="selectedEvent" /></template>
      <template #causal>
        <CausalGraph
          :event="selectedEvent"
          :events="eventList"
          :relations="relationStore.relations"
          @navigate-to-event="navigateToEvent"
        />
        <EntityRelationSelector v-if="selectedEvent" :entity-id="selectedEvent.id" entity-type="event" relation-type="causes" />
      </template>
      <!-- 关联页（2026-10-08 修复）：原内嵌 info 页（#default + inline-visible 门控），批 A 组装恒尾「关联」页后缺槽空白——迁移为具名槽，与 GEV 同口径 -->
      <template #relations>
        <UniversalRelationPanel v-if="selectedEvent?.id" :entity-id="selectedEvent.id" entity-type="event" storage-scope="event" />
      </template>
    </component>
    <ConflictDetector
      :show="showConflicts"
      :conflicts="conflicts"
      :stats="scanStats"
      @close="showConflicts = false"
      @focus="focusConflict"
    />

    <TimelineEventForm
      ref="formModalRef"
      v-model="showForm"
      :title="editingEvent ? '编辑事件' : '新建事件'"
      :entity="editingEvent"
      :entity-type="'event'"
      :calendars="calendars"
      :active-calendar-id="activeCalendarId"
      :preset="formPreset"
      @save="onFormSave"
    />

    <CalendarEditorPanel
      :show="showCalendarPanel"
      :calendars="calendars"
      :active-id="activeCalendarId"
      :migrating="migrating"
      @close="showCalendarPanel = false"
      @save="onCalendarSave"
      @remove="onCalendarRemove"
      @activate="onCalendarActivate"
      @migrate="migrateDates"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useEntityStore, useRelationStore, useUIStore, useDetailLayoutStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { AutoLinkSuggestions, CustomDropdown, EntityCoverPanel, CreateButton, DynamicFieldsAdder, UniversalRelationPanel, EntityRelationSelector, EntityPager, useDuplicateNameCheck, useSelectedFollow, useBatchDelete, useConfirm, useEntityEdit, useEntityPaging, useDetailCarrier, resolveDetailTabs, adjacentTabId } from '@worldsea/plugin-sdk'
import { toastSuccess, toastWithUndo, useUndoRedo, useAsyncTask } from '@worldsea/ui-kit'
import { useSettingsStore } from '@/stores/settingsStore'
import { TuiButton, WsEmpty } from '@worldsea/ui-kit'
import TimelineChart from './components/TimelineChart.vue'
import ConflictDetector from './components/ConflictDetector.vue'
import CausalGraph from './components/CausalGraph.vue'
import EventDetailFields from './components/EventDetailFields.vue'
import EventDetailNav from './components/EventDetailNav.vue'
import TimelineEventForm from './components/TimelineEventForm.vue'
import TimelineFilterFeedback from './components/TimelineFilterFeedback.vue'
import CalendarEditorPanel from './calendar/components/CalendarEditorPanel.vue'
import { useTimelineCalendarActions } from './calendar/useTimelineCalendarActions'
import { useEventTree } from './composables/useEventTree'
import { useTimelineEventForm } from './composables/useTimelineEventForm'
import { useTimelineSort } from './composables/useTimelineSort'
import { useConflictDetection } from './composables/useConflictDetection'
import { useTimelineFilters } from './composables/useTimelineFilters'
import { useTimelineNeighbors } from './composables/useTimelineNeighbors'
import { useTimelinePoints } from './composables/useTimelinePoints'
import { useTimelineGroups } from './composables/useTimelineGroups'
import { useTimelineKeyboard } from './composables/useTimelineKeyboard'
import { DETAIL_TAB_DECLARATIONS } from '../../detailTabDeclarations'
import { entitySchemaRegistry } from '@worldsea/entity-core'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const uiStore = useUIStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()
const { undo, redo } = useUndoRedo()
const settingsStore = useSettingsStore()
const { selectedIds, selecting, toggleSelect, clearSelection, toggleSelectMode, batchDelete } = useBatchDelete()
const { visible: chartLoading, error: timelineError, run: runTimelineLoad } = useAsyncTask({ successHold: 0 })
const eventsLoaded = ref(false)
const showForm = ref(false)
const showConflicts = ref(false)
const selectedEvent = ref<Entity | null>(null)
// 载体走与 GEV 同一套解析（用户按类型覆写 > 缺省抽屉）；时间线没有芽声明这一层
const { carrierDef, detailPanelId, isSplit, isImmersive } = useDetailCarrier(() => 'event')
const splitCarrierOpen = computed(() => isSplit.value && !!selectedEvent.value)
const immersiveOpen = computed(() => isImmersive.value && !!selectedEvent.value)
const editingEvent = ref<Entity | null>(null)
const formModalRef = ref<{ syncEntityRefAfterCreate: (id: string) => Promise<void> | void } | null>(null)

// 选中事件跟随 store（updateById 按引用替换后，详情面板不能挂旧对象——封面 Tab 同口径）
useSelectedFollow(selectedEvent, () => entityStore.entityMap)

const layoutMode = ref<'horizontal' | 'vertical'>(
  (settingsStore as any).timelineDefaultMode === 'horizontal' ? 'horizontal' : 'vertical'
)
const compactMode = ref((settingsStore as any).timelineCompactMode === true)
const dragEnabled = computed(() => (settingsStore as any).timelineDragEnabled === true)
const viewRoot = ref<HTMLElement>()
const formPreset = ref<Record<string, unknown> | null>(null)

const eventList = computed(() => entityStore.entities.filter(e => e.type === 'event'))

const calendarApi = useTimelineCalendarActions({ events: () => eventList.value, entityStore, loadTimeline, confirm: confirm as any })
const { calendars, active: activeCalendar, activeId: activeCalendarId, showPanel: showCalendarPanel, migrating, load: loadCalendars, saveCalendar: onCalendarSave, removeCalendar: onCalendarRemove, activateCalendar: onCalendarActivate, migrateDates, byId: calendarById } = calendarApi
const eventCalendar = computed(() => calendarById(selectedEvent.value?.properties.calendarId as string | undefined))
const { openNewForm, onFormSave } = useTimelineEventForm({ showForm, editingEvent, activeCalendar, preset: formPreset, entityStore, formModalRef, checkAndConfirmName })

const tree = useEventTree(eventList)
const { flatOrder, expandTo } = tree

/* ── 时间数据层：按事件所属历法解析 → 标量区间 / 期段色带 ── */
const { points, runtime, periods, axisBands } = useTimelinePoints({ events: eventList, calendars, activeCalendar })
const { sortMode, sortedEvents, toggleSortMode } = useTimelineSort(eventList, flatOrder, points)
const { conflicts, hasConflicts, scanStats } = useConflictDetection(
  computed(() => relationStore.relations), computed(() => entityStore.entityMap), points, runtime)
const chartRef = ref<{ zoomIn: () => void; zoomOut: () => void; fitAll: () => void; focusEvent: (id: string) => void } | null>(null)
const {
  searchQuery, unitFilter, periodFilter, importanceFilter, groupMode, groupModeOptions,
  unitFilterOptions, periodFilterOptions, importanceFilterOptions, filteredEvents, hiddenCount, clearFilters,
} = useTimelineFilters(
  sortedEvents,
  { points, periods, calendar: activeCalendar, layoutMode },
  (settingsStore as any).timelineDefaultGroup ?? 'none',
)
const { nav, step } = useTimelineNeighbors(selectedEvent, filteredEvents, selectEvent)

/* ── 分页（2026-10-01，与 GEV 同一口径：只切「渲染哪一段」，filteredEvents 仍全量——
 * 冲突检测、批量删除取名、跨页选中都吃全量，不随翻页变化）── */
const { page, totalPages, pagedList: pagedEvents, pagePrev, pageNext, resetPage } = useEntityPaging(filteredEvents, 100)
/** 可分页形态 = 竖向 + 时序表（横向画布吃全量时间跨度；大纲树分页会丢页外子节点） */
const pageable = computed(() => layoutMode.value === 'vertical' && sortMode.value === 'chrono')
// 离开可分页形态即回第 1 页：否则切回来时停在上次那页，像是「事件少了」
watch(pageable, on => { if (!on) resetPage() })
watch([searchQuery, unitFilter, periodFilter, importanceFilter], resetPage)

/* ── 两态分组派生（画布剔除其他历法事件；编年史保留尾组）── */
const verticalEvents = computed(() => pageable.value ? pagedEvents.value : filteredEvents.value)
const { canvasEvents, chronicleGroups, canvasGroups } = useTimelineGroups({
  verticalEvents, filteredEvents, points, calendar: activeCalendar, runtime, periods,
  relations: computed(() => relationStore.relations), groupMode,
  entityMap: computed(() => entityStore.entityMap),
})

function involvedEntities(eventId: string): Entity[] {
  const rels = relationStore.relations.filter(r => r.type === 'involves' && r.sourceId === eventId)
  return rels.map(r => entityStore.entityMap.get(r.targetId)).filter(Boolean) as Entity[]
}

function toggleLayoutMode() {
  layoutMode.value = layoutMode.value === 'horizontal' ? 'vertical' : 'horizontal'
}

/** 跳转聚焦：画布平移事件到视口中心；大纲树展开祖先 */
function focusEventInView(id: string): void {
  if (layoutMode.value === 'horizontal') chartRef.value?.focusEvent(id)
  else expandTo(id)
}
/** 详情「在画布中查看」：先切横态，等画布挂载后再定位 */
function focusInCanvas(id: string) { layoutMode.value = 'horizontal'; nextTick(() => chartRef.value?.focusEvent(id)) }
function selectEvent(event: Entity) {
  selectedEvent.value = event
  if (sortMode.value === 'tree') expandTo(event.id)
}

/** 跨视图/冲突跳转：按 id 选中并聚焦（类型不符 no-op，与 GEV 的 selectById 同口径） */
function selectEventById(id: string): void {
  const entity = entityStore.entityMap.get(id)
  if (entity?.type === 'event') { selectedEvent.value = entity; focusEventInView(id) }
}
function focusConflict(id: string) { selectEventById(id) }
/** 画布框选：并入当前选中集 */
const onSelectEvents = (ids: string[]) => { selectedIds.value = new Set([...selectedIds.value, ...ids]) }
/** 画布空白拖拽/单击建事件：预填吸附后的起止日期 */
const openNewFormFromCanvas = (preset: { date: string; dateEnd?: string; calendarId: string }) =>
  openNewForm({ ...preset, dateCertainty: 'exact' })
/** 跨视图跳转的即时选中通道（视图已挂载时） */
function onWsSelectEntity(e: Event) {
  selectEventById(((e as CustomEvent).detail?.entityId as string | undefined) ?? '')
}

// ── 事件详情面板（原私有 EventDetailPanel 逻辑收敛到通用 EntityDetailPanel）──
const detailActiveTab = ref('info')
/** 载体实例（ALT+←/→ 程序化切页要经它；契约同 GEV 的 detailPanelRef） */
const carrierRef = ref<{ switchTab: (tabId: string) => void; activeTab?: string } | null>(null)

/** ALT+←/→ 切页（wrap；2026-10-08 Tab 优化批 B） */
function switchTabBy(delta: number): void {
  const next = selectedEvent.value && adjacentTabId(detailTabs.value, detailActiveTab.value, delta)
  if (next) carrierRef.value?.switchTab(next)
}
const customFieldDefs = ref<any[]>([])

useTimelineKeyboard({
  viewRoot, chartRef,
  actions: {
    undo: () => undo(entityStore, relationStore), redo: () => redo(entityStore, relationStore),
    // 详情优先：有详情先关详情，否则退批量态（与 GEV 同规则）
    close: () => { if (selectedEvent.value) selectedEvent.value = null; else if (selecting.value) toggleSelectMode() },
    pagePrev, pageNext, switchTabBy,
  },
})

/** 详情 Tab：组装走 `resolveDetailTabs` 单点（2026-10-08 Tab 优化批；因果链为自绘芽的附加页）；
 *  用户覆写（排序/隐藏）按 'event' 类型生效；「关联」徽标＝选中事件的关系总数（与 GEV 同口径） */
const detailPrefs = useDetailLayoutStore()
const detailTabs = computed(() => {
  const tabs = resolveDetailTabs({ hasCover: true, extras: DETAIL_TAB_DECLARATIONS.event?.extras, override: detailPrefs.tabOverrides['event'] })
  const evId = selectedEvent.value?.id, assoc = tabs.find(t => t.id === 'relations')
  if (assoc && evId) assoc.count = relationStore.relations.filter(r => r.sourceId === evId || r.targetId === evId).length
  return tabs
})

const { isEditing, editForm, startEdit, cancelEdit, saveEdit } = useEntityEdit(selectedEvent)
// 详情行内编辑也补齐历法字段，避免旧事件保存后仍缺 calendarId/dateCertainty
watch(isEditing, on => {
  if (!on) return
  if (!editForm.value.calendarId) editForm.value.calendarId = activeCalendar.value.id
  if (!editForm.value.dateCertainty) editForm.value.dateCertainty = 'exact'
})

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

async function loadTimeline(): Promise<void> {
  try {
    await runTimelineLoad(async () => {
      await entityStore.loadAll()
      await relationStore.loadAll()
      eventsLoaded.value = true
    })
  } catch (err) {
    console.warn('[TimelineView]', err)
  }
}

function retryTimeline(): void {
  void loadTimeline()
}

onMounted(async () => {
  // ws-navigate 跨视图跳转：监听先于数据加载**同步注册**（loadAll 期间到达的事件不能丢）
  window.addEventListener('ws-select-entity', onWsSelectEntity)
  await Promise.all([loadTimeline(), loadCalendars()])

  // 挂起位兜底：数据就绪后读回（跨视图跳转的事件发在本视图挂载前，见 Shell.onWsNavigate）
  selectEventById(uiStore.selectedEntityId ?? '')
})

onBeforeUnmount(() => {
  window.removeEventListener('ws-select-entity', onWsSelectEntity)
})

</script>

<style scoped>
.timeline-error { flex: 1; display: flex; align-items: center; justify-content: center; }

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
