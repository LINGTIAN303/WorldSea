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
        <div v-for="e in filtered" :key="e.id" class="be-item" :class="{ selected: selected.has(e.id) }">
          <input type="checkbox" :checked="selected.has(e.id)" @change="toggle(e.id)" />
          <WsIcon class="be-icon" :name="typeIcon(e.type)" size="sm" />
          <span class="be-name">{{ e.name }}</span>
          <span class="be-type">{{ entitySchemaRegistry.getLabel(e.type) }}</span>
          <span class="be-tags">{{ (e.tags || []).join(', ') }}</span>
          <button class="be-edit-btn" @click="editEntity(e)"><WsIcon name="edit" size="xs" /></button>
        </div>
        <div v-if="filtered.length === 0" class="be-empty">无匹配实体</div>
      </div>

      <!-- Delete confirm dialog -->
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

      <!-- Tag editor dialog -->
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

      <!-- Rename dialog -->
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
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useDialog, useUndoRedo, useResizable } from '../composables'
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import { getEventBus } from '@worldsmith/entity-core'
import { WsIcon, useModalShortcuts } from '@worldsmith/ui-kit'
import type { Entity } from '@worldsmith/entity-core'

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
  if (!props.show) return
  if (e.key === 'Tab') {
    const box = boxRef.value
    if (!box) return
    const focusables = box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(() => props.show, (v) => {
  if (v) {
    returnFocusEl = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown) // Tab 焦点陷阱（Esc 已收编注册表）
    nextTick(() => {
      const first =
        boxRef.value?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ) ?? boxRef.value
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
const { prompt } = useDialog()
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

async function editEntity(e: Entity) {
  const newName = await prompt('输入新名称', '编辑名称', e.name)
  if (newName && newName !== e.name) entityStore.update(e.id, { name: newName })
  const newDesc = await prompt('输入新描述', '编辑描述', e.description || '')
  if (newDesc !== null && newDesc !== e.description) entityStore.update(e.id, { description: newDesc })
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
  beginTransaction()
  for (const id of ids) {
    await entityStore.remove(id) // 级联删除已内置
  }
  commitTransaction()
  getEventBus().emit('batch:edit', { entityIds: ids, action: 'delete' })
  selected.value.clear()
  selectAll.value = false
  pendingDeleteIds.value = []
  await entityStore.loadAll()
  await relationStore.loadAll()
}

async function applyTags() {
  const add = addTags.value.split(/[,，\s]+/).filter(Boolean)
  const remove = removeTags.value.split(/[,，\s]+/).filter(Boolean)
  const ids = [...selected.value]
  for (const id of selected.value) {
    const e = entityStore.entityMap.get(id)
    if (!e) continue
    let tags = [...(e.tags || [])]
    if (add.length) add.forEach(t => { if (!tags.includes(t)) tags.push(t) })
    if (remove.length) tags = tags.filter(t => !remove.includes(t))
    await entityStore.update(id, { tags })
  }
  getEventBus().emit('batch:edit', { entityIds: ids, action: 'tags' })
  showTagEditor.value = false
  addTags.value = ''
  removeTags.value = ''
}

function applyRename() {
  const ids = [...selected.value]
  for (const id of selected.value) {
    const e = entityStore.entityMap.get(id)
    if (!e) continue
    const newName = namePrefix.value + e.name + nameSuffix.value
    if (newName !== e.name) entityStore.update(id, { name: newName })
  }
  getEventBus().emit('batch:edit', { entityIds: ids, action: 'rename' })
  showRename.value = false
  namePrefix.value = ''
  nameSuffix.value = ''
}

function batchExport() {
  const items = entityStore.entities.filter(e => selected.value.has(e.id))
  const text = JSON.stringify(items, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'batch-export.json'; a.click()
  URL.revokeObjectURL(url)
}

function close() { showDeleteConfirm.value = false; pendingDeleteIds.value = []; selected.value.clear(); selectAll.value = false; emit('close') }
</script>

<style scoped>
.be-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: var(--color-overlay); display: flex; align-items: center; justify-content: center; }
.be-modal { position: relative; max-height: 85vh; background: var(--content-bg); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.be-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.be-header h3 { margin: 0; font-size: var(--font-size-lg); }
.be-hdr-actions { display: flex; align-items: center; gap: 12px; }
.be-count { font-size: var(--font-size-sm); color: var(--text-secondary); }
.be-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.be-close:hover { background: var(--hover-bg); }
.be-toolbar { display: flex; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--border); align-items: center; }
.be-toolbar select, .be-search { padding: 5px 10px; border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-sm); }
.be-search { flex: 1; }
.be-chk { font-size: var(--font-size-sm); cursor: pointer; white-space: nowrap; }
.be-actions { display: flex; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.be-btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg, #f8f8f8); cursor: pointer; font-size: var(--font-size-sm); transition: background 0.15s; }
.be-btn:hover { background: var(--bg-hover); }
.be-btn.primary { background: var(--primary); color: var(--text); border-color: var(--primary); }
.be-btn.primary:hover { background: var(--primary-hover); }
.be-btn.danger { color: var(--danger); border-color: var(--danger); }
.be-btn.danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.be-btn:disabled { opacity: 0.4; cursor: default; }
.be-list { flex: 1; overflow-y: auto; min-height: 200px; }
.be-item { display: flex; align-items: center; gap: 8px; padding: 8px 20px; border-bottom: 1px solid var(--border); font-size: var(--font-size-sm); transition: background 0.1s; }
.be-item:hover { background: var(--hover-bg, #f8f8f8); }
.be-item.selected { background: var(--primary-light); }
.be-item input[type=checkbox] { flex-shrink: 0; }
.be-icon { font-size: var(--font-size-md); flex-shrink: 0; }
.be-name { flex: 1; font-weight: var(--font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-type { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.be-tags { font-size: var(--font-size-sm); color: var(--text-secondary, #888); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-edit-btn { background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; opacity: 0; transition: opacity 0.15s; font-size: var(--font-size-base); }
.be-item:hover .be-edit-btn { opacity: 1; }
.be-empty { text-align: center; padding: 40px; color: var(--text-tertiary, var(--color-text-tertiary)); }
.be-dialog-overlay { position: fixed; inset: 0; z-index: calc(var(--z-overlay) + 1); background: rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; }
.be-dialog { width: 420px; background: var(--content-bg); border-radius: 12px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
.be-dialog h4 { margin: 0 0 8px 0; font-size: var(--font-size-md); }
.be-dialog-danger-title { margin: 0 0 8px 0; font-size: var(--font-size-md); color: var(--danger); }
.be-dialog-info { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: 16px; }
.be-dialog-field { margin-bottom: 12px; }
.be-dialog-field label { display: block; font-size: var(--font-size-sm); margin-bottom: 4px; color: var(--text-secondary); }
.be-dialog-field input { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: var(--font-size-base); box-sizing: border-box; }
.be-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.resize-handle-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>
