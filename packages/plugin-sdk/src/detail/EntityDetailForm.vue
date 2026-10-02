<template>
  <div class="edf">
    <!-- L2 内容形态选择器：载体无关，抽屉/整页都吃到同一条 -->
    <div class="edf-forms" :aria-label="`${entityLabel || '实体'}详情形态`">
      <button
        v-for="f in forms"
        :key="f.form"
        class="edf-form-btn"
        :class="{ 'is-active': f.form === layout.contentForm }"
        type="button"
        :title="f.description"
        @click="emit('change-form', f.form)"
      >
        <WsIcon :name="f.icon" size="xs" />
        <span>{{ f.label }}</span>
      </button>
    </div>
    <div v-if="editingFallback" class="edf-form-hint">
      {{ getContentForm(layout.contentForm)?.label }}为只读呈现，编辑中暂用分组式
    </div>

    <component
      :is="activeForm"
      v-if="activeForm"
      v-bind="formProps"
      @update:field="onField"
      @remove-field="onRemove"
      @promote-field="onPromote"
      @demote-field="onDemote"
      @enter-edit="emit('enter-edit')"
    />

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
 * 实体详情内容件（载体无关）：**L2 内容形态的分发器**。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 *
 * 本件不再自己排字段——它把「可见字段 + 分组 + 形态配置」交给注册表里的形态件，
 * 自身只留三样跨形态的公共外壳：形态选择器、添加字段、保存条。
 * 这样新增一种编排不动本件，改外壳也不动五种编排。
 */
import { computed, ref, watch } from 'vue'
import { TuiButton, WsIcon } from '@worldsea/ui-kit'
import { useDetailLayoutStore, type Entity } from '@worldsea/entity-core'
import {
  activeContentForm,
  allContentForms,
  getContentForm,
  resolveContentConfig,
} from './contentForms'
import { orderedVisibleFields } from './formValues'
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
  'change-form': [form: string]
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

const forms = allContentForms()

const visibleFields = computed(() => orderedVisibleFields(props.fields, props.layout))

/** 实际渲染的形态：派生型在编辑态回落分组式（编排可变，写路径只有一条） */
const activeFormId = computed(() => activeContentForm(props.layout.contentForm, props.editing))
const activeForm = computed(() => getContentForm(activeFormId.value)?.component)
const editingFallback = computed(() =>
  props.editing && getContentForm(props.layout.contentForm)?.kind === 'derived')

const formProps = computed(() => ({
  entity: props.entity,
  fields: visibleFields.value,
  groups: props.layout.groups,
  editing: props.editing,
  draft: props.draft,
  config: resolveContentConfig(activeFormId.value, props.layout.contentConfig),
  entityLabel: props.entityLabel,
}))

const adding = ref(false)
const newKey = ref('')
const newLabel = ref('')
const newType = ref('text')

/** 新建字段的默认作用域取详情面偏好（缺省＝仅本实体） */
const detailPrefs = useDetailLayoutStore()
const defaultScope = computed<FieldScope>(() => (detailPrefs.fieldScopeDefault === 'type' ? 'type' : 'entity'))
const newScope = ref<FieldScope>(defaultScope.value)

function onField(key: string, value: unknown) {
  emit('update:field', key, value)
}

function onRemove(key: string) {
  emit('remove-field', key)
}

function onPromote(key: string) {
  emit('promote-field', key)
}

function onDemote(key: string) {
  emit('demote-field', key)
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
watch(() => props.entity?.id, () => { cancelAdd() })
</script>

<style scoped>
.edf { display: flex; flex-direction: column; gap: 14px; }
.edf-forms { display: flex; flex-wrap: wrap; gap: 4px; }
.edf-form-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; font-size: var(--font-size-xs); cursor: pointer;
  background: none; border: 1px solid var(--border, #ececec); border-radius: var(--radius-xs, 4px);
  color: var(--text-tertiary);
}
.edf-form-btn:hover { color: var(--text-secondary); border-color: var(--border, #d1d5db); }
.edf-form-btn.is-active {
  border-color: var(--accent, #4f46e5); color: var(--accent, #4f46e5);
  background: var(--accent-soft, #eef2ff);
}
.edf-form-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: -8px; }
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
