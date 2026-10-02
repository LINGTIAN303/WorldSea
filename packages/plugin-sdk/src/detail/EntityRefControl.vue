<template>
  <!-- 只读态：显示**实体名**（不是 ID），可点跳到该实体所在视图 -->
  <button
    v-if="!editing && target"
    class="erf-link"
    type="button"
    :title="`跳转到 ${target.name}`"
    @click="jumpToEntity(target)"
  >
    <WsIcon :name="iconFor(target.type)" size="xs" />
    <span class="erf-name">{{ target.name }}</span>
  </button>
  <span v-else-if="!editing" class="erf-empty">—</span>

  <!-- 编辑态：先回显当前目标（否则用户只看到一个空搜索框，不知道现在选的是谁），再给搜索选中 -->
  <div v-else class="erf-editor">
    <div v-if="target || dangling" class="erf-current">
      <template v-if="target">
        <WsIcon :name="iconFor(target.type)" size="xs" />
        <span class="erf-current-name">{{ target.name }}</span>
      </template>
      <span v-else class="erf-dangling">引用已失效（{{ modelValue }}）</span>
      <button type="button" class="erf-clear" aria-label="清除引用" @click="clear">×</button>
    </div>
    <input
      v-model="query"
      class="field-input"
      :placeholder="placeholder || '搜索实体...'"
      :aria-label="label"
      @focus="open = true"
      @blur="onBlur"
      @keydown.escape.prevent="open = false"
    />
    <div v-if="open" class="erf-dropdown">
      <button
        v-for="e in results"
        :key="e.id"
        class="erf-option"
        type="button"
        @mousedown.prevent="pick(e.id)"
      >{{ e.name }}</button>
      <div v-if="!results.length && query.trim()" class="erf-create">
        <button type="button" @mousedown.prevent="createAndPick">+ 创建「{{ query.trim() }}」</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * entityRef 字段控件。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
import { computed, ref } from 'vue'
import { useEntityStore, entitySchemaRegistry } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'

const props = withDefaults(defineProps<{
  modelValue: string | null | undefined
  label: string
  editing: boolean
  /** 目标实体类型（限定搜索范围；缺省则全类型搜名） */
  refType?: string
  placeholder?: string
}>(), {
  refType: '',
  placeholder: '',
})

const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const entityStore = useEntityStore()
const query = ref('')
const open = ref(false)

const target = computed(() => (props.modelValue ? entityStore.entityMap.get(props.modelValue) || null : null))

/** 有值但查不到实体＝引用已失效，界面必须说实话而不是静默显示 ID */
const dangling = computed(() => !!props.modelValue && !target.value)

const candidates = computed(() => {
  const all = entityStore.entities || []
  return props.refType ? all.filter(e => e.type === props.refType) : all
})

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return candidates.value.slice(0, 10)
  return candidates.value.filter(e => e.name.toLowerCase().includes(q)).slice(0, 10)
})

function iconFor(type: string): string {
  return entitySchemaRegistry.getIconName(type) || 'link'
}

function pick(id: string) {
  emit('update:modelValue', id)
  open.value = false
  query.value = ''
}

function clear() {
  emit('update:modelValue', '')
  query.value = ''
}

function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}

async function createAndPick() {
  const { useAutoCreateEntity } = await import('@worldsea/entity-core/composables')
  const { promptAndCreate } = useAutoCreateEntity()
  const created = await promptAndCreate({
    name: query.value.trim(),
    entityType: props.refType || 'custom',
  }) as Entity | null
  if (created) pick(created.id)
}

function jumpToEntity(e: Entity) {
  window.dispatchEvent(new CustomEvent('ws-navigate', {
    detail: { view: e.type, entityId: e.id, entityType: e.type },
  }))
}
</script>

<style scoped>
.erf-link {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 1px 6px; border: 1px solid var(--border, #ececec); border-radius: var(--radius-xs, 4px);
  background: var(--bg-muted, #f4f4f5); color: var(--text, #1f2328);
  font-size: var(--font-size-sm); cursor: pointer; text-align: left;
}
.erf-link:hover { border-color: var(--accent, #4f46e5); color: var(--accent, #4f46e5); }
.erf-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.erf-empty { color: var(--text-tertiary, #9ca3af); }
.erf-editor { position: relative; }
.erf-dropdown {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 100; max-height: 200px; overflow-y: auto;
  background: var(--bg-surface, #fff); border: 1px solid var(--border, #d1d5db);
  border-radius: var(--radius-sm, 4px); box-shadow: var(--shadow-dropdown, 0 4px 12px rgba(0,0,0,.1));
}
.erf-option {
  display: block; width: 100%; padding: 6px 8px; text-align: left;
  background: none; border: none; cursor: pointer; font-size: var(--font-size-sm); color: var(--text);
}
.erf-option:hover { background: var(--hover-bg, #f3f4f6); }
.erf-create button {
  display: block; width: 100%; padding: 6px 8px; text-align: left; cursor: pointer;
  background: var(--accent-soft, #eef2ff); color: var(--accent, #4f46e5);
  border: none; border-top: 1px dashed var(--border, #d1d5db); font-size: var(--font-size-sm);
}
.erf-dangling { font-size: var(--font-size-xs); color: var(--danger, #d97706); }
.erf-current {
  display: flex; align-items: center; gap: 4px; margin-bottom: 4px; padding: 2px 6px;
  border: 1px solid var(--border, #d1d5db); border-radius: var(--radius-xs, 4px);
  background: var(--bg-muted, #f4f4f5); font-size: var(--font-size-xs); color: var(--text-secondary);
}
.erf-current-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.erf-clear {
  background: none; border: none; cursor: pointer; padding: 0 2px;
  color: var(--text-tertiary, #9ca3af); font-size: var(--font-size-sm); line-height: 1;
}
.erf-clear:hover { color: var(--danger, #d97706); }
.field-input {
  width: 100%; padding: 6px 8px; box-sizing: border-box;
  border: 1px solid var(--border, #d1d5db); border-radius: var(--radius-sm, 4px);
  background: var(--bg-surface, #fff); color: var(--text); font-size: var(--font-size-sm); outline: none;
}
.field-input:focus { border-color: var(--accent, #4f46e5); }
</style>
