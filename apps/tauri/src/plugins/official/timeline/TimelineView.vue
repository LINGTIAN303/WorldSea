<template>
  <div class="timeline-view">
    <!-- 工具栏上移 R3 统一工具条（#view-toolbar-controls），套用 BuildingSectionView 模式 -->
    <Teleport to="#view-toolbar-controls">
      <div class="tl-toolbar">
      <input v-model="searchQuery" placeholder="搜索事件..." class="search-input" />
      <CustomDropdown v-model="eraFilter" :options="eraFilterOptions" />
      <CustomDropdown v-model="importanceFilter" :options="importanceFilterOptions" />
      <button class="btn-ghost btn-sm" :class="{ active: sortMode === 'tree' }" @click="toggleSortMode" :title="sortMode === 'chrono' ? '切换为大纲视图' : '切换为时间排序'">
        <WsIcon :name="sortMode === 'chrono' ? 'timeline' : 'plant'" size="xs" /> {{ sortMode === 'chrono' ? '时间序' : '大纲序' }}
      </button>
      <button class="btn-ghost btn-sm" :class="{ active: layoutMode === 'horizontal' }" @click="toggleLayoutMode" :title="layoutMode === 'vertical' ? '切换为水平时间线' : '切换为垂直时间线'">
        <WsIcon :name="layoutMode === 'vertical' ? 'timeline' : 'graph'" size="xs" /> {{ layoutMode === 'vertical' ? '垂直' : '水平' }}
      </button>
      <CustomDropdown v-model="groupModeValue" :options="groupModeOptions" />
      <button v-if="sortMode === 'tree'" class="btn-ghost btn-sm" @click="tree.expandAll()" title="全部展开"><WsIcon name="expand" size="xs" /> 展开</button>
      <button v-if="sortMode === 'tree'" class="btn-ghost btn-sm" @click="tree.collapseAll()" title="全部折叠"><WsIcon name="collapse" size="xs" /> 折叠</button>
      <button v-if="layoutMode === 'vertical'" class="btn-ghost btn-sm" :class="{ active: compactMode }" @click="compactMode = !compactMode" title="紧凑模式"><WsIcon name="list" size="xs" /> {{ compactMode ? '紧凑' : '展开' }}</button>
      <button class="btn-ghost btn-sm" @click="showConflicts = true" :title="hasConflicts ? `${conflicts.length} 个冲突` : '检测时间冲突'">
        <WsIcon name="warning" size="xs" /> 冲突{{ hasConflicts ? ` (${conflicts.length})` : '' }}
      </button>
      <CreateButton label="新建事件" @click="openNewForm" />
      <button v-if="selectedIds.size > 0" class="btn-danger" @click="batchDelete(filteredEvents, '事件')"><WsIcon name="delete" size="xs" /> 删除 ({{ selectedIds.size }})</button>
      <button v-if="selectedIds.size > 0" class="btn-ghost" @click="clearSelection">取消选择</button>
      </div>
    </Teleport>

    <TimelineChart
      :events="filteredEvents"
      :parsed-dates="parsedDates"
      :depth-map="depthMap"
      :selected-event-id="selectedEvent?.id ?? null"
      :selected-ids="selectedIds"
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

    <EventDetailPanel
      v-if="selectedEvent"
      :event="selectedEvent"
      :all-events="eventList"
      :all-relations="relationStore.relations"
      :involved-entities="involvedEntities(selectedEvent?.id ?? '')"
      @close="selectedEvent = null"
      @delete-event="deleteEvent"
      @navigate-to-event="navigateToEvent"
    />

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
import { ref, computed, onMounted } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import { CustomDropdown, EntityFormModal, CreateButton, type FormFieldDef, useDuplicateNameCheck, useShortcuts, useBatchDelete, useConfirm } from '@worldsmith/plugin-sdk'
import { toastSuccess, toastWithUndo, useUndoRedo } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@/stores/settingsStore'
import { WsIcon } from '@worldsmith/ui-kit'

import TimelineChart from './components/TimelineChart.vue'
import EventDetailPanel from './components/EventDetailPanel.vue'
import ConflictDetector from './components/ConflictDetector.vue'
import { useEventTree } from './composables/useEventTree'
import { useTimelineSort } from './composables/useTimelineSort'
import { useConflictDetection } from './composables/useConflictDetection'
import { detectEras, parseDateRange } from './composables/useDateParser'
import { useTimelineDrag } from './composables/useTimelineDrag'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { checkAndConfirmName } = useDuplicateNameCheck()
const { confirm } = useConfirm()
const { register } = useShortcuts()
const { undo, redo } = useUndoRedo()
const settingsStore = useSettingsStore()
const { selectedIds, toggleSelect, clearSelection, batchDelete } = useBatchDelete()

const searchQuery = ref('')
const eraFilter = ref('')
const importanceFilter = ref('')
const loading = ref(false)
const showForm = ref(false)
const showConflicts = ref(false)
const selectedEvent = ref<Entity | null>(null)
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

  const undoKeys = settingsStore.getShortcut('global.undo') || ['ctrl', 'z']
  const redoKeys = settingsStore.getShortcut('global.redo') || ['ctrl', 'y']
  register({ id: 'global.undo', keys: undoKeys, scope: 'view', description: '撤销', handler: () => undo(entityStore, relationStore) })
  register({ id: 'global.redo', keys: redoKeys, scope: 'view', description: '重做', handler: () => redo(entityStore, relationStore) })
})

useAgentPluginBridge('timeline', async (event) => {
  const { action, payload } = event

  if (action === 'create_event') {
    await entityStore.loadAll()
    toastSuccess(`Agent 已创建事件「${payload.name || '未命名事件'}」`)
  }

  else if (action === 'update_event') {
    await entityStore.loadAll()
    toastSuccess(`Agent 已更新事件`)
  }

  else if (action === 'sort_events') {
    const method = String(payload.method || 'chronological')
    if (method !== (sortMode.value === 'chrono' ? 'chronological' : 'reverse')) {
      toggleSortMode()
    }
  }

  else if (action === 'export') {
    const format = String(payload.format || 'json')
    const items = filteredEvents.value.map(e => ({
      id: e.id, name: e.name, description: e.description,
      date: e.properties.date, dateEnd: e.properties.dateEnd,
      era: e.properties.era, importance: e.properties.importance,
      location: e.properties.location,
    }))
    const text = format === 'csv'
      ? 'id,name,date,era,importance\n' + items.map(i => `${i.id},${i.name},${i.date},${i.era},${i.importance}`).join('\n')
      : JSON.stringify(items, null, 2)
    const blob = new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `timeline-export.${format}`; a.click()
    URL.revokeObjectURL(url)
    toastSuccess('时间线已导出')
  }
})
</script>

<style scoped>
.timeline-view { padding: 20px; height: 100%; display: flex; flex-direction: column; }
/* ── 工具栏上移 R3：中和背景/边框/padding，撑满控件区（BuildingSectionView 模式） ── */
.tl-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 0; background: transparent; border: none;
  flex-shrink: 0; flex-wrap: nowrap; min-width: 0;
}
/* R3 单行适配：上移后控件基线样式（scoped，仅作用于本视图 teleport 内容） */
.search-input {
  padding: 4px 10px; font-size: var(--font-size-sm);
  border: 1px solid var(--border-color, var(--color-border));
  border-radius: var(--radius-sm); background: var(--color-bg-elevated);
  color: var(--text-color, var(--color-text-primary)); outline: none; min-width: 160px;
}
.search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--color-primary-subtle); }
.btn-ghost {
  padding: 4px 10px; font-size: var(--font-size-sm);
  border: 1px solid var(--border-color, var(--color-border));
  border-radius: var(--radius-sm); background: var(--color-bg-elevated);
  color: var(--text-color, var(--color-text-primary)); cursor: pointer;
  white-space: nowrap; transition: background .15s, border-color .15s;
}
.btn-ghost:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.btn-danger {
  padding: 4px 10px; font-size: var(--font-size-sm);
  border: 1px solid var(--danger); border-radius: var(--radius-sm);
  background: transparent; color: var(--danger); cursor: pointer; white-space: nowrap;
}
.btn-danger:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.btn-sm { padding: 5px 12px; font-size: var(--font-size-sm); }
.btn-ghost.active {
  background: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary);
}
</style>
