<template>
  <div class="edf">
    <!-- 分组：折叠态存本件局部态（一次浏览内的偏好，不落盘） -->
    <section v-for="group in visibleGroups" :key="group.key" class="edf-group">
      <button class="edf-group-head" type="button" :aria-expanded="!collapsed.has(group.key)" @click="toggleGroup(group.key)">
        <WsIcon :name="collapsed.has(group.key) ? 'chevron-right' : 'chevron-down'" size="xs" />
        <span class="edf-group-label">{{ group.label }}</span>
        <span class="edf-group-count">{{ group.fieldKeys.length }}</span>
      </button>

      <div v-show="!collapsed.has(group.key)" class="edf-rows">
        <div
          v-for="key in group.fieldKeys"
          :key="key"
          class="edf-row"
          :class="{ 'edf-row-full': isFullWidth(key) }"
        >
          <div class="edf-row-head">
            <span class="edf-label">{{ labelOf(key) }}</span>
            <span v-if="editing" class="edf-row-acts">
              <button
                v-if="scopeOf(key) === 'entity'"
                class="edf-act"
                type="button"
                title="共享给整个类型：同类型所有实体的详情都会出现该字段"
                @click="emit('promote-field', key)"
              >共享</button>
              <button
                v-else-if="canRemove(key)"
                class="edf-act"
                type="button"
                title="仅保留在本实体：从类型定义里摘出，值不动"
                @click="emit('demote-field', key)"
              >仅本实体</button>
              <button
                v-if="canRemove(key)"
                class="edf-field-del"
                type="button"
                :title="`从「${entityLabel}」移除该字段`"
                @click="emit('remove-field', key)"
              >×</button>
            </span>
          </div>
          <div class="edf-control" @dblclick="onRowDblClick">
            <FieldControl
              :value="valueOf(key)"
              :raw-type="typeOf(key)"
              :label="labelOf(key)"
              :editing="editing"
              :options="optionsOf(key)"
              :ref-type="refTypeOf(key)"
              :entity-id="entity?.id"
              :cover-position="entity?.coverPosition"
              :cover-zoom="entity?.coverZoom"
              @update:value="val => emit('update:field', key, val)"
              @update:cover-position="val => emit('update:field', 'coverPosition', val)"
              @update:cover-zoom="val => emit('update:field', 'coverZoom', val)"
              @request-edit="enterEdit"
            />
          </div>
        </div>
      </div>
    </section>

    <div v-if="editing" class="edf-add">
      <button v-if="!adding" class="edf-add-btn" type="button" @click="adding = true">＋ 添加字段</button>
      <div v-else class="edf-adder">
        <input v-model="newKey" class="edf-input" placeholder="字段 key（英文）" aria-label="字段 key" />
        <input v-model="newLabel" class="edf-input" placeholder="显示名" aria-label="显示名" />
        <select v-model="newType" class="edf-input" aria-label="字段类型">
          <option v-for="t in CREATABLE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <select v-model="newScope" class="edf-input" aria-label="字段作用域" title="字段出现在哪些实体的详情里">
          <option value="entity">仅本实体</option>
          <option value="type">整个类型共享</option>
        </select>
        <button class="edf-btn" type="button" @click="confirmAdd">确定</button>
        <button class="edf-btn" type="button" @click="cancelAdd">取消</button>
      </div>
    </div>

    <!-- 芽的补充区只在确有实体时下传，消费方拿到的 entity 非空 -->
    <template v-if="entity">
      <slot name="extra" :entity="entity" :editing="editing" />
    </template>

    <div v-if="editing" class="edf-actions">
      <TuiButton variant="danger-ghost" size="sm" @click="emit('delete')">删除实体</TuiButton>
      <span class="edf-actions-spacer"></span>
      <TuiButton variant="secondary" size="sm" @click="emit('cancel')">取消</TuiButton>
      <TuiButton variant="primary" size="sm" @click="emit('save')">保存</TuiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 实体详情内容件（载体无关）：详情段从 GEV 外移到此，抽屉只是第一个载体。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
import { computed, ref, watch } from 'vue'
import { TuiButton, WsIcon } from '@worldsea/ui-kit'
import { useDetailLayoutStore, type Entity } from '@worldsea/entity-core'
import FieldControl from './FieldControl.vue'
import { controlSpecFor } from './fieldControlMap'
import { normalizeFieldType } from './fieldType'
import { isTitleField, readFieldValue } from './fieldAccessor'
import type { FieldScope } from './fieldScope'
import type { DetailLayout } from './detailLayout'
import type { DetailFieldMeta } from './fieldMeta'

const props = withDefaults(defineProps<{
  entity: Entity | null
  fields: DetailFieldMeta[]
  layout: DetailLayout
  editing: boolean
  /** 草稿值（schema key → 值）；由调用方持有，本件只发事件不直写存储 */
  draft: Record<string, unknown>
  entityLabel?: string
}>(), {
  entityLabel: '',
})

const emit = defineEmits<{
  'update:field': [key: string, value: unknown]
  'add-field': [field: { key: string; label: string; fieldType: string; scope: FieldScope }]
  'remove-field': [key: string]
  'promote-field': [key: string]
  'demote-field': [key: string]
  'enter-edit': []
  save: []
  cancel: []
  delete: []
}>()

/** 抽屉里可当场创建的字段类型（与 Rust 校验分支同集合的子集） */
const CREATABLE_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'textarea', label: '长文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '开关' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '选项' },
  { value: 'color', label: '颜色' },
  { value: 'tags', label: '标签' },
  { value: 'multiSelect', label: '多选' },
]

const collapsed = ref<Set<string>>(new Set())
const adding = ref(false)
const newKey = ref('')
const newLabel = ref('')
const newType = ref('text')

/** 新建字段的默认作用域取详情面偏好（缺省＝仅本实体） */
const detailPrefs = useDetailLayoutStore()
const defaultScope = computed<FieldScope>(() => (detailPrefs.fieldScopeDefault === 'type' ? 'type' : 'entity'))
const newScope = ref<FieldScope>(defaultScope.value)

/** 标题栏已承载 title，正文不重复一行 */
const visibleGroups = computed(() => {
  return props.layout.groups
    .map(g => ({ ...g, fieldKeys: g.fieldKeys.filter(k => !isTitleField(k)) }))
    .filter(g => g.fieldKeys.length > 0)
})

const metaMap = computed(() => new Map(props.fields.map(f => [f.key, f])))

function metaOf(key: string): DetailFieldMeta | undefined {
  return metaMap.value.get(key)
}

function labelOf(key: string): string {
  return metaOf(key)?.label || key
}

function typeOf(key: string): string {
  return metaOf(key)?.fieldType || 'text'
}

function optionsOf(key: string) {
  return metaOf(key)?.options
}

function refTypeOf(key: string): string {
  return metaOf(key)?.refType || ''
}

function isFullWidth(key: string): boolean {
  return controlSpecFor(normalizeFieldType(typeOf(key))).fullWidth
}

/** 值优先取草稿（编辑态），否则按字段定位读实体 */
function valueOf(key: string): unknown {
  if (props.editing && key in props.draft) return props.draft[key]
  return readFieldValue(props.entity, key)
}

/** 只有非内置字段可移除（内置字段由芽声明，移除等于改芽的语义） */
function canRemove(key: string): boolean {
  return (metaOf(key)?.source ?? 'builtin') !== 'builtin'
}

function scopeOf(key: string): FieldScope {
  return metaOf(key)?.scope ?? 'type'
}

function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

function onRowDblClick() {
  if (!props.editing) enterEdit()
}

function enterEdit() {
  emit('enter-edit')
}

function confirmAdd() {
  const key = newKey.value.trim()
  if (!key) return
  emit('add-field', { key, label: newLabel.value.trim() || key, fieldType: newType.value, scope: newScope.value })
  cancelAdd()
}

function cancelAdd() {
  adding.value = false
  newKey.value = ''
  newLabel.value = ''
  newType.value = 'text'
  newScope.value = defaultScope.value
}

// 换实体时收起「添加字段」展开态，避免把上一份草稿的输入带过来
watch(() => props.entity?.id, () => { cancelAdd(); collapsed.value = new Set() })
</script>

<style scoped>
.edf { display: flex; flex-direction: column; gap: 14px; }
.edf-group { display: flex; flex-direction: column; gap: 6px; }
.edf-group-head {
  display: flex; align-items: center; gap: 6px; padding: 2px 0; width: 100%;
  background: none; border: none; cursor: pointer; text-align: left;
  color: var(--text-secondary); font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold); letter-spacing: 0.3px;
}
.edf-group-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.edf-group-count { color: var(--text-tertiary); font-weight: normal; }
.edf-rows { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.edf-row { flex: 1 1 calc(50% - 12px); min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.edf-row-full { flex-basis: 100%; }
.edf-row-head { display: flex; align-items: center; gap: 4px; }
.edf-label {
  font-size: var(--font-size-xs); color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edf-field-del {
  background: none; border: none; cursor: pointer; padding: 0 2px;
  color: var(--danger, #d97706); font-size: var(--font-size-xs); opacity: 0.6;
}
.edf-field-del:hover { opacity: 1; }
.edf-row-acts { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
.edf-act {
  padding: 0 5px; font-size: var(--font-size-xs); cursor: pointer;
  background: none; border: 1px solid var(--border, #d1d5db); border-radius: 3px;
  color: var(--text-tertiary, #9ca3af); white-space: nowrap;
}
.edf-act:hover { border-color: var(--accent, #4f46e5); color: var(--accent, #4f46e5); }
.edf-control { min-width: 0; cursor: default; }
.edf-add { margin-top: 2px; }
.edf-add-btn {
  font-size: var(--font-size-xs); padding: 3px 10px; background: none;
  border: 1px dashed var(--border, #d1d5db); border-radius: var(--radius-sm, 4px);
  color: var(--text-tertiary); cursor: pointer;
}
.edf-add-btn:hover { border-color: var(--accent, #4f46e5); color: var(--accent, #4f46e5); }
.edf-adder { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.edf-input {
  padding: 4px 6px; border: 1px solid var(--border, #d1d5db); border-radius: var(--radius-sm, 4px);
  background: var(--bg-surface, #fff); color: var(--text); font-size: var(--font-size-xs);
}
.edf-btn {
  padding: 3px 10px; font-size: var(--font-size-xs); cursor: pointer;
  border: 1px solid var(--border, #d1d5db); border-radius: var(--radius-sm, 4px);
  background: var(--bg-muted, #f4f4f5); color: var(--text-secondary);
}
.edf-actions { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border, #ececec); }
.edf-actions-spacer { flex: 1; }
</style>
