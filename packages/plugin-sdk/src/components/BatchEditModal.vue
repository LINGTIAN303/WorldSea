<template>
  <Teleport to="body">
  <div class="be-overlay" v-if="show" @click.self="close">
    <div class="be-modal" ref="boxRef" role="dialog" aria-modal="true" aria-label="批量编辑" tabindex="-1" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="be-header">
        <h3>批量编辑</h3>
        <div class="be-hdr-actions">
          <span class="be-count">{{ filtered.length }} / {{ entityStore.entities.length }}</span>
          <button class="be-close" @click="close" aria-label="关闭">✕</button>
        </div>
      </div>

      <div class="be-toolbar">
        <select v-model="typeFilter" aria-label="按类型过滤">
          <option value="">全部类型</option>
          <option v-for="t in allTypes" :key="t.typeKey" :value="t.typeKey"><WsIcon :name="entitySchemaRegistry.getIconName(t.typeKey)" size="xs" /> {{ t.label }}</option>
        </select>
        <input v-model="searchQuery" placeholder="搜索名称..." class="be-search" aria-label="搜索名称" />
        <label class="be-chk"><input type="checkbox" v-model="selectAll" @change="toggleAll" /> 全选</label>
      </div>

      <div class="be-actions">
        <button class="be-btn danger" :disabled="!selectedCount" @click="batchDelete"><WsIcon name="delete" size="xs" /> 删除 ({{ selectedCount }})</button>
        <button class="be-btn" :disabled="!selectedCount" @click="showTagEditor = true"><WsIcon name="tag" size="xs" /> 批量改标签</button>
        <button class="be-btn" :disabled="!selectedCount" @click="showRename = true"><WsIcon name="edit" size="xs" /> 批量改名</button>
        <button class="be-btn" :disabled="!selectedCount" @click="batchExport"><WsIcon name="item" size="xs" /> 导出选中</button>
      </div>

      <div class="be-list">
        <div v-for="e in filtered" :key="e.id" class="be-row">
          <div class="be-item" :class="{ selected: selected.has(e.id) }">
            <input type="checkbox" :checked="selected.has(e.id)" @change="toggle(e.id)" />
            <WsIcon class="be-icon" :name="typeIcon(e.type)" size="sm" />
            <span class="be-name">{{ e.name }}</span>
            <span class="be-type">{{ entitySchemaRegistry.getLabel(e.type) }}</span>
            <span class="be-tags">{{ (e.tags || []).join(', ') }}</span>
            <button class="be-edit-btn" :aria-expanded="editingId === e.id" @click="toggleEdit(e)">
              <WsIcon :name="editingId === e.id ? 'x' : 'edit'" size="xs" />
            </button>
          </div>
          <!-- 单条编辑走行内控件（与详情同一套），不再用逐条文本框问答 -->
          <div v-if="editingId === e.id" class="be-inline-edit">
            <div class="be-field">
              <span class="be-field-label">名称</span>
              <FieldControl :value="editDraft.name" raw-type="text" label="名称" :editing="true" @update:value="editDraft.name = String($event ?? '')" />
            </div>
            <div class="be-field">
              <span class="be-field-label">描述</span>
              <FieldControl :value="editDraft.description" raw-type="textarea" label="描述" :editing="true" @update:value="editDraft.description = String($event ?? '')" />
            </div>
            <div class="be-field">
              <span class="be-field-label">标签</span>
              <FieldControl :value="editDraft.tags" raw-type="tags" label="标签" :editing="true" @update:value="editDraft.tags = toTagList($event)" />
            </div>
            <div class="be-inline-actions">
              <button class="be-btn primary" :disabled="savingEdit" @click="saveEdit(e)">
                <WsInlineLoading v-if="savingEdit" size="sm" label="正在保存" />
                保存
              </button>
              <button class="be-btn" @click="editingId = null">取消</button>
            </div>
          </div>
        </div>
        <div v-if="filtered.length === 0" class="be-empty">无匹配实体</div>
      </div>

      <!-- 删除确认弹窗 -->
      <div v-if="showDeleteConfirm" class="be-dialog-overlay" @click.self="showDeleteConfirm = false">
        <div class="be-dialog">
          <h4 class="be-dialog-danger-title">批量删除</h4>
          <p class="be-dialog-info">确定删除 {{ pendingDeleteIds.length }} 个实体及其关联关系？此操作不可撤销。</p>
          <div class="be-dialog-actions">
            <button class="be-btn" @click="showDeleteConfirm = false">取消</button>
            <button class="be-btn danger" @click="doBatchDelete">删除</button>
          </div>
        </div>
      </div>

      <!-- 标签编辑弹窗 -->
      <div v-if="showTagEditor" class="be-dialog-overlay" @click.self="showTagEditor = false">
        <div class="be-dialog">
          <h4>批量修改标签</h4>
          <p class="be-dialog-info">已选 {{ selectedCount }} 个实体</p>
          <div class="be-dialog-field">
            <label>添加标签（逗号分隔）：</label>
            <input v-model="addTags" placeholder="如: 重要,已归档" />
          </div>
          <div class="be-dialog-field">
            <label>移除标签（逗号分隔，可选）：</label>
            <input v-model="removeTags" placeholder="如: 草稿,过期" />
          </div>
          <div class="be-dialog-actions">
            <button class="be-btn" @click="showTagEditor = false">取消</button>
            <button class="be-btn primary" @click="applyTags">应用</button>
          </div>
        </div>
      </div>

      <!-- 重命名弹窗 -->
      <div v-if="showRename" class="be-dialog-overlay" @click.self="showRename = false">
        <div class="be-dialog">
          <h4>批量重命名</h4>
          <p class="be-dialog-info">已选 {{ selectedCount }} 个实体</p>
          <div class="be-dialog-field">
            <label>前置文本：</label>
            <input v-model="namePrefix" placeholder="如: [WIP] " />
          </div>
          <div class="be-dialog-field">
            <label>后置文本：</label>
            <input v-model="nameSuffix" placeholder="如: (已弃用)" />
          </div>
          <div class="be-dialog-actions">
            <button class="be-btn" @click="showRename = false">取消</button>
            <button class="be-btn primary" @click="applyRename">应用</button>
          </div>
        </div>
      </div>
      <WsLoadingOverlay
        :show="busyVisible"
        scope="panel"
        title="批量编辑"
        success-title="处理完成"
        error-title="处理失败"
        :stages="busyStages"
        :current="busyStage"
        :status="busyOverlayStatus"
        @close="busyTask.reset()"
      />

      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useUndoRedo, useResizable } from '../composables'
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry } from '@worldsea/entity-core'
import { getEventBus } from '@worldsea/entity-core'
import {
  WsIcon,
  WsInlineLoading,
  WsLoadingOverlay,
  useAsyncTask,
  useModalShortcuts,
  toastSuccess,
  toastError,
  type LoadingStage,
} from '@worldsea/ui-kit'
import FieldControl from '../detail/FieldControl.vue'
import type { Entity } from '@worldsea/entity-core'
// 无状态辅助（标签串归一 / 选中实体导出下载），见 batchEditHelpers.ts
import { downloadEntitiesJson, toTagList } from './batchEditHelpers'

const modalResizable = useResizable({ panelId: 'modal-batch-edit', defaultWidth: 700, minWidth: 400, side: 'right' })

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const boxRef = ref<HTMLElement>()
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

// Esc 关闭收编 useModalShortcuts（modal 层）
useModalShortcuts(() => props.show, { id: 'batch-edit.close', onEscape: () => close() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 焦点陷阱：Tab 仅在弹窗内循环（Esc 已收编注册表）
function onKeydown(e: KeyboardEvent) {
  if (!props.show || e.key !== 'Tab') return
  const box = boxRef.value
  if (!box) return
  const focusables = box.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  const outside = !box.contains(active)
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => props.show, (v) => {
  if (v) {
    returnFocusEl = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown) // Tab 焦点陷阱（Esc 已收编注册表）
    nextTick(() => {
      const box = boxRef.value
      const first = box?.querySelector<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])') ?? box
      first?.focus({ preventScroll: true })
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    returnFocusEl?.focus?.({ preventScroll: true })
    returnFocusEl = null
  }
})

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { beginTransaction, commitTransaction } = useUndoRedo()
const allTypes = computed(() => entitySchemaRegistry.getAll())

const typeFilter = ref('')
const searchQuery = ref('')
const selected = ref(new Set<string>())
const selectAll = ref(false)
const showTagEditor = ref(false)
const showRename = ref(false)
const showDeleteConfirm = ref(false)
const pendingDeleteIds = ref<string[]>([])

const addTags = ref('')
const removeTags = ref('')
const namePrefix = ref('')
const nameSuffix = ref('')

const busyTask = useAsyncTask({ delay: 200, minVisible: 400, successHold: 300 })
const busyVisible = busyTask.visible
const busyStatus = busyTask.status
const busyStage = ref(0)
const busyLabel = ref('')
const busyProgress = ref({ done: 0, total: 0 })
const savingEdit = ref(false)
const busyOverlayStatus = computed(() =>
  (busyStatus.value === 'success' ? 'success' : busyStatus.value === 'error' ? 'error' : 'loading') as 'loading' | 'success' | 'error',
)
const busyStages = computed<LoadingStage[]>(() => [
  {
    short: '处理',
    full: busyLabel.value || '正在处理…',
    detail: busyProgress.value.total > 0
      ? `已处理 ${busyProgress.value.done} / ${busyProgress.value.total}`
      : '批量写入',
  },
  { short: '完成', full: '正在收尾…', detail: '刷新列表 / 提交结果' },
])

async function runBusy(label: string, task: () => Promise<void>): Promise<boolean> {
  if (busyStatus.value === 'loading') return false
  busyLabel.value = label
  busyProgress.value = { done: 0, total: 0 }
  busyStage.value = 0
  try {
    await busyTask.run(async () => {
      await task()
      busyStage.value = 1
    })
    return true
  } catch (err) {
    busyTask.reset()
    toastError(err instanceof Error ? err.message : String(err))
    return false
  }
}

const filtered = computed(() => {
  let items = entityStore.entities
  if (typeFilter.value) items = items.filter(e => e.type === typeFilter.value)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    items = items.filter(e => e.name.toLowerCase().includes(q))
  }
  return items
})

const selectedCount = computed(() => selected.value.size)

function typeIcon(type: string) { return entitySchemaRegistry.getIconName(type) }

function toggle(id: string) {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
  selectAll.value = filtered.value.length > 0 && selected.value.size === filtered.value.length
}

function toggleAll() {
  if (selectAll.value) filtered.value.forEach(e => selected.value.add(e.id))
  else selected.value.clear()
}

const editingId = ref<string | null>(null)
const editDraft = ref<{ name: string; description: string; tags: string[] }>({ name: '', description: '', tags: [] })

function toggleEdit(e: Entity) {
  if (editingId.value === e.id) {
    editingId.value = null
    return
  }
  editingId.value = e.id
  editDraft.value = { name: e.name, description: e.description || '', tags: [...(e.tags || [])] }
}

async function saveEdit(e: Entity) {
  const name = editDraft.value.name.trim()
  if (!name || savingEdit.value) return
  savingEdit.value = true
  try {
    await entityStore.update(e.id, { name, description: editDraft.value.description, tags: editDraft.value.tags })
    editingId.value = null
    toastSuccess(`已更新「${name}」`)
  } finally {
    savingEdit.value = false
  }
}

function batchDelete() {
  const ids = [...selected.value]
  if (ids.length === 0) return
  pendingDeleteIds.value = ids
  showDeleteConfirm.value = true
}

async function doBatchDelete() {
  const ids = pendingDeleteIds.value
  showDeleteConfirm.value = false
  if (ids.length === 0) return
  await runBusy('正在删除实体…', async () => {
    beginTransaction()
    for (let i = 0; i < ids.length; i++) {
      await entityStore.remove(ids[i]) // 级联删除已内置
      busyProgress.value = { done: i + 1, total: ids.length }
    }
    commitTransaction()
    getEventBus().emit('batch:edit', { entityIds: ids, action: 'delete' })
    selected.value.clear()
    selectAll.value = false
    pendingDeleteIds.value = []
    await entityStore.loadAll()
    await relationStore.loadAll()
  })
}

async function applyTags() {
  const add = addTags.value.split(/[,，\s]+/).filter(Boolean)
  const remove = removeTags.value.split(/[,，\s]+/).filter(Boolean)
  const ids = [...selected.value]
  const ok = await runBusy('正在批量修改标签…', async () => {
    let done = 0
    for (const id of selected.value) {
      const e = entityStore.entityMap.get(id)
      if (!e) continue
      let tags = [...(e.tags || [])]
      if (add.length) add.forEach(t => { if (!tags.includes(t)) tags.push(t) })
      if (remove.length) tags = tags.filter(t => !remove.includes(t))
      await entityStore.update(id, { tags })
      busyProgress.value = { done: ++done, total: ids.length }
    }
    getEventBus().emit('batch:edit', { entityIds: ids, action: 'tags' })
  })
  if (ok) {
    showTagEditor.value = false
    addTags.value = ''
    removeTags.value = ''
  }
}

async function applyRename() {
  const ids = [...selected.value]
  const ok = await runBusy('正在批量重命名…', async () => {
    let done = 0
    for (const id of selected.value) {
      const e = entityStore.entityMap.get(id)
      if (!e) continue
      const newName = namePrefix.value + e.name + nameSuffix.value
      if (newName !== e.name) await entityStore.update(id, { name: newName })
      busyProgress.value = { done: ++done, total: ids.length }
    }
    getEventBus().emit('batch:edit', { entityIds: ids, action: 'rename' })
  })
  if (!ok) return
  showRename.value = false
  namePrefix.value = ''
  nameSuffix.value = ''
}

function batchExport() {
  downloadEntitiesJson(entityStore.entities.filter(e => selected.value.has(e.id)))
}

function close() {
  if (busyStatus.value === 'loading') return
  showDeleteConfirm.value = false
  pendingDeleteIds.value = []
  selected.value.clear()
  selectAll.value = false
  emit('close')
}
</script>

<style scoped src="./batch-edit-modal.css"></style>
