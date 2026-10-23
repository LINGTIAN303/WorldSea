<template>
  <!-- ── 只读态 ── -->
  <template v-if="!editing">
    <ImageField
      v-if="kind === 'image'"
      :value="value"
      :editing="false"
      :entity-id="entityId"
      :cover-position="coverPosition"
      :cover-zoom="coverZoom"
      @open-lightbox="url => emit('open-lightbox', url)"
      @request-edit="emit('request-edit')"
    />
    <EntityRefControl
      v-else-if="kind === 'entityRef'"
      :model-value="stringValue"
      :label="label"
      :editing="false"
      :ref-type="refType"
    />
    <div v-else-if="kind === 'tags' || kind === 'multiSelect'" class="fc-chips">
      <span v-for="item in arrayValue" :key="item" class="fc-chip">{{ optionLabel(item) }}</span>
      <span v-if="!arrayValue.length" class="fc-empty">—</span>
    </div>
    <span v-else-if="kind === 'checkbox'" class="fc-text">{{ boolText }}</span>
    <span v-else class="fc-text" :class="{ 'fc-empty': display === '—' }">{{ display }}</span>
    <span v-if="kind === 'unsupported'" class="fc-unknown" :title="`字段类型「${rawType}」无对应控件`">未支持类型</span>
  </template>

  <!-- ── 编辑态 ── -->
  <template v-else>
    <ImageField
      v-if="kind === 'image'"
      :value="value"
      :editing="true"
      :entity-id="entityId"
      :cover-position="coverPosition"
      :cover-zoom="coverZoom"
      @update:value="val => emit('update:value', val)"
      @update:cover-position="val => emit('update:cover-position', val)"
      @update:cover-zoom="val => emit('update:cover-zoom', val)"
    />
    <EntityRefControl
      v-else-if="kind === 'entityRef'"
      :model-value="stringValue"
      :label="label"
      :editing="true"
      :ref-type="refType"
      :placeholder="placeholder"
      @update:model-value="id => emit('update:value', id)"
    />
    <div v-else-if="kind === 'multiSelect'" class="fc-checks">
      <label v-for="opt in optionList" :key="opt.value" class="fc-check">
        <input type="checkbox" :checked="arrayValue.includes(opt.value)" @change="toggleMulti(opt.value)" />
        {{ opt.label }}
      </label>
    </div>
    <div v-else-if="kind === 'tags'" class="fc-chips fc-tags">
      <span v-for="item in arrayValue" :key="item" class="fc-chip fc-chip-removable">
        {{ item }}
        <button type="button" class="fc-chip-x" :aria-label="`移除 ${item}`" @click="removeTag(item)">×</button>
      </span>
      <input
        v-model="tagDraft"
        class="fc-input fc-tag-input"
        placeholder="回车添加"
        :aria-label="`${label} 新标签`"
        @keydown.enter.prevent="commitTag"
        @blur="commitTag"
      />
    </div>
    <div v-else-if="kind === 'checkbox'" class="fc-check-wrap">
      <input type="checkbox" :checked="!!value" :aria-label="label" @change="emit('update:value', ($event.target as HTMLInputElement).checked)" />
    </div>
    <select v-else-if="kind === 'select'" class="fc-input" :value="stringValue" :aria-label="label" @change="onSelectChange">
      <option value="">—</option>
      <option v-for="opt in optionList" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
    <input
      v-else-if="kind === 'date'"
      class="fc-input"
      type="date"
      :value="stringValue"
      :aria-label="label"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />
    <textarea
      v-else-if="kind === 'textarea'"
      class="fc-input fc-textarea"
      rows="2"
      :value="stringValue"
      :placeholder="placeholder"
      :aria-label="label"
      @input="emit('update:value', ($event.target as HTMLTextAreaElement).value)"
    />
    <RichTextEditor
      v-else-if="kind === 'richtext'"
      :model-value="stringValue"
      @update:model-value="val => emit('update:value', val)"
    />
    <input
      v-else
      ref="inputRef"
      class="fc-input"
      :type="kind === 'static' ? 'text' : nativeType"
      :value="stringValue"
      :placeholder="placeholder"
      :readonly="kind === 'static' || kind === 'unsupported'"
      :aria-label="label"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />
  </template>
</template>

<script setup lang="ts">
/**
 * 字段控件本体：按 controlSpecFor(kind) 分派，全仓唯一的一处类型分支。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
import { computed, ref } from 'vue'
import { RichTextEditor } from '@worldsea/ui-kit'
import ImageField from '../components/ImageField.vue'
import EntityRefControl from './EntityRefControl.vue'
import { controlSpecFor, nativeInputType } from './fieldControlMap'
import { normalizeFieldType } from './fieldType'
import { toArrayValue, toDisplayText, toInputText, normalizeFieldOptions, optionDisplayText } from './fieldValue'

const props = withDefaults(defineProps<{
  value: unknown
  /** schema 原始 fieldType（本件内部归一，调用方不必再操心命名） */
  rawType: string
  label: string
  editing: boolean
  options?: { value: string; label: string }[] | string[]
  placeholder?: string
  refType?: string
  entityId?: string
  coverPosition?: string
  coverZoom?: number
}>(), {
  options: undefined,
  placeholder: '',
  refType: '',
  entityId: undefined,
  coverPosition: undefined,
  coverZoom: undefined,
})

const emit = defineEmits<{
  'update:value': [val: unknown]
  'update:cover-position': [val: string]
  'update:cover-zoom': [val: number]
  'open-lightbox': [url: string]
  'request-edit': []
}>()

const type = computed(() => normalizeFieldType(props.rawType))
const kind = computed(() => controlSpecFor(type.value).kind)
const nativeType = computed(() => nativeInputType(type.value))
/** 只读展示：select 枚举要显示中文标签，不能把内部值（如 exact）直接抛给用户 */
const display = computed(() => kind.value === 'select'
  ? optionDisplayText(props.value, props.options)
  : toDisplayText(props.value, type.value))
const stringValue = computed(() => toInputText(props.value))
const arrayValue = computed(() => toArrayValue(props.value))
const boolText = computed(() => (props.value ? '是' : '否'))

/** 选项两来源形态（schema 是对象数组，历史代码有写字符串数组的） */
const optionList = computed(() => normalizeFieldOptions(props.options))

/** 枚举值 → 显示标签（未知值原样返回） */
function optionLabel(value: string): string {
  return optionDisplayText(value, props.options)
}

const tagDraft = ref('')

function onSelectChange(e: Event) {
  emit('update:value', (e.target as HTMLSelectElement).value)
}

function toggleMulti(val: string) {
  const next = arrayValue.value.includes(val)
    ? arrayValue.value.filter(v => v !== val)
    : [...arrayValue.value, val]
  emit('update:value', next)
}

function commitTag() {
  const raw = tagDraft.value
  const parts = raw.split(',').map(s => s.trim()).filter(s => s !== '')
  if (!parts.length) return
  const next = [...new Set([...arrayValue.value, ...parts])]
  emit('update:value', next)
  tagDraft.value = ''
}

function removeTag(val: string) {
  emit('update:value', arrayValue.value.filter(v => v !== val))
}
</script>

<style scoped>
.fc-text { font-size: var(--font-size-sm); color: var(--text); line-height: 1.5; word-break: break-word; white-space: pre-wrap; }
.fc-empty { color: var(--text-tertiary, #9ca3af); }
.fc-unknown { margin-left: 6px; padding: 0 4px; border-radius: 3px; font-size: var(--font-size-xs); color: var(--danger, #d97706); background: var(--bg-muted, #f4f4f5); }
.fc-input {
  width: 100%; padding: 6px 8px; box-sizing: border-box;
  border: 1px solid var(--border, #d1d5db); border-radius: var(--radius-sm, 4px);
  background: var(--bg-surface, #fff); color: var(--text);
  font-size: var(--font-size-sm); font-family: inherit; outline: none;
}
.fc-input:focus { border-color: var(--accent, #4f46e5); box-shadow: 0 0 0 2px var(--accent-soft, rgba(79,70,229,.1)); }
.fc-input[readonly] { background: var(--bg-muted, #f4f4f5); color: var(--text-secondary); }
.fc-textarea { min-height: 48px; resize: vertical; }
.fc-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.fc-chip {
  padding: 1px 6px; border-radius: 4px; font-size: var(--font-size-xs);
  background: var(--hover-bg, #f3f4f6); color: var(--text-secondary);
}
.fc-chip-removable { display: inline-flex; align-items: center; gap: 2px; }
.fc-chip-x { background: none; border: none; cursor: pointer; color: inherit; padding: 0 1px; font-size: var(--font-size-xs); }
.fc-tag-input { width: 88px; padding: 1px 6px; }
.fc-checks, .fc-check-wrap { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.fc-check { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); cursor: pointer; }
.fc-check input, .fc-check-wrap input { accent-color: var(--accent, #4f46e5); }
</style>
