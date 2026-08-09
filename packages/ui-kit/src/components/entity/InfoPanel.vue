<template>
  <Transition name="ws-panel-backdrop">
    <div v-if="entity" class="info-panel-backdrop"></div>
  </Transition>
  <Transition :name="panelTransition">
    <div v-if="entity" class="info-panel" :class="{ 'left-side': panelOnLeft }" role="complementary" aria-label="实体详情" tabindex="-1" @keydown="onKeyDown" :style="{ width: infoResizable.width.value + 'px' }">
      <div class="resize-handle-left" @mousedown="infoResizable.onResizeStart"></div>
      <div class="ip-header">
        <WsIcon :name="icon" size="sm" />
        <span class="ip-name">{{ entity.name }}</span>
        <button class="ip-edit-btn" :class="{ on: editMode }" @click="editMode = !editMode"><WsIcon name="edit" size="xs" /> {{ editMode ? '编辑中' : '编辑' }}</button>
        <button v-if="editMode" class="ip-order-btn" @click="openOrderDialog" title="字段排序"><WsIcon name="settings" size="xs" /></button>
        <button v-if="editMode" class="ip-del-btn" @click="showDeleteConfirm = true" title="删除实体"><WsIcon name="delete" size="xs" /> 删除</button>
        <button class="ip-close" @click="close">x</button>
      </div>
      <div class="ip-body">
        <div class="ip-section">
          <div class="ip-label">类型</div>
          <div>{{ typeLabel }}</div>
        </div>
        <div class="ip-section">
          <div class="ip-label">描述</div>
          <textarea v-model="editDesc" class="ip-input" rows="3" @blur="saveDesc"></textarea>
        </div>
        <div class="ip-section" v-if="sortedFields.length">
          <div class="ip-label">属性</div>
          <div
            v-for="(field, i) in sortedFields"
            :key="field.key"
            class="ip-prop"
            :class="{ 'ip-prop-edit': editMode, 'ip-drag-over': propDragOverIdx === i }"
            :draggable="editMode"
            @dragstart="onPropDragStart(i, $event)"
            @dragover.prevent="onPropDragOver(i)"
            @dragleave="onPropDragLeave"
            @drop="onPropDrop(i)"
          >
            <div class="ip-prop-label">
              <WsIcon v-if="editMode" name="grip" size="xs" class="ip-prop-handle" />
              {{ field.label }}
              <span v-if="field.source === 'shared'" class="ip-prop-badge" :title="'共享自 ' + field.sharedFrom">共享</span>
              <button v-if="editMode && field.source !== 'builtin'" class="ip-prop-del" @click="removeCustomField(field.key)" title="删除此字段">✕</button>
            </div>
            <input
              v-if="field.fieldType === 'boolean'"
              type="checkbox"
              :checked="!!editProps[field.key]"
              @change="onPropChange(field.key, ($event.target as HTMLInputElement).checked)"
              class="ip-checkbox"
            />
            <input
              v-else-if="field.fieldType === 'color'"
              type="color"
              :value="String(editProps[field.key] ?? '')"
              @change="onPropChange(field.key, ($event.target as HTMLInputElement).value)"
              class="ip-color-input"
            />
            <textarea
              v-else-if="field.fieldType === 'textarea'"
              :value="stripHtml(String(editProps[field.key] ?? ''))"
              @blur="onPropChange(field.key, ($event.target as HTMLTextAreaElement).value)"
              class="ip-input"
              rows="2"
            ></textarea>
            <select
              v-else-if="field.fieldType === 'select' && field.options?.length"
              :value="String(editProps[field.key] ?? '')"
              @change="onPropChange(field.key, ($event.target as HTMLSelectElement).value)"
              class="ip-input"
            >
              <option value="">—</option>
              <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <input
              v-else
              :value="String(editProps[field.key] ?? '')"
              @blur="onPropChange(field.key, ($event.target as HTMLInputElement).value)"
              class="ip-input"
            />
          </div>
          <div class="ip-add-field">
            <button v-if="!showAddField" class="ip-add-btn" @click="showAddField = true">＋ 添加字段</button>
            <div v-else class="ip-adder">
              <input v-model="newFieldKey" class="ip-input ip-adder-key" placeholder="字段 key（英文）" />
              <input v-model="newFieldLabel" class="ip-input ip-adder-label" placeholder="显示名" />
              <select v-model="newFieldType" class="ip-adder-type">
                <option value="text">文本</option>
                <option value="textarea">长文本</option>
                <option value="number">数字</option>
                <option value="boolean">开关</option>
                <option value="date">日期</option>
                <option value="select">选项</option>
                <option value="color">颜色</option>
              </select>
              <input v-if="newFieldType === 'select'" v-model="newFieldOptions" class="ip-input" placeholder="选项（逗号分隔）" />
              <button class="ip-adder-ok" @click="confirmAddField">确定</button>
              <button class="ip-adder-cancel" @click="cancelAddField">取消</button>
            </div>
          </div>
        </div>
        <div class="ip-section" v-if="tags.length">
          <div class="ip-label">标签</div>
          <div class="ip-tags"><span v-for="t in tags" :key="t" class="ip-tag">{{ t }}</span></div>
        </div>
        <div class="ip-section">
          <div class="ip-label">关联条目 ({{ relations.length }})</div>
          <div v-for="r in relations" :key="r.id" class="ip-rel">
            <WsIcon class="ip-rel-icon" :name="relationIcon(r)" size="xs" />
            <span class="ip-rel-name">{{ relationTarget(r) }}</span>
            <span class="ip-rel-type">{{ r.label || r.type }}</span>
          </div>
          <WsEmpty v-if="!relations.length" preset="no-data" title="暂无关联" />
        </div>
      </div>
      <Transition name="ws-confirm-bar">
        <div v-if="showDeleteConfirm" class="ip-delete-bar">
          <span>确定删除「{{ entity?.name }}」？</span>
          <button class="ip-del-confirm" @click="confirmDelete">确定</button>
          <button class="ip-del-cancel" @click="showDeleteConfirm = false">取消</button>
        </div>
      </Transition>

      <div v-if="showOrderDialog" class="ip-order-overlay" @click.self="showOrderDialog = false">
        <div class="ip-order-box">
          <div class="ip-order-header">
            <h3>字段排序 — {{ typeLabel }}</h3>
            <button class="ip-order-close" @click="showOrderDialog = false">✕</button>
          </div>
          <div class="ip-order-body">
            <div
              v-for="(field, i) in orderDialogFields"
              :key="field.key"
              class="ip-order-item"
              :class="{ 'ip-order-drag-over': orderDragOverIdx === i }"
              draggable="true"
              @dragstart="onOrderDragStart(i, $event)"
              @dragover.prevent="onOrderDragOver(i)"
              @dragleave="onOrderDragLeave"
              @drop="onOrderDrop(i)"
            >
              <WsIcon name="grip" size="xs" class="ip-order-handle" />
              <span class="ip-order-key">{{ field.key }}</span>
              <span class="ip-order-label">{{ field.label }}</span>
              <span v-if="field.isCustom" class="ip-order-custom-tag">自定义</span>
            </div>
          </div>
          <div class="ip-order-footer">
            <button class="ip-order-btn-save" @click="saveOrderAsPreset">保存排序</button>
            <button class="ip-order-btn-cancel" @click="showOrderDialog = false">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry } from '@worldsmith/entity-core'
import { fieldRegistry, useFieldOrderStore, type RegisteredField } from '@worldsmith/entity-core'
import { toastSuccess, toastWarn, toastWithUndo } from '../../composables/useToast'
import { useSelection, useDialog, useResizable } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@worldsmith/entity-core'
import WsIcon from '../WsIcon.vue'
import WsEmpty from '../WsEmpty.vue'

interface DisplayField extends RegisteredField {
  isCustom?: boolean
}

const settingsStore = useSettingsStore()
const panelOnLeft = computed(() => settingsStore.detailPanelPosition === 'left')
const panelTransition = computed(() => panelOnLeft.value ? 'ws-panel-left' : 'ws-panel')

const detailSide = computed(() => settingsStore.detailPanelPosition === 'left' ? 'right' : 'left')
const infoResizable = useResizable({ panelId: 'detail-info', defaultWidth: 340, minWidth: 240, sideRef: detailSide })

const { selectedId, select } = useSelection()
const entityStore = useEntityStore()
const relationStore = useRelationStore()
const fieldOrderStore = useFieldOrderStore()
const dialog = useDialog()

const editDesc = ref('')
const editProps = ref<Record<string, unknown>>({})
const showDeleteConfirm = ref(false)
const showOrderDialog = ref(false)
const showAddField = ref(false)
const editMode = ref(false)
const newFieldKey = ref('')
const newFieldLabel = ref('')
const newFieldType = ref<'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'select' | 'color'>('text')
const newFieldOptions = ref('')
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null

const entity = computed(() => selectedId.value ? entityStore.entityMap.get(selectedId.value) || null : null)
const icon = computed(() => entity.value ? entitySchemaRegistry.getIconName(entity.value.type) : '')
const typeLabel = computed(() => entity.value ? entitySchemaRegistry.getLabel(entity.value.type) : '')
const tags = computed(() => entity.value?.tags || [])
const entityType = computed(() => entity.value?.type || '')

const sortedFields = computed<DisplayField[]>(() => {
  void fieldRegistry.version.value
  if (!entity.value) return []
  const fields = fieldRegistry.getFields(entity.value.type)
  return fields.map(f => ({
    ...f,
    isCustom: f.source !== 'builtin',
  }))
})

const orderDialogFields = ref<DisplayField[]>([])

const relations = computed(() => {
  if (!entity.value) return []
  return relationStore.relations.filter(r => r.sourceId === entity.value!.id || r.targetId === entity.value!.id)
})

function relationTarget(r: any) {
  if (!entity.value) return ''
  const otherId = r.sourceId === entity.value.id ? r.targetId : r.sourceId
  return entityStore.entityMap.get(otherId)?.name || otherId
}

function relationIcon(r: any) {
  const otherId = r.sourceId === entity.value?.id ? r.targetId : r.sourceId
  const other = entityStore.entityMap.get(otherId)
  return other ? entitySchemaRegistry.getIconName(other.type) || '' : ''
}

watch(selectedId, (id) => {
  if (id) {
    const e = entityStore.entityMap.get(id)
    editDesc.value = e?.description || ''
    editProps.value = e ? { ...e.properties } : {}
  }
  showDeleteConfirm.value = false
})

function saveDesc() {
  if (!entity.value) return
  entityStore.update(entity.value.id, { description: editDesc.value })
  toastSuccess('已保存')
}

function onPropChange(key: string, value: unknown) {
  if (!entity.value) return
  editProps.value = { ...editProps.value, [key]: value }
  entityStore.update(entity.value.id, { properties: { ...editProps.value } })
  toastSuccess('已保存')
}

function confirmAddField() {
  if (!entity.value) return
  const key = newFieldKey.value.trim()
  const label = newFieldLabel.value.trim() || key
  if (!key) return
  const options = newFieldType.value === 'select'
    ? newFieldOptions.value.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ value: s, label: s }))
    : undefined
  const ok = fieldRegistry.addUserField(entity.value.type, { key, label, fieldType: newFieldType.value, options })
  if (!ok) {
    toastWarn(`字段 "${key}" 已存在`)
    return
  }
  let defaultVal: unknown = ''
  if (newFieldType.value === 'number') defaultVal = 0
  else if (newFieldType.value === 'boolean') defaultVal = false
  editProps.value = { ...editProps.value, [key]: defaultVal }
  entityStore.update(entity.value.id, { properties: { ...editProps.value, [key]: defaultVal } })
  cancelAddField()
  toastSuccess(`已添加字段「${label}」`)
}

function cancelAddField() {
  showAddField.value = false
  newFieldKey.value = ''
  newFieldLabel.value = ''
  newFieldType.value = 'text'
  newFieldOptions.value = ''
}

function removeCustomField(key: string) {
  if (!entity.value) return
  fieldRegistry.removeField(entity.value.type, key)
  const { [key]: _, ...rest } = editProps.value
  editProps.value = rest
  entityStore.update(entity.value.id, { properties: rest })
  toastSuccess(`已删除字段「${key}」`)
}

let propDragIdx = -1
const propDragOverIdx = ref(-1)

function onPropDragStart(idx: number, e: DragEvent) {
  propDragIdx = idx
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onPropDragOver(idx: number) {
  propDragOverIdx.value = idx
}

function onPropDragLeave() {
  propDragOverIdx.value = -1
}

function onPropDrop(idx: number) {
  propDragOverIdx.value = -1
  if (propDragIdx === idx || propDragIdx < 0) return
  const fields = [...sortedFields.value]
  const [moved] = fields.splice(propDragIdx, 1)
  fields.splice(idx, 0, moved)
  fieldRegistry.setOrder(entityType.value, fields.map(f => f.key))
  propDragIdx = -1
}

function openOrderDialog() {
  orderDialogFields.value = [...sortedFields.value]
  showOrderDialog.value = true
}

let orderDragIdx = -1
const orderDragOverIdx = ref(-1)

function onOrderDragStart(idx: number, e: DragEvent) {
  orderDragIdx = idx
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onOrderDragOver(idx: number) {
  orderDragOverIdx.value = idx
}

function onOrderDragLeave() {
  orderDragOverIdx.value = -1
}

function onOrderDrop(idx: number) {
  orderDragOverIdx.value = -1
  if (orderDragIdx === idx || orderDragIdx < 0) return
  const fields = [...orderDialogFields.value]
  const [moved] = fields.splice(orderDragIdx, 1)
  fields.splice(idx, 0, moved)
  orderDialogFields.value = fields
  fieldRegistry.setOrder(entityType.value, fields.map(f => f.key))
  orderDragIdx = -1
}

async function saveOrderAsPreset() {
  const name = await dialog.prompt('输入预设名称', '保存预设', '新预设')
  if (!name) return
  fieldOrderStore.savePreset(entityType.value, name, orderDialogFields.value.map(f => f.key))
  fieldOrderStore.loadPreset(entityType.value, name)
  toastSuccess(`已保存预设「${name}」`)
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && editMode.value) {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    requestDelete()
  }
  if (e.key === 'Escape') {
    if (showOrderDialog.value) {
      showOrderDialog.value = false
    } else if (showDeleteConfirm.value) {
      showDeleteConfirm.value = false
    } else {
      close()
    }
  }
}

function requestDelete() {
  if (!entity.value) return
  showDeleteConfirm.value = true
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
  deleteConfirmTimer = setTimeout(() => { showDeleteConfirm.value = false }, 5000)
}

async function confirmDelete() {
  if (!entity.value) return
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
  const oldEntity = { ...entity.value }
  const entityId = entity.value.id
  showDeleteConfirm.value = false
  close()
  await entityStore.remove(entityId)
  toastWithUndo(`已删除「${oldEntity.name}」`, async () => {
    await entityStore.add(oldEntity)
    toastSuccess('已恢复')
  })
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (!entity.value) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    requestDelete()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeyDown)
  if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
})

function close() { select(null) }

function stripHtml(s: string): string {
  if (!s) return s
  return s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
}
</script>

<style scoped>
.info-panel {
  position: fixed; top: var(--layout-menubar-height); right: 0; height: calc(100vh - var(--layout-menubar-height));
  z-index: var(--z-detail); background: var(--glass-bg, var(--bg-secondary));
  border-left: 1px solid var(--glass-border, var(--border));
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-xl);
  backdrop-filter: blur(var(--glass-blur));
}
.info-panel.left-side {
  right: auto; left: 0;
  border-left: none; border-right: 1px solid var(--glass-border, var(--border));
}
.ip-header { display: flex; align-items: center; gap: 8px; padding: 16px 18px; border-bottom: 1px solid var(--border); background: var(--gradient-subtle, transparent); }
.ip-icon { font-size: var(--font-size-xl); }
.ip-name { flex: 1; font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--text); }
.ip-order-btn {
  font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 4px;
  border: 1px solid var(--border); background: var(--bg-tertiary);
  cursor: pointer; color: var(--text-secondary); transition: background 0.12s;
}
.ip-order-btn:hover { background: var(--hover-bg, rgba(0,0,0,0.05)); }
.ip-edit-btn {
  font-size: var(--font-size-sm); padding: 2px 8px; border-radius: 4px;
  border: 1px solid var(--border); background: var(--bg-tertiary);
  cursor: pointer; color: var(--text-secondary); transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.ip-edit-btn.on { background: var(--accent-bg, rgba(167,139,250,0.12)); color: var(--accent); border-color: var(--accent); }
.ip-del-btn {
  font-size: var(--font-size-sm); padding: 2px 8px; border-radius: 4px;
  border: 1px solid var(--danger, #e74c3c); background: transparent;
  cursor: pointer; color: var(--danger, #e74c3c); transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.ip-del-btn:hover { background: var(--danger, #e74c3c); color: #fff; }
.ip-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; }
.ip-close { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: var(--font-size-lg); padding: 4px; margin-left: 4px; }
.ip-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.ip-section { margin-bottom: 14px; }
.ip-label { font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--accent); margin-bottom: 3px; text-transform: uppercase; }
.ip-input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--input-bg); color: var(--text); font-size: var(--font-size-sm); resize: vertical; box-sizing: border-box; font-family: inherit; }
.ip-prop { margin-bottom: 8px; transition: background 0.15s, box-shadow 0.15s; border-radius: 4px; padding: 2px; }
.ip-prop.ip-prop-edit { background: var(--bg-tertiary, rgba(0,0,0,0.02)); }
.ip-prop.ip-drag-over { background: rgba(79, 70, 229, 0.08); box-shadow: 0 0 0 2px var(--accent) inset; }
.ip-prop-label { font-size: var(--font-size-xs); color: var(--text-secondary); margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
.ip-prop-handle { cursor: grab; opacity: 0.3; transition: opacity 0.15s; user-select: none; font-size: var(--font-size-base); letter-spacing: -1px; }
.ip-prop-handle:hover { opacity: 0.8; }
.ip-prop-badge { font-size: var(--text-micro-font-size); padding: 0 4px; border-radius: 3px; background: var(--accent-bg, rgba(167,139,250,0.12)); color: var(--accent); }
.ip-prop-del { background: none; border: none; color: var(--danger, #e74c3c); font-size: var(--font-size-xs); cursor: pointer; padding: 0 2px; opacity: 0.5; transition: opacity 0.15s; }
.ip-prop-del:hover { opacity: 1 !important; }
.ip-add-field { margin-top: 6px; }
.ip-add-btn { font-size: var(--font-size-xs); padding: 3px 10px; background: none; border: 1px dashed var(--border); border-radius: 4px; cursor: pointer; color: var(--text-tertiary); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.ip-add-btn:hover { border-color: var(--accent); color: var(--accent); }
.ip-adder { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ip-adder-key { max-width: 100px; font-size: var(--font-size-xs); }
.ip-adder-label { max-width: 100px; font-size: var(--font-size-xs); }
.ip-adder-type { padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-xs); background: var(--input-bg); color: var(--text); }
.ip-adder-ok { padding: 3px 10px; background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; font-size: var(--font-size-xs); cursor: pointer; }
.ip-adder-ok:hover { background: var(--accent); color: #fff; }
.ip-adder-cancel { padding: 3px 10px; background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-xs); cursor: pointer; }
.ip-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent); }
.ip-color-input { width: 40px; height: 28px; padding: 2px; cursor: pointer; border: 1px solid var(--border); border-radius: 4px; background: var(--input-bg); }
.ip-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.ip-tag { font-size: var(--font-size-xs); padding: 2px 8px; background: var(--bg-tertiary); border-radius: 4px; color: var(--text-secondary); }
.ip-rel { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: var(--font-size-sm); }
.ip-rel-icon { font-size: var(--font-size-base); }
.ip-rel-name { flex: 1; color: var(--text); }
.ip-rel-type { font-size: var(--font-size-xs); color: var(--text-secondary); background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; }

.ip-delete-bar {
  display: flex; align-items: center; gap: 8px; padding: 10px 16px;
  background: var(--danger-bg, #fef2f2); border-top: 1px solid var(--danger, #ef4444);
  font-size: var(--font-size-sm); color: var(--danger, #ef4444);
}
.ip-del-confirm { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--danger, #ef4444); background: var(--danger, #ef4444); color: #fff; font-size: var(--font-size-sm); cursor: pointer; }
.ip-del-confirm:hover { opacity: 0.85; }
.ip-del-cancel { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; }
.ip-del-cancel:hover { background: var(--hover-bg); }

.ip-order-overlay {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
}
.ip-order-box {
  background: var(--modal-bg, var(--bg-secondary)); border: 1px solid var(--border);
  border-radius: var(--radius-lg, 8px); padding: 20px; width: 90%; max-width: 420px;
  max-height: 70vh; display: flex; flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.3);
}
.ip-order-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.ip-order-header h3 { margin: 0; font-size: var(--font-size-md); color: var(--accent); }
.ip-order-close { background: none; border: none; font-size: var(--font-size-lg); cursor: pointer; color: var(--text-secondary); padding: 4px 8px; border-radius: var(--radius-sm, 4px); }
.ip-order-close:hover { background: var(--hover-bg); color: var(--text-color); }
.ip-order-body { flex: 1; overflow-y: auto; }
.ip-order-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: var(--radius-sm); margin-bottom: 4px; transition: background 0.15s, box-shadow 0.15s;
  background: var(--bg-tertiary, rgba(0,0,0,0.03));
}
.ip-order-item.ip-order-drag-over {
  background: rgba(79, 70, 229, 0.08);
  box-shadow: 0 0 0 2px var(--accent) inset;
}
.ip-order-handle {
  cursor: grab; opacity: 0.3; transition: opacity 0.15s;
  user-select: none; font-size: var(--font-size-base); letter-spacing: -1px;
}
.ip-order-handle:hover { opacity: 0.8; }
.ip-order-item:active .ip-order-handle { cursor: grabbing; }
.ip-order-key { font-size: var(--font-size-sm); color: var(--text-secondary); font-family: monospace; min-width: 80px; }
.ip-order-label { flex: 1; font-size: var(--font-size-sm); color: var(--text); }
.ip-order-custom-tag {
  font-size: var(--font-size-xs); padding: 1px 6px; border-radius: 3px;
  background: var(--accent-bg, rgba(167,139,250,0.12)); color: var(--accent);
}
.ip-order-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.ip-order-btn-save {
  padding: 7px 16px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm);
  border: 1px solid var(--accent); background: var(--accent-bg); color: var(--accent);
}
.ip-order-btn-save:hover { background: var(--color-primary-active); color: #fff; }
.ip-order-btn-cancel {
  padding: 7px 16px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm);
  border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-secondary);
}
.ip-order-btn-cancel:hover { background: var(--hover-bg); }

.confirm-bar-enter-active, .confirm-bar-leave-active { transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease; }
.confirm-bar-enter-from, .confirm-bar-leave-to { transform: translateY(100%); opacity: 0; }


.panel-enter-active, .panel-leave-active { transition: background 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), opacity 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), filter 0.3s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.panel-enter-from, .panel-leave-to { transform: translateX(100%); opacity: 0; }

.info-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-detail-backdrop);
  background: var(--overlay-bg);
  backdrop-filter: blur(4px);
  pointer-events: none;
}

.resize-handle-left {
  position: absolute;
  left: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-left:hover,
.resize-handle-left:active {
  background: var(--primary);
  opacity: 0.3;
}
.info-panel.left-side .resize-handle-left {
  left: auto; right: 0;
}
</style>

<style>
.ws-panel-enter-active,
.ws-panel-leave-active,
.ws-panel-left-enter-active,
.ws-panel-left-leave-active {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.ws-panel-enter-from,
.ws-panel-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
.ws-panel-left-enter-from,
.ws-panel-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
</style>
