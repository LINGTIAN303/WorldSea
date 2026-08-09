<template>
  <div class="detail-field-row" :class="[isCompact ? 'field-compact' : 'field-full', isCompact ? '' : 'field-full-width']">
    <span class="field-key">{{ label }}</span>
    <!-- 编辑态：全局编辑 或 双击字段编辑 -->
    <div v-if="effectiveEditing" class="field-edit">
      <input v-if="type === 'text' || type === 'number' || type === 'url' || type === 'email'"
        ref="inputRef" v-model="localValue" :type="type === 'number' ? 'number' : 'text'"
        class="field-input" :placeholder="placeholder" :aria-label="label"
        @keydown.enter="commitFieldEdit"
        @keydown.escape.prevent="cancelFieldEdit"
        @blur="commitFieldEdit" />
      <span v-if="linkStatus" class="field-link-status" :class="{ 'field-link-matched': linkStatus.matched, 'field-link-creatable': !linkStatus.matched && linkStatus.canCreate }">
        {{ linkStatus.matched ? '✓ 已关联' : '+ 可创建' }}
      </span>
      <textarea v-else-if="type === 'textarea' || type === 'text-long'"
        ref="inputRef" v-model="localValue" class="field-input field-textarea"
        :placeholder="placeholder" rows="2" :aria-label="label"
        @keydown.escape.prevent="cancelFieldEdit"
        @blur="commitFieldEdit"></textarea>
      <select v-else-if="type === 'select'" ref="inputRef" v-model="localValue"
        class="field-input" :aria-label="label" @change="commitFieldEdit">
        <option value="">--</option>
        <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <label v-else-if="type === 'boolean'" class="field-check-wrap">
        <input type="checkbox" v-model="localValue" @change="commitFieldEdit" />
      </label>
      <template v-else-if="type === 'entity-ref' || type === 'entity-refs'">
  <div class="field-entity-ref-editor">
    <input
      v-model="entitySearchQuery"
      class="field-input"
      :placeholder="placeholder || '搜索实体...'"
      :aria-label="label"
      @focus="showEntityDropdown = true"
      @blur="onEntityBlur"
      @keydown.escape.prevent="showEntityDropdown = false"
    />
    <div v-if="showEntityDropdown" class="field-entity-dropdown">
      <div
        v-for="e in entitySearchResults"
        :key="e.id"
        class="field-entity-option"
        @mousedown.prevent="selectEntityRef(e)"
      >
        {{ e.name }}
      </div>
      <div v-if="entitySearchResults.length === 0 && entitySearchQuery.trim()" class="field-entity-create">
        <button @mousedown.prevent="createAndSelectEntity">+ 创建「{{ entitySearchQuery.trim() }}」</button>
      </div>
    </div>
  </div>
</template>
  <template v-else-if="type === 'formula'">
    <span class="field-formula-value">{{ localValue ?? '' }}</span>
  </template>
  <template v-else-if="type === 'color'">
    <span class="field-color-swatch" :style="{background: String(localValue || '#ccc')}"></span>
    <span class="field-color-value">{{ localValue || '' }}</span>
  </template>
      <template v-else-if="type === 'image'">
        <ImageField
          :value="localValue"
          :editing="true"
          :entity-id="entityId"
          :cover-position="coverPosition"
          :cover-zoom="coverZoom"
          @update:value="val => { localValue = val; commitFieldEdit() }"
          @update:cover-position="val => emit('update:coverPosition', val)"
          @update:cover-zoom="val => emit('update:coverZoom', val)"
        />
      </template>
  <input v-else-if="type === 'date'" ref="inputRef" v-model="localValue"
        type="date" class="field-input"
        @keydown.enter="commitFieldEdit"
        @keydown.escape.prevent="cancelFieldEdit"
        @blur="commitFieldEdit" />
      <input v-else ref="inputRef" v-model="localValue"
        class="field-input" :placeholder="placeholder"
        @keydown.enter="commitFieldEdit"
        @keydown.escape.prevent="cancelFieldEdit"
        @blur="commitFieldEdit" />
    </div>
      <ImageField
        v-else-if="type === 'image'"
        :value="localValue"
        :editing="false"
        :entity-id="entityId"
        :cover-position="coverPosition"
        :cover-zoom="coverZoom"
        @open-lightbox="openLightbox"
        @request-edit="enterFieldEdit"
      />
    <span v-else class="field-val" @dblclick="enterFieldEdit" :title="'双击编辑'">
      {{ displayValue }}
    </span>
    <ImageLightbox
      :visible="lightboxVisible"
      :src="lightboxUrl"
      @close="closeLightbox"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import { getSettingsApi } from '@worldsmith/entity-core'
import { useSmartFieldLink } from '@worldsmith/entity-core/composables'
import ImageField from './ImageField.vue'
import ImageLightbox from './ImageLightbox.vue'

const props = defineProps<{
  label: string
  value: unknown
  editing?: boolean
  type?: 'text' | 'textarea' | 'text-long' | 'number' | 'select' | 'boolean' | 'date' | 'url' | 'email' | 'entity-ref' | 'entity-refs' | 'formula' | 'color' | 'image'
  options?: string[]
  placeholder?: string
  compact?: boolean
  entityId?: string
  coverPosition?: string
  coverZoom?: number
  autoLink?: {
    targetType: string
    relationType: string
    searchField?: string
    createIfMissing?: boolean
  }
}>()

const emit = defineEmits<{
  'update:value': [val: any]
  'update:coverPosition': [val: string]
  'update:coverZoom': [val: number]
  'commit': []
}>()

const entityStore = useEntityStore()
const settings = getSettingsApi()

const { checkFieldLink } = useSmartFieldLink()

const linkStatus = computed(() => {
  if (!props.autoLink || props.type !== 'text') return null
  const val = String(localValue.value || '')
  if (!val.trim()) return null
  return checkFieldLink(val, props.autoLink)
})

const entitySearchQuery = ref('')
const showEntityDropdown = ref(false)

const entitySearchResults = computed(() => {
  const q = entitySearchQuery.value.toLowerCase()
  if (!q) return []
  return (entityStore.entities || [])
    .filter(e => e.name.toLowerCase().includes(q))
    .slice(0, 10)
})

function selectEntityRef(entity: any) {
  localValue.value = entity.id
  showEntityDropdown.value = false
  commitFieldEdit()
}

async function createAndSelectEntity() {
  if (!settings.autoCreateEntityRefEnabled) return
  const { useAutoCreateEntity } = await import('@worldsmith/entity-core/composables')
  const { promptAndCreate } = useAutoCreateEntity()
  const entity = await promptAndCreate({
    name: entitySearchQuery.value.trim(),
    entityType: (props as any).refType || 'custom',
  })
  if (entity) {
    localValue.value = entity.id
    showEntityDropdown.value = false
    commitFieldEdit()
  }
}

function onEntityBlur() {
  setTimeout(() => { showEntityDropdown.value = false }, 150)
}

const FULL_WIDTH_TYPES = new Set(['textarea', 'text-long', 'entity-ref', 'entity-refs', 'formula', 'url', 'email', 'image'])

const isCompact = computed(() => {
  if (props.compact === true) return true
  if (props.compact === false) return false
  return !FULL_WIDTH_TYPES.has(props.type || 'text')
})

/** 当前字段是否通过双击进入单独编辑（区别于 props.editing 全局编辑） */
const fieldEditing = ref(false)
const savedOriginal = ref<unknown>(undefined)
const lightboxUrl = ref('')
const lightboxVisible = ref(false)

function openLightbox(url: string) {
  lightboxUrl.value = url
  lightboxVisible.value = true
}
function closeLightbox() {
  lightboxVisible.value = false
}
const inputRef = ref<HTMLElement>()

/** 有效编辑态：全局编辑 或 双击字段编辑 */
const effectiveEditing = computed(() => props.editing || fieldEditing.value)

const localValue = computed({
  get: () => props.value as any,
  set: (val) => emit('update:value', val),
})

const displayValue = computed(() => {
  if (props.value === undefined || props.value === null) return '—'
  if (props.type === 'boolean') return props.value ? '✓' : '✗'
  if (Array.isArray(props.value)) return (props.value as unknown[]).join(', ')
  const s = String(props.value)
  return s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
})

/** 双击字段进入单字段编辑模式 */
function enterFieldEdit() {
  if (props.editing) return  // 已在全局编辑模式，不处理
  savedOriginal.value = props.value
  fieldEditing.value = true
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.focus()
      // 对 input 类型选中全部文本
      if (inputRef.value instanceof HTMLInputElement || inputRef.value instanceof HTMLTextAreaElement) {
        inputRef.value.select()
      }
    }
  })
}

/** 保存当前字段编辑（Enter / Blur / Change） */
function commitFieldEdit() {
  fieldEditing.value = false
  if (!props.editing) {
    emit('commit')
  }
}

/** 取消当前字段编辑（Escape） */
function cancelFieldEdit() {
  fieldEditing.value = false
  // 恢复原始值
  emit('update:value', savedOriginal.value)
}
</script>

<style scoped>
.detail-field-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-key {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.field-val {
  font-size: var(--font-size-base);
  color: var(--text-color);
  line-height: 1.5;
  word-break: break-word;
  cursor: default;
  min-height: 1.5em;
  padding: 1px 0;
  border-radius: 3px;
  transition: background 0.15s;
}
.field-val:hover {
  background: var(--hover-bg, rgba(0,0,0,0.03));
}
.field-val:active {
  background: var(--primary-light, #eef2ff);
}
.field-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 4px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--input-bg, #fff);
  color: var(--text-color);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: var(--primary, #4f46e5);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}
.field-textarea {
  resize: vertical;
  min-height: 48px;
}
.field-check-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.field-check-wrap input[type="checkbox"] {
  accent-color: var(--primary, #4f46e5);
}
.field-entity-ref-editor {
  position: relative;
}
.field-entity-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--input-bg, #fff);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.field-entity-option {
  padding: 6px 8px;
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.field-entity-option:hover {
  background: var(--hover-bg, #f3f4f6);
}
.field-entity-create button {
  width: 100%;
  padding: 6px 8px;
  background: var(--primary-light, #eef2ff);
  color: var(--primary, #4f46e5);
  border: none;
  border-top: 1px dashed var(--border-color);
  cursor: pointer;
  font-size: var(--font-size-sm);
}
.field-entity-create button:hover {
  background: var(--primary, #4f46e5);
  color: white;
}
.field-link-status {
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 4px;
  white-space: nowrap;
}
.field-link-matched {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
}
.field-link-creatable {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
}
</style>

<style>
.detail-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px 12px;
  font-size: var(--font-size-sm);
  margin: 12px 0;
}
.detail-fields > .detail-field-row {
  min-width: 0;
}
.detail-fields > .detail-field-row.field-full-width {
  grid-column: 1 / -1;
}
</style>
