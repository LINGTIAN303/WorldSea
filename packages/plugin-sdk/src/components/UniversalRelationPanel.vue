<template>
  <div v-if="inlineVisible || detached" class="uni-rel-panel" :class="{ 'urp-detached-placeholder': detached }">
    <div v-if="detached" class="urp-placeholder" @click="reattach">
      <WsIcon class="urp-placeholder-icon" name="pin" size="lg" />
      <span class="urp-placeholder-text">关联面板已浮出 — 点击收回</span>
    </div>
    <template v-else-if="inlineVisible">
      <div class="urp-header">
        <span class="urp-title"><WsIcon name="link" size="xs" /> 关联条目</span>
        <span class="urp-count">{{ groupedTypes.length }} 类 / {{ relations.length }} 条</span>
        <button class="urp-detach-btn" @click="detach" title="浮出面板"><WsIcon name="pin" size="xs" /></button>
      </div>
      <RelationGroupList
        :groups="groupedTypes"
        :editing-rel-id="editingRelId"
        :tab-defs="props.tabDefs"
        @navigate="navigateTo"
        @edit="startEdit"
        @remove="removeRelation"
        @reorder="onGroupReorder"
        @add="openAddGroup"
      />

      <EntityRelationSelector
        v-if="entityId"
        :entity-id="entityId"
        :entity-type="entityType"
      />
    </template>

    <FloatingPanel
      v-model:visible="editVisible"
      v-model:pinned="editPinned"
      :title="`编辑关系：${getTypeLabel(editingRel?.type || '')}`"
      :width="280"
      :height="320"
      :trigger-rect="editTriggerRect"
      panel-id="floating-relation-edit"
    >
      <div class="urp-edit-body">
        <div class="urp-edit-type-row">
          <label class="urp-edit-label">类型</label>
          <span class="urp-edit-type-name">{{ getTypeLabel(editingRel?.type || '') }}</span>
        </div>
        <div v-if="editProps.length > 0" class="urp-edit-props">
          <div v-for="prop in editProps" :key="prop.key" class="urp-edit-prop-row">
            <label class="urp-edit-prop-label">{{ prop.label }}</label>
            <input v-if="prop.type === 'text'" v-model="editPropForm[prop.key]"
              class="urp-edit-prop-input" :placeholder="prop.placeholder || ''" />
            <textarea v-else-if="prop.type === 'textarea'" v-model="editPropForm[prop.key]"
              class="urp-edit-prop-textarea" :placeholder="prop.placeholder || ''" rows="2" />
          </div>
        </div>
        <div class="urp-edit-label-row">
          <label class="urp-edit-label">自定义标签</label>
          <input v-model="editLabelForm" class="urp-edit-prop-input" placeholder="可选标签" />
        </div>
        <div class="urp-edit-actions">
          <button class="urp-edit-save" @click="saveEdit"><WsIcon name="check" size="xs" /> 保存</button>
          <button class="urp-edit-cancel" @click="cancelEdit">取消</button>
        </div>
      </div>
    </FloatingPanel>

    <!-- 定向添加（2026-10-08 合并批）：分组头「＋」按该类型的 relationType/reverseDirection 打开 -->
    <FloatingPanel
      v-model:visible="addVisible"
      v-model:pinned="addPinned"
      :title="addTarget ? `添加：${addTarget.label}` : '添加关联'"
      :width="270"
      :height="320"
      :trigger-rect="addTriggerRect"
      panel-id="floating-relation-add"
    >
      <EntityRelationSelector
        v-if="addTarget && entityId"
        :entity-id="entityId"
        :entity-type="entityType"
        :relation-type="addTarget.relationType"
        :reverse-direction="addTarget.reverseDirection"
      />
    </FloatingPanel>
  </div>

  <Teleport to="body">
    <div v-if="detached" class="urp-float-panel" :class="{ 'urp-float-collapsed': floatCollapsed }" :style="floatPanelStyle" @mousedown.stop>
      <div class="urp-float-header" @mousedown="onFloatDragStart">
        <span class="urp-float-title"><WsIcon name="link" size="xs" /> 关联条目</span>
        <span class="urp-float-count">{{ groupedTypes.length }} 类 / {{ relations.length }} 条</span>
        <div class="urp-float-actions">
          <button class="urp-collapse-btn" :class="{ collapsed: floatCollapsed }" @click.stop="toggleFloatCollapse" :title="floatCollapsed ? '展开面板' : '收起面板'"><WsIcon :name="floatCollapsed ? 'arrow-up' : 'arrow-up'" size="xs" /></button>
          <button class="urp-float-close" @click="reattach" title="收回原位"><WsIcon name="close" size="xs" /></button>
        </div>
      </div>
      <div v-if="!floatCollapsed" class="urp-float-body">
        <RelationGroupList
          :groups="groupedTypes"
          :editing-rel-id="editingRelId"
          :tab-defs="props.tabDefs"
          @navigate="navigateTo"
          @edit="startEdit"
          @remove="removeRelation"
          @reorder="onGroupReorder"
          @add="openAddGroup"
        />

        <EntityRelationSelector
          v-if="entityId"
          :entity-id="entityId"
          :entity-type="entityType"
        />
      </div>
      <div class="urp-float-resize" @mousedown.stop="onFloatResizeStart"></div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { toastSuccess } from '@worldsea/ui-kit'
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry, relationSchemaRegistry } from '@worldsea/entity-core'
import { RelationTypes } from '@worldsea/entity-core'
import { useBidirectional } from '@worldsea/entity-core/composables'
import EntityRelationSelector from './EntityRelationSelector.vue'
import RelationGroupList from './RelationGroupList.vue'
import { FloatingPanel, WsIcon } from '@worldsea/ui-kit'
import type { RelationTabDef } from './types'
import type { EnhancedRelation, RelationGroupState } from './relationPanelTypes'

const props = withDefaults(defineProps<{
  entityId: string
  entityType?: string
  inlineVisible?: boolean
  storageScope?: string
  /** 芽声明的关系元数据（合并批起：分组语义名 / 定向「＋」入口） */
  tabDefs?: RelationTabDef[]
}>(), {
  inlineVisible: true,
  storageScope: 'default',
})

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { deleteWithConfirm, editWithSync } = useBidirectional()

const relations = ref<EnhancedRelation[]>([])

const groupedTypes = ref<RelationGroupState[]>([])

const scopePrefix = computed(() => `urp-${props.storageScope}`)

const DETACHED_KEY = computed(() => `${scopePrefix.value}-detached`)
const FLOAT_X_KEY = computed(() => `${scopePrefix.value}-float-x`)
const FLOAT_Y_KEY = computed(() => `${scopePrefix.value}-float-y`)
const FLOAT_W_KEY = computed(() => `${scopePrefix.value}-float-w`)
const FLOAT_COLLAPSED_KEY = computed(() => `${scopePrefix.value}-float-collapsed`)

const detached = ref(false)
const floatX = ref(0)
const floatY = ref(0)
const floatW = ref(340)
const floatCollapsed = ref(false)

function loadFloatState() {
  try {
    detached.value = localStorage.getItem(DETACHED_KEY.value) === 'true'
    floatX.value = Number(localStorage.getItem(FLOAT_X_KEY.value)) || window.innerWidth - 380
    floatY.value = Number(localStorage.getItem(FLOAT_Y_KEY.value)) || 60
    floatW.value = Number(localStorage.getItem(FLOAT_W_KEY.value)) || 340
    floatCollapsed.value = localStorage.getItem(FLOAT_COLLAPSED_KEY.value) === 'true'
  } catch { /* ignore */ }
}
loadFloatState()

watch(detached, (v) => {
  try { localStorage.setItem(DETACHED_KEY.value, v ? 'true' : 'false') } catch { /* ignore */ }
})
watch(floatX, (v) => { try { localStorage.setItem(FLOAT_X_KEY.value, String(v)) } catch { /* ignore */ } })
watch(floatY, (v) => { try { localStorage.setItem(FLOAT_Y_KEY.value, String(v)) } catch { /* ignore */ } })
watch(floatW, (v) => { try { localStorage.setItem(FLOAT_W_KEY.value, String(v)) } catch { /* ignore */ } })
watch(floatCollapsed, (v) => {
  try { localStorage.setItem(FLOAT_COLLAPSED_KEY.value, v ? 'true' : 'false') } catch { /* ignore */ }
})

watch(() => props.storageScope, () => {
  loadFloatState()
})

function detach() {
  floatX.value = Math.min(floatX.value, window.innerWidth - floatW.value - 10)
  floatY.value = Math.max(10, floatY.value)
  detached.value = true
}

function reattach() {
  detached.value = false
  floatCollapsed.value = false
}

function toggleFloatCollapse() {
  floatCollapsed.value = !floatCollapsed.value
}

const isFloatDragging = ref(false)
let floatDragOffsetX = 0
let floatDragOffsetY = 0

function onFloatDragStart(e: MouseEvent) {
  isFloatDragging.value = true
  floatDragOffsetX = e.clientX - floatX.value
  floatDragOffsetY = e.clientY - floatY.value
  document.addEventListener('mousemove', onFloatDragMove)
  document.addEventListener('mouseup', onFloatDragEnd)
  e.preventDefault()
}

function onFloatDragMove(e: MouseEvent) {
  if (!isFloatDragging.value) return
  let nx = e.clientX - floatDragOffsetX
  let ny = e.clientY - floatDragOffsetY
  nx = Math.max(0, Math.min(nx, window.innerWidth - 60))
  ny = Math.max(0, Math.min(ny, window.innerHeight - 30))
  floatX.value = nx
  floatY.value = ny
}

function onFloatDragEnd() {
  isFloatDragging.value = false
  document.removeEventListener('mousemove', onFloatDragMove)
  document.removeEventListener('mouseup', onFloatDragEnd)
}

let isFloatResizing = false
let floatResizeStartX = 0
let floatResizeStartW = 0

function onFloatResizeStart(e: MouseEvent) {
  isFloatResizing = true
  floatResizeStartX = e.clientX
  floatResizeStartW = floatW.value
  document.addEventListener('mousemove', onFloatResizeMove)
  document.addEventListener('mouseup', onFloatResizeEnd)
  e.preventDefault()
}

function onFloatResizeMove(e: MouseEvent) {
  if (!isFloatResizing) return
  const delta = e.clientX - floatResizeStartX
  floatW.value = Math.max(240, floatResizeStartW + delta)
}

function onFloatResizeEnd() {
  isFloatResizing = false
  document.removeEventListener('mousemove', onFloatResizeMove)
  document.removeEventListener('mouseup', onFloatResizeEnd)
}

const floatPanelStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${floatX.value}px`,
  top: `${floatY.value}px`,
  width: `${floatW.value}px`,
  zIndex: 10001,
}))

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onFloatDragMove)
  document.removeEventListener('mouseup', onFloatDragEnd)
  document.removeEventListener('mousemove', onFloatResizeMove)
  document.removeEventListener('mouseup', onFloatResizeEnd)
})

/** 分组拖拽重排（子件上报顺序）：重排 state + 落盘「用户手排」次序 */
function onGroupReorder(orderedTypes: string[]): void {
  const byType = new Map(groupedTypes.value.map(g => [g.type, g]))
  const next = orderedTypes.map(t => byType.get(t)).filter((g): g is RelationGroupState => !!g)
  for (const g of groupedTypes.value) {
    if (!orderedTypes.includes(g.type)) next.push(g)
  }
  groupedTypes.value = next
  saveGroupOrder()
}

/** 「＋」定向添加浮层（合并批）：按分组类型声明的 relationType/reverseDirection 打开 */
const addVisible = ref(false)
const addPinned = ref(false)
const addTriggerRect = ref<DOMRect | null>(null)
const addTarget = ref<{ relationType: string; label: string; reverseDirection?: boolean } | null>(null)

function openAddGroup(relationType: string, ev: MouseEvent): void {
  const def = (props.tabDefs ?? []).find(d => d.relationType === relationType)
  const group = groupedTypes.value.find(g => g.type === relationType)
  const el = ev.currentTarget as HTMLElement | null
  addTriggerRect.value = el ? el.getBoundingClientRect() : null
  addTarget.value = { relationType, label: group?.label || relationType, reverseDirection: def?.reverseDirection }
  addVisible.value = true
}

const GROUP_ORDER_KEY = 'urp-group-order'

function saveGroupOrder() {
  try {
    const order = groupedTypes.value.map(g => g.type)
    localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(order))
  } catch { /* ignore */ }
}

function loadGroupOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(GROUP_ORDER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function loadRelations() {
  if (!props.entityId) {
    relations.value = []
    groupedTypes.value = []
    return
  }

  const raw = await relationStore.getConnected(props.entityId)

  const seenPairIds = new Set<string>()
  const enhanced: EnhancedRelation[] = []

  for (const rel of raw) {
    if (rel.pairId) {
      if (seenPairIds.has(rel.pairId)) continue
      seenPairIds.add(rel.pairId)
    }

    const isSource = rel.sourceId === props.entityId
    const counterpartId = isSource ? rel.targetId : rel.sourceId
    const counterpart = entityStore.entityMap.get(counterpartId)
    const counterpartType = counterpart?.type || ''
    enhanced.push({
      ...rel,
      direction: isSource ? 'out' : 'in',
      counterpartId,
      counterpartName: counterpart?.name || '(已删除)',
      counterpartIcon: entitySchemaRegistry.getIconName(counterpartType),
      counterpartTypeLabel: entitySchemaRegistry.getLabel(counterpartType),
      groupType: rel.type,
    })
  }

  relations.value = enhanced

  const groups = new Map<string, EnhancedRelation[]>()
  for (const r of enhanced) {
    if (!groups.has(r.groupType)) groups.set(r.groupType, [])
    groups.get(r.groupType)!.push(r)
  }

  let groupArray: RelationGroupState[] = Array.from(groups.entries()).map(([type, rels]) => {
    const schema = relationSchemaRegistry.get(type)
    const def = (props.tabDefs ?? []).find(d => d.relationType === type)
    return {
      type,
      label: def?.label || schema?.label || type,
      relations: rels,
      collapsed: false,
    }
  })

  // 初始序：芽声明序前置（稳定排序，未覆盖的保持出现序）；用户手排名（savedOrder）随后整体覆盖
  const defRank = new Map((props.tabDefs ?? []).map((d, i) => [d.relationType, i]))
  if (defRank.size) {
    groupArray.sort((a, b) =>
      (defRank.get(a.type) ?? Number.MAX_SAFE_INTEGER) - (defRank.get(b.type) ?? Number.MAX_SAFE_INTEGER),
    )
  }

  const savedOrder = loadGroupOrder()
  if (savedOrder && savedOrder.length > 0) {
    const orderMap = new Map(savedOrder.map((t, i) => [t, i]))
    groupArray.sort((a, b) => {
      const oa = orderMap.has(a.type) ? orderMap.get(a.type)! : savedOrder.length
      const ob = orderMap.has(b.type) ? orderMap.get(b.type)! : savedOrder.length
      return oa - ob
    })
  }

  groupedTypes.value = groupArray
}

watch(() => props.entityId, (id) => {
  if (id) loadRelations()
}, { immediate: true })

watch(() => relationStore.relations.length, () => {
  if (props.entityId) loadRelations()
})

function navigateTo(rel: EnhancedRelation): void {
  const targetEntity = entityStore.entityMap.get(rel.counterpartId)
  if (!targetEntity) return
  // 2026-10-08 归一：走 ws-navigate 契约（Shell 统一「切视图 + 挂起位 + 事件通道」）——
  // 此前手写 6 类视图映射直调 store：非映射类型不切视图、同视图无即时选中
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { entityType: targetEntity.type, entityId: rel.counterpartId },
  }))
}

async function removeRelation(rel: EnhancedRelation) {
  try {
    await deleteWithConfirm(rel.id)
    toastSuccess('已移除关联')
    await loadRelations()
  } catch (err) {
    console.error('[UniversalRelationPanel] remove failed:', err)
  }
}

const editingRelId = ref<string | null>(null)
const editingRel = ref<EnhancedRelation | null>(null)
const editPropForm = ref<Record<string, string>>({})
const editLabelForm = ref('')
const editVisible = ref(false)
const editPinned = ref(false)
const editTriggerRect = ref<DOMRect | null>(null)

interface EditPropDef {
  key: string
  label: string
  type: 'text' | 'textarea'
  placeholder?: string
}

const editProps = computed<EditPropDef[]>(() => {
  if (!editingRel.value) return []
  const props = RELATION_EDIT_PROPS[editingRel.value.type] || []
  return props
})

function getTypeLabel(relType: string): string {
  const schema = relationSchemaRegistry.get(relType)
  return schema?.label || relType
}

function startEdit(rel: EnhancedRelation, event?: MouseEvent) {
  editingRel.value = rel
  editingRelId.value = rel.id
  editPropForm.value = Object.fromEntries(
    Object.entries(rel.properties || {}).map(([k, v]) => [k, String(v ?? '')])
  )
  editLabelForm.value = rel.label || ''

  if (event) {
    const target = event.currentTarget as HTMLElement
    if (target) {
      editTriggerRect.value = target.getBoundingClientRect()
    }
  }
  editVisible.value = true
}

function cancelEdit() {
  editingRelId.value = null
  editingRel.value = null
  editPropForm.value = {}
  editLabelForm.value = ''
  editVisible.value = false
}

async function saveEdit() {
  if (!editingRel.value) return
  const rel = editingRel.value

  const properties: Record<string, any> = {}
  for (const [k, v] of Object.entries(editPropForm.value)) {
    if (v) properties[k] = v
  }

  try {
    await editWithSync(rel.id, {
      properties,
      label: editLabelForm.value || undefined,
      updatedAt: new Date().toISOString(),
    })
    toastSuccess('关系已更新')
    cancelEdit()
    await loadRelations()
  } catch (err) {
    console.error('[UniversalRelationPanel] update failed:', err)
  }
}

const RELATION_EDIT_PROPS: Record<string, EditPropDef[]> = {
  [RelationTypes.BELONGS_TO]: [
    { key: 'role', label: '角色/职位', type: 'text' },
    { key: 'since', label: '时间', type: 'text' },
  ],
  [RelationTypes.MEMBER_OF]: [
    { key: 'role', label: '角色/职位', type: 'text' },
    { key: 'since', label: '时间', type: 'text' },
  ],
  [RelationTypes.OWNS]: [
    { key: 'acquisition', label: '获得方式', type: 'text' },
    { key: 'since', label: '时间', type: 'text' },
  ],
  [RelationTypes.OWNED_BY]: [
    { key: 'acquisition', label: '获得方式', type: 'text' },
    { key: 'since', label: '时间', type: 'text' },
  ],
  [RelationTypes.PARTICIPATED_IN]: [
    { key: 'role', label: '角色', type: 'text' },
  ],
  [RelationTypes.INVOLVED_IN]: [
    { key: 'role', label: '角色', type: 'text' },
    { key: 'impact', label: '影响', type: 'textarea' },
  ],
  [RelationTypes.RESIDES_IN]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'status', label: '状态', type: 'text' },
  ],
  [RelationTypes.LOCATED_IN]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'detail', label: '位置', type: 'text' },
  ],
  [RelationTypes.LOCATED_AT]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'detail', label: '位置', type: 'text' },
  ],
  [RelationTypes.ALLIED_WITH]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'terms', label: '盟约', type: 'textarea' },
  ],
  [RelationTypes.HOSTILE_TO]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'reason', label: '原因', type: 'textarea' },
  ],
  [RelationTypes.KNOWS]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'nature', label: '性质', type: 'text' },
  ],
  [RelationTypes.PARENT_OF]: [
    { key: 'biological', label: '血缘', type: 'text' },
  ],
  [RelationTypes.CHILD_OF]: [
    { key: 'biological', label: '血缘', type: 'text' },
  ],
  [RelationTypes.CAUSES]: [
    { key: 'mechanism', label: '机制', type: 'textarea' },
  ],
  [RelationTypes.PRECEDES]: [
    { key: 'gap', label: '间隔', type: 'text' },
  ],
  [RelationTypes.BORDERS]: [
    { key: 'length', label: '长度', type: 'text' },
    { key: 'type', label: '类型', type: 'text' },
  ],
  [RelationTypes.CONTROLS]: [
    { key: 'since', label: '时间', type: 'text' },
    { key: 'method', label: '方式', type: 'text' },
  ],
  [RelationTypes.ROUTE]: [
    { key: 'distance', label: '距离', type: 'text' },
    { key: 'method', label: '方式', type: 'text' },
  ],
  [RelationTypes.CONTAINS]: [
    { key: 'since', label: '时间', type: 'text' },
  ],
  [RelationTypes.REFERENCES]: [
    { key: 'nature', label: '性质', type: 'text' },
  ],
  [RelationTypes.INSPIRED_BY]: [
    { key: 'aspect', label: '方面', type: 'text' },
  ],
  [RelationTypes.NOTABLE_FOR]: [
    { key: 'detail', label: '详情', type: 'textarea' },
  ],
  [RelationTypes.OCCURRED_AT]: [
    { key: 'detail', label: '地点', type: 'text' },
  ],
  [RelationTypes.HAPPENS_IN]: [
    { key: 'detail', label: '地点', type: 'text' },
  ],
  [RelationTypes.ASSOCIATED_WITH]: [
    { key: 'nature', label: '性质', type: 'text' },
  ],
}
</script>

<style scoped>
.uni-rel-panel {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  margin-top: 12px;
  overflow: hidden;
}
.uni-rel-panel.urp-detached-placeholder {
  border-style: dashed;
  background: var(--bg-tertiary, #f9fafb);
}
.urp-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.urp-placeholder:hover {
  background: var(--hover-bg, #eef2ff);
}
.urp-placeholder-icon { font-size: var(--font-size-lg); }
.urp-placeholder-text { font-size: var(--font-size-sm); color: var(--text-secondary, #666); }
.urp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-tertiary, #f9fafb);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.urp-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color, #333); }
.urp-count { font-size: var(--font-size-xs); color: var(--text-tertiary, #999); }
.urp-detach-btn {
  width: 22px; height: 22px; border: none; background: transparent;
  cursor: pointer; font-size: var(--font-size-sm); border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.4; transition: opacity 0.15s, background 0.15s;
}
.urp-detach-btn:hover { opacity: 0.8; background: var(--hover-bg, #f3f4f6); }

.urp-edit-body { padding: 10px; }
.urp-edit-type-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.urp-edit-label { font-size: var(--font-size-xs); color: var(--text-secondary); min-width: 50px; }
.urp-edit-type-name { font-size: var(--font-size-xs); color: var(--primary); font-weight: var(--font-weight-semibold); }
.urp-edit-props { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.urp-edit-prop-row { display: flex; flex-direction: column; gap: 2px; }
.urp-edit-prop-label { font-size: var(--font-size-xs); color: var(--text-secondary); }
.urp-edit-prop-input {
  padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px;
  font-size: var(--font-size-xs); background: var(--bg); color: var(--text-color);
}
.urp-edit-prop-textarea {
  padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px;
  font-size: var(--font-size-xs); background: var(--bg); color: var(--text-color);
  resize: vertical; font-family: inherit;
}
.urp-edit-label-row { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.urp-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }
.urp-edit-save {
  padding: 4px 12px; border: none; border-radius: 4px;
  background: var(--primary); color: #fff; cursor: pointer; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
}
.urp-edit-save:hover { opacity: 0.9; }
.urp-edit-cancel {
  padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 4px;
  background: none; cursor: pointer; font-size: var(--font-size-xs); color: var(--text-secondary);
}
.urp-edit-cancel:hover { background: var(--hover-bg); }

.urp-float-panel {
  background: var(--modal-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  position: relative;
  max-height: 80vh;
  transition: max-height 0.2s ease;
}
.urp-float-panel.urp-float-collapsed {
  max-height: 40px;
}
.urp-float-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: var(--bg-tertiary, #f9fafb);
  border-bottom: 1px solid var(--border-light, #f0f0f0);
  cursor: grab; flex-shrink: 0;
}
.urp-float-header:active { cursor: grabbing; }
.urp-float-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color, #333); }
.urp-float-count { font-size: var(--font-size-xs); color: var(--text-tertiary, #999); flex: 1; }
.urp-float-actions { display: flex; gap: 2px; flex-shrink: 0; }
.urp-collapse-btn {
  width: 22px; height: 22px; border: none; background: transparent;
  cursor: pointer; font-size: var(--font-size-sm); border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.5; transition: opacity 0.15s, background 0.15s;
}
.urp-collapse-btn:hover { opacity: 1; background: var(--hover-bg, #f3f4f6); }
.urp-collapse-btn.collapsed { opacity: 0.8; }
.urp-float-close {
  width: 22px; height: 22px; border: none; background: transparent;
  cursor: pointer; font-size: var(--font-size-xs); color: var(--text-tertiary, #999);
  border-radius: 3px; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.urp-float-close:hover { background: var(--hover-bg, #f3f4f6); color: var(--text-color, #333); }
.urp-float-body {
  flex: 1; overflow-y: auto; overflow-x: hidden;
}
.urp-float-body .urp-groups { max-height: none; }
.urp-float-resize {
  position: absolute; right: 0; top: 0; width: 6px; height: 100%;
  cursor: col-resize; z-index: 10; background: transparent;
  transition: background 0.15s;
}
.urp-float-resize:hover,
.urp-float-resize:active {
  background: var(--primary); opacity: 0.3;
}
</style>
