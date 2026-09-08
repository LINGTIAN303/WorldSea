<template>
  <div class="dynamic-fields">
    <!-- 图标长条：添加自定义字段 -->
    <div class="df-strip" @click="showSmartAdder = true" role="button" tabindex="0" @keydown.enter="showSmartAdder = true" @keydown.space.prevent="showSmartAdder = true">
      <WsIcon name="plus" size="sm" class="df-strip-icon" />
      <span class="df-strip-text">添加自定义字段</span>
    </div>

    <!-- 已有自定义字段（按定义渲染） -->
    <div v-for="def in fieldDefs" :key="def.key" class="df-row">
      <span class="df-key">{{ def.label }}</span>
      <input
        v-if="def.fieldType === 'text' || def.fieldType === 'number'"
        :type="def.fieldType"
        :value="getValue(def.key)"
        class="df-input"
        :aria-label="def.label"
        @input="updateValue(def.key, ($event.target as HTMLInputElement).value)"
      />
      <textarea
        v-else-if="def.fieldType === 'textarea'"
        :value="getValue(def.key) as string"
        class="df-input df-textarea"
        rows="2"
        :aria-label="def.label"
        @input="updateValue(def.key, ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <label v-else-if="def.fieldType === 'boolean'" class="df-check-wrap">
        <input type="checkbox" :checked="!!getValue(def.key)" :aria-label="def.label" @change="updateValue(def.key, ($event.target as HTMLInputElement).checked)" />
      </label>
      <select
        v-else-if="def.fieldType === 'select'"
        :value="getValue(def.key) as string"
        class="df-input"
        :aria-label="def.label"
        @change="updateValue(def.key, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">--</option>
        <option v-for="opt in def.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <button class="df-remove" @click="removeField(def.key)" title="删除此字段" aria-label="删除此字段"><WsIcon name="x" size="xs" /></button>
    </div>

    <!-- 智能添加字段弹窗 -->
    <SmartFieldAdder
      :visible="showSmartAdder"
      :entity-type="entityType"
      @confirm="onSmartAdd"
      @cancel="showSmartAdder = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { FieldSchema } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'
import SmartFieldAdder from './SmartFieldAdder.vue'

const props = withDefaults(defineProps<{
  /** 实体类型标识 */
  entityType: string
  /** 当前值（键值对） */
  modelValue: Record<string, unknown>
  /** 字段定义列表 */
  fieldDefs?: FieldSchema[]
}>(), {
  fieldDefs: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
  'update:fieldDefs': [defs: FieldSchema[]]
}>()

const showSmartAdder = ref(false)

function getValue(key: string): unknown {
  return props.modelValue?.[key]
}

function updateValue(key: string, value: string | number | boolean) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function onSmartAdd(data: {
  fieldDef: FieldSchema
  linkConfig?: { targetType: string; relationType: string }
  rememberMapping: boolean
}) {
  const { fieldDef } = data

  // 默认值
  let defaultVal: unknown = ''
  if (fieldDef.fieldType === 'number') defaultVal = 0
  else if (fieldDef.fieldType === 'boolean') defaultVal = false

  // 如果有关联配置，注入 autoLink 到字段定义
  const defWithLink: FieldSchema = { ...fieldDef }
  if (data.linkConfig) {
    defWithLink.autoLink = {
      targetType: data.linkConfig.targetType,
      relationType: data.linkConfig.relationType,
    }
  }

  // 添加值
  emit('update:modelValue', { ...props.modelValue, [fieldDef.key]: defaultVal })
  // 添加字段定义
  emit('update:fieldDefs', [...props.fieldDefs, defWithLink])

  showSmartAdder.value = false
}

function removeField(key: string) {
  // Remove value
  const { [key]: _, ...rest } = props.modelValue || {}
  emit('update:modelValue', rest)
  // Remove definition
  emit('update:fieldDefs', props.fieldDefs.filter(d => d.key !== key))
}
</script>

<style scoped>
.dynamic-fields { border-top: 1px dashed var(--border-color); padding-top: 8px; margin-top: 4px; }

/* 图标长条 UI */
.df-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
  background: transparent;
  user-select: none;
}
.df-strip:hover {
  border-color: var(--primary, #6c5ce7);
  background: color-mix(in srgb, var(--primary, #6c5ce7) 6%, transparent);
}
.df-strip:active {
  background: color-mix(in srgb, var(--primary, #6c5ce7) 12%, transparent);
}
.df-strip-icon {
  color: var(--text-tertiary, #888);
  flex-shrink: 0;
  transition: color 0.15s;
}
.df-strip:hover .df-strip-icon {
  color: var(--primary, #6c5ce7);
}
.df-strip-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary, #888);
  transition: color 0.15s;
}
.df-strip:hover .df-strip-text {
  color: var(--primary, #6c5ce7);
}

.df-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.df-key { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 70px; font-weight: var(--font-weight-medium); }
.df-input { flex: 1; padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit; background: var(--input-bg); color: var(--text-color); }
.df-textarea { resize: vertical; min-height: 36px; }
.df-check-wrap { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.df-check-wrap input[type="checkbox"] { accent-color: var(--primary); }
.df-remove {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--danger);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.df-remove:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>
